import assert from "node:assert/strict";
import { freemem } from "node:os";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir, unlink, open } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = process.env.SCANFORGE_QA_OUT
    ? new URL(
        "./",
        pathToFileURL(`${process.env.SCANFORGE_QA_OUT}/ledger.json`),
      )
    : new URL("../.resources/split-lifecycle/", import.meta.url);
const builtRoot = process.env.SCANFORGE_QA_DIST
  ? new URL("./", pathToFileURL(`${process.env.SCANFORGE_QA_DIST}/index.html`))
  : new URL("dist/", root);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
const requiredMiB = 1536;
if (freemem() < requiredMiB * 1048576)
  throw Error(
    `Split replay requires ${requiredMiB} MiB free; do not lower the guard`,
  );
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "split-lifecycle-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    persistentData: false,
    resources: [],
  };
function processIdentity(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${pid}) | Select-Object @{n='startedAt';e={$_.StartTime.ToUniversalTime().ToString('o')}},@{n='executable';e={$_.Path}} | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  return {
    ...JSON.parse(result.stdout),
    expiresAt: ledger.expiresAt,
    persistentData: false,
  };
}
let server, reserve, browserServer, browser, client, transport, failed, page;
let heartbeatTimer, heartbeatTimeout;
const fixturePath = fileURLToPath(new URL("split-lifecycle-panel.stl", out));
const deadline = setTimeout(() => {
  failed = Error("Browser validation lease expired");
  void browserServer?.close();
}, 900000);
try {
  server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, "http://127.0.0.1").pathname;
      const file = new URL(
        name === "/" ? "index.html" : name.slice(1),
        builtRoot,
      );
      if (!file.href.startsWith(builtRoot.href)) throw Error("Invalid path");
      const data = await readFile(file);
      const ext = file.pathname.split(".").pop();
      res.writeHead(200, {
        ...(process.env.SCANFORGE_QA_ISOLATED === "1"
          ? {
              "Cross-Origin-Opener-Policy": "same-origin",
              "Cross-Origin-Embedder-Policy": "require-corp",
            }
          : {}),
        "Content-Type":
          {
            html: "text/html",
            js: "application/javascript",
            css: "text/css",
            wasm: "application/wasm",
            json: "application/json",
          }[ext] ?? "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const appPort = server.address().port,
    origin = `http://127.0.0.1:${appPort}`;
  reserve = http.createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const bridgePort = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  reserve = undefined;
  ledger.resources.push({
    kind: "http-server",
    port: appPort,
    bind: "127.0.0.1",
  });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("scripts/mcp-server.mjs", root))],
    env: {
      ...process.env,
      SCANFORGE_MCP_TOKEN: token,
      SCANFORGE_BRIDGE_PORT: String(bridgePort),
      SCANFORGE_ORIGINS: origin,
    },
    stderr: "pipe",
  });
  client = new Client({ name: "split-lifecycle-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    ...processIdentity(transport.pid),
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--js-flags=--max-old-space-size=3072",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...processIdentity(browserServer.process().pid),
  });
  await writeFile(
    new URL("split-lifecycle-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  page.setDefaultTimeout(12000);
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (process.env.SCANFORGE_M2_LOG_JOB === "1") {
    page.on("crash", () => {
      (ledger.browserEvents ??= []).push({
        event: "crash",
        at: new Date().toISOString(),
      });
      console.log(JSON.stringify({ browserEvent: "crash" }));
    });
    page.on("close", () => {
      (ledger.browserEvents ??= []).push({
        event: "close",
        at: new Date().toISOString(),
      });
      console.log(JSON.stringify({ browserEvent: "close" }));
    });
  }
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
    if (
      process.env.SCANFORGE_M2_WORKER_TRACE === "1" &&
      message.text().startsWith("M2_WORKER_TRACE ")
    )
      console.log(message.text());
  });
  if (process.env.SCANFORGE_M2_TRACE_BUFFERS === "1") {
    await page.addInitScript(() => {
      const entries = [],
        seen = new WeakMap();
      window.__m2RememberBuffer = (buffer, origin) => {
        if (
          !(buffer instanceof ArrayBuffer) ||
          buffer.byteLength < 1048576 ||
          seen.has(buffer)
        )
          return;
        const entry = {
          ref: new WeakRef(buffer),
          bytes: buffer.byteLength,
          origin,
        };
        seen.set(buffer, entry);
        entries.push(entry);
      };
      window.__m2BufferSummary = () =>
        entries.map(({ ref, bytes, origin }) => {
          const buffer = ref.deref();
          return { bytes, liveBytes: buffer?.byteLength ?? null, origin };
        });
      for (const name of [
        "Uint8Array",
        "Uint32Array",
        "Float32Array",
        "Float64Array",
      ]) {
        const original = window[name];
        let wrapper;
        wrapper = new Proxy(original, {
          construct(target, args, newTarget) {
            const view = Reflect.construct(
              target,
              args,
              newTarget === wrapper ? target : newTarget,
            );
            if (view.byteLength >= 1048576)
              window.__m2RememberBuffer(
                view.buffer,
                `${name}: ${new Error().stack?.split("\n").slice(2, 6).join(" | ")}`,
              );
            return view;
          },
        });
        window[name] = wrapper;
      }
    });
  }
  if (process.env.SCANFORGE_M2_FILE_LAYOUT === "1")
    await page.addInitScript(() => {
      window.__m2FileLayoutTrace = true;
    });
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.__splitTransportSamples = [];
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("project-encoding-worker")) {
          console.log(
            `M2_WORKER_TRACE ${JSON.stringify({ event: "encoder-start", at: performance.now() })}`,
          );
          this.addEventListener("message", (e) => {
            console.log(
              `M2_WORKER_TRACE ${JSON.stringify({ event: "encoder-message", at: performance.now() })}`,
            );
            if (window.__m2FileLayoutTrace && e.data?.file instanceof Blob) {
              void (async () => {
                const file = e.data.file;
                const header = await file.slice(0, 16).arrayBuffer();
                const manifestBytes = new DataView(header).getUint32(8, true);
                if (manifestBytes > 4 * 1024 * 1024)
                  throw Error("Manifest too large for layout trace");
                const manifest = JSON.parse(
                  await file.slice(16, 16 + manifestBytes).text(),
                );
                let pending = 0;
                const groups = [];
                for (const chunk of manifest.chunks) {
                  pending += chunk.bytes;
                  if (pending >= 64 * 1024 * 1024) {
                    groups.push(pending);
                    pending = 0;
                  }
                }
                console.log(
                  `M2_WORKER_TRACE ${JSON.stringify({ event: "encoder-layout", fileBytes: file.size, payloadGroups: groups, pendingBytes: pending, chunks: manifest.chunks.length })}`,
                );
              })().catch((error) =>
                console.log(
                  `M2_WORKER_TRACE ${JSON.stringify({ event: "encoder-layout-error", error: String(error) })}`,
                ),
              );
            }
          });
          this.addEventListener("error", () =>
            console.log(
              `M2_WORKER_TRACE ${JSON.stringify({ event: "encoder-error", at: performance.now() })}`,
            ),
          );
          const terminate = this.terminate.bind(this);
          this.terminate = () => {
            console.log(
              `M2_WORKER_TRACE ${JSON.stringify({ event: "encoder-terminate", at: performance.now() })}`,
            );
            terminate();
          };
        }
        if (String(url).includes("project-decoding-worker")) {
          console.log(
            `M2_WORKER_TRACE ${JSON.stringify({ event: "decoder-start", at: performance.now() })}`,
          );
          this.addEventListener("message", (e) => {
            const numbers = e.data?.packet?.numbers;
            console.log(
              `M2_WORKER_TRACE ${JSON.stringify({ event: "decoder-message", at: performance.now(), error: e.data?.error ?? null, numericBuffers: Array.isArray(numbers) ? numbers.length : null, numericBytes: Array.isArray(numbers) ? numbers.reduce((sum, item) => sum + (item.values?.byteLength ?? 0), 0) : null, numericSizes: Array.isArray(numbers) ? numbers.map((item) => ({ bytes: item.values?.byteLength ?? 0, shared: typeof SharedArrayBuffer !== "undefined" && item.values?.buffer instanceof SharedArrayBuffer })) : null })}`,
            );
          });
          this.addEventListener("error", () =>
            console.log(
              `M2_WORKER_TRACE ${JSON.stringify({ event: "decoder-error", at: performance.now() })}`,
            ),
          );
        }
        if (String(url).includes("processing-worker"))
          this.addEventListener("message", (e) => {
            if (window.__m2RememberBuffer && e.data.packedScanEdit)
              for (const [name, value] of Object.entries(e.data.packedScanEdit))
                if (ArrayBuffer.isView(value))
                  window.__m2RememberBuffer(
                    value.buffer,
                    `worker.packedScanEdit.${name}`,
                  );
            if (
              window.__m2RememberBuffer &&
              e.data.result?.scanEdit?.inventory?.components
            )
              for (const component of e.data.result.scanEdit.inventory
                .components)
                if (ArrayBuffer.isView(component.triangles))
                  window.__m2RememberBuffer(
                    component.triangles.buffer,
                    "worker.inventory.triangles",
                  );
            if (e.data.packedScanEdit) {
              const sample = {
                before: performance.memory?.usedJSHeapSize ?? null,
                positions: e.data.packedScanEdit.positions.length,
                vertices: e.data.packedScanEdit.vertices.length,
              };
              window.__splitTransportSamples.push(sample);
              queueMicrotask(() => {
                sample.after = performance.memory?.usedJSHeapSize ?? null;
              });
            }
            if (window.__holdSplitResult && e.data.result) {
              e.stopImmediatePropagation();
              window.__pendingSplitResult = true;
            }
          });
      }
    };
  });
  await page.goto(origin);
  if (process.env.SCANFORGE_M2_TRACE_BUFFERS === "1") {
    await page.evaluate(() => {
      const buffer = new ArrayBuffer(2 * 1024 * 1024);
      window.__m2RememberBuffer(buffer, "self-check");
    });
    const probe = await page.context().newCDPSession(page);
    await probe.send("HeapProfiler.collectGarbage");
    const check = await page.evaluate(() =>
      window.__m2BufferSummary().find((item) => item.origin === "self-check"),
    );
    assert(
      check && check.liveBytes === null,
      "Weak buffer tracking self-check failed",
    );
    ledger.bufferTraceSelfCheck = true;
    await probe.detach();
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "AI agents", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Local bridge URL" })
    .fill(`http://127.0.0.1:${bridgePort}`);
  await page.getByLabel("Pairing token", { exact: true }).fill(token);
  await page
    .getByRole("button", { name: "Connect agent", exact: true })
    .click();
  await page
    .getByText("Connected · agents control this workspace", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  const call = async (name, args = {}) => {
    try {
      const response = await client.callTool({ name, arguments: args });
      const wire =
        response.structuredContent ?? JSON.parse(response.content[0].text);
      assert(wire.ok, JSON.stringify(wire));
      return wire;
    } catch (error) {
      ledger.failedBridgeCommand = name;
      throw error;
    }
  };
  if (process.env.SCANFORGE_M2_ARTIFACT_EXACT_CONTROL === "1") {
    const source = Buffer.alloc(262145);
    for (let i = 0; i < source.length; i++) source[i] = (i * 37 + 13) & 255;
    const upload = (await call("artifact_put", {name:"worker-control.bin", offset:0, base64:source.toString("base64")})).result;
    for (const [offset, length] of [[0,262144],[262144,1],[source.length,1]]) {
      const part = (await call("artifact_read", {artifactId:upload.artifactId, offset, length})).result;
      assert.deepEqual(Buffer.from(part.base64,"base64"), source.subarray(offset,offset+length));
      assert.equal(part.nextOffset, Math.min(offset+length,source.length));
      assert.equal(part.eof,part.nextOffset===source.length);
    }
    await call("artifact_delete", {artifactId:upload.artifactId});
    console.log(JSON.stringify({artifactExactControl:"passed",bytes:source.length}));
  }
  const idle = async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = (await call("session_get")).result;
      if (!state.busy && state.activeJobId === null) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Workspace did not settle before split validation");
  };
  const mutate = async (name, args) => {
    await idle();
    return call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  };
  const job = async (receipt, expected = "succeeded") => {
    let lastStage;
    for (let i = 0; i < 1800; i++) {
      const state = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      if (
        process.env.SCANFORGE_M2_LOG_JOB === "1" &&
        state.stage !== lastStage
      ) {
        lastStage = state.stage;
        (ledger.jobStages ??= []).push({
          stage: state.stage,
          status: state.status,
          progress: state.progress,
        });
        console.log(
          JSON.stringify({
            jobStage: state.stage,
            status: state.status,
            progress: state.progress,
          }),
        );
      }
      if (state.status !== "running") {
        assert.equal(state.status, expected, JSON.stringify(state));
        return state;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Geometry job timeout");
  };

  const artifactJson = async (artifact) => {
    const chunks = [];
    for (let offset = 0; offset < artifact.bytes;) {
      const read = (
        await call("artifact_read", {
          artifactId: artifact.artifactId,
          offset,
          length: 262144,
        })
      ).result;
      const chunk = Buffer.from(read.base64, "base64");
      assert(chunk.length > 0);
      chunks.push(chunk);
      offset += chunk.length;
    }
    await call("artifact_delete", { artifactId: artifact.artifactId });
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  const geometry = async (entityId = "scan") => {
    await idle();
    return (
      await artifactJson(
        (await call("object_get", { entityId, includeGeometry: true })).result
          .geometry,
      )
    ).positions;
  };
  const digest = (positions) =>
    createHash("sha256")
      .update(Buffer.from(new Float32Array(positions).buffer))
      .digest("hex");
  const rawEqual = (actual, expected, message) =>
    assert.equal(digest(actual), digest(expected), message);

  const original = process.env.SCANFORGE_M2_ORIGINAL_PLY;
  assert(original, "Original PLY path is required");
  const bounds = JSON.parse(
    await readFile(process.env.SCANFORGE_M2_ORIGINAL_BOUNDS, "utf8"),
  );
  if (bounds.finiteInteriorControl)
    assert.equal(
      createHash("sha256")
        .update(await readFile(original))
        .digest("hex"),
      bounds.sha256,
    );
  ledger.stages = [];
  const memoryProfile =
    process.env.SCANFORGE_M2_MEMORY_PROFILE === "1"
      ? await page.context().newCDPSession(page)
      : null;
  const stage = async (name) => {
    if (process.env.SCANFORGE_M2_PROCESS_PROFILE === "1" &&
        ["gui-extract-preexisting-project", "gui-extract-preexisting-export-read", "gui-extract-preexisting-export-deleted", "gui-extract-post-gc-profile"].includes(name)) {
      const script = `$all = @(Get-CimInstance Win32_Process); $ids = [System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${process.pid}); do { $added = 0; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added++ } } } while ($added -gt 0); @(Get-Process -Id @($ids) -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,PrivateMemorySize64,WorkingSet64,@{n='ChromeType';e={ $procId = $_.Id; $row = $all | Where-Object { $_.ProcessId -eq $procId }; if ($row.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { 'browser-or-other' } }}) | ConvertTo-Json -Compress`;
      const sample = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {encoding:"utf8",timeout:15000,windowsHide:true});
      console.log(JSON.stringify({ processProfile: name, status: sample.status, processes: sample.status === 0 ? JSON.parse(sample.stdout) : null, error: sample.status === 0 ? undefined : sample.stderr }));
    }
    const browserHeap = await page.evaluate(() => {
      const memory = performance.memory;
      return memory
        ? {
            used: memory.usedJSHeapSize,
            total: memory.totalJSHeapSize,
            limit: memory.jsHeapSizeLimit,
          }
        : null;
    });
    const entry = {
      name,
      at: new Date().toISOString(),
      harness: process.memoryUsage(),
      browserHeap,
      ...(memoryProfile
        ? { cdpHeap: await memoryProfile.send("Runtime.getHeapUsage") }
        : {}),
    };
    ledger.stages.push(entry);
    console.log(JSON.stringify({ stage: entry }));
    if (
      [
        "component-inventory-ready",
        "gui-extract-committed",
        "gui-extract-project-imported",
      ].includes(name) &&
      process.env.SCANFORGE_M2_TRACE_BUFFERS === "1"
    ) {
      const buffers = await page.evaluate(() => window.__m2BufferSummary());
      const key =
        name === "component-inventory-ready"
          ? "inventoryBuffersBeforeGc"
          : name === "gui-extract-committed"
            ? "extractBuffersBeforeGc"
            : "importBuffersBeforeGc";
      ledger[key] = buffers;
      console.log(JSON.stringify({ [key]: buffers }));
    }
    if (memoryProfile && process.env.SCANFORGE_M2_ALLOCATION_PROFILE === "1") {
      if (name === "gui-split-committed" || name === "gui-extract-undone")
        await memoryProfile.send("HeapProfiler.startSampling", {
          samplingInterval: 1048576,
          includeObjectsCollectedByMajorGC: true,
          includeObjectsCollectedByMinorGC: true,
        });
      if (
        name === "gui-extract-committed" ||
        name === "mcp-extract-committed"
      ) {
        const { profile } = await memoryProfile.send(
          "HeapProfiler.stopSampling",
        );
        const totals = new Map();
        const callers = new Map();
        const visit = (node, parents = []) => {
          const key = `${node.callFrame.functionName || "(anonymous)"} ${node.callFrame.url}:${node.callFrame.lineNumber + 1}`;
          totals.set(key, (totals.get(key) || 0) + node.selfSize);
          if (["next", "every", "from"].includes(node.callFrame.functionName)) {
            const path = [...parents.slice(-4), key].join(" <- ");
            callers.set(path, (callers.get(path) || 0) + node.selfSize);
          }
          for (const child of node.children) visit(child, [...parents, key]);
        };
        visit(profile.head);
        console.log(
          JSON.stringify({
            allocationSample: name,
            top: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 20),
            callers: [...callers].sort((a, b) => b[1] - a[1]).slice(0, 20),
          }),
        );
      }
    }
    if (
      memoryProfile &&
      process.env.SCANFORGE_M2_DIAGNOSTIC_GC === "1" &&
      [
        "component-inventory-ready",
        "gui-extract-committed",
        "gui-extract-undone",
        "mcp-extract-committed",
        "gui-extract-project-imported",
        "gui-extract-preexisting-export-deleted",
      ].includes(name) &&
      (!process.env.SCANFORGE_M2_DIAGNOSTIC_GC_STAGES ||
        process.env.SCANFORGE_M2_DIAGNOSTIC_GC_STAGES.split(",").includes(name))
    ) {
      await memoryProfile.send("HeapProfiler.collectGarbage");
      if (
        [
          "component-inventory-ready",
          "gui-extract-committed",
          "gui-extract-project-imported",
        ].includes(name) &&
        process.env.SCANFORGE_M2_TRACE_BUFFERS === "1"
      ) {
        const buffers = await page.evaluate(() => window.__m2BufferSummary());
        const key =
          name === "component-inventory-ready"
            ? "inventoryBuffersAfterGc"
            : name === "gui-extract-committed"
              ? "extractBuffersAfterGc"
              : "importBuffersAfterGc";
        ledger[key] = buffers;
        console.log(JSON.stringify({ [key]: buffers }));
      }
      console.log(
        JSON.stringify({
          diagnosticGc: name,
          cdpHeap: await memoryProfile.send("Runtime.getHeapUsage"),
        }),
      );
    }
    if (memoryProfile && process.env.SCANFORGE_M2_DIGEST_PROFILE === "1") {
      if (name === "mcp-extract-committed")
        await memoryProfile.send("HeapProfiler.startSampling", {
          samplingInterval: 1048576,
          includeObjectsCollectedByMajorGC: true,
          includeObjectsCollectedByMinorGC: true,
        });
      if (name === "gui-mcp-extract-verified") {
        const { profile } = await memoryProfile.send(
          "HeapProfiler.stopSampling",
        );
        const totals = new Map();
        const visit = (node) => {
          const key = `${node.callFrame.functionName || "(anonymous)"} ${node.callFrame.url}:${node.callFrame.lineNumber + 1}`;
          totals.set(key, (totals.get(key) || 0) + node.selfSize);
          for (const child of node.children) visit(child);
        };
        visit(profile.head);
        console.log(
          JSON.stringify({
            digestAllocationSample: [...totals]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20),
          }),
        );
      }
    }
  };
  ledger.crossOriginIsolated = await page.evaluate(() => crossOriginIsolated);
  if (process.env.SCANFORGE_QA_ISOLATED === "1")
    assert.equal(ledger.crossOriginIsolated, true);
  const geometryDigest = async (entityId) =>
    (
      await job(await call("object_geometry_digest", { entityId }))
    ).result.buffers.map(({ path, encoding, elements, sha256 }) => ({
      path,
      encoding,
      elements,
      sha256,
    }));
  await page
    .locator('input[type=file][accept*=".stl"]')
    .setInputFiles(original);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .locator('.status-message[title^="Opened · 1/1 files"]')
    .waitFor({ timeout: 180000 });
  const initial = (await call("project_get")).result;
  assert.equal(initial.objects.length, 1);
  const sourceId = initial.objects[0].id;
  await stage("source-imported");
  const inputDigest = await geometryDigest(sourceId);
  await stage("source-digest");
  const x = Math.fround((bounds.min[0] + bounds.max[0]) / 2);
  const margin = Math.max(
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
    1,
  );
  const vertices = bounds.cutterVertices ?? [
    [x, bounds.min[1] - margin, bounds.min[2] - margin],
    [x, bounds.min[1] - margin, bounds.max[2] + 3 * margin],
    [x, bounds.max[1] + 3 * margin, bounds.min[2] - margin],
  ];
  const stl = `solid cutter\nfacet normal 1 0 0\nouter loop\n${vertices.map((v) => `vertex ${v.join(" ")}`).join("\n")}\nendloop\nendfacet\nendsolid cutter\n`;
  const artifact = (
    await call("artifact_put", {
      name: "cutter.stl",
      offset: 0,
      base64: Buffer.from(stl).toString("base64"),
    })
  ).result;
  const imported = await job(
    await mutate("project_import", {
      artifactId: artifact.artifactId,
      unit: "mm",
      placeAtOrigin: false,
    }),
  );
  const cutterId = imported.result.entityId;
  await call("artifact_delete", { artifactId: artifact.artifactId });
  const cutterDigest = await geometryDigest(cutterId);
  await stage("cutter-imported");
  await mutate("object_select", { entityId: sourceId });
  await mutate("ui_set", { workspace: "mesh", toolPanelOpen: true });
  const baseline = (await call("project_get")).result.undo;
  await mutate("command_run", { name: "ribbon:splitMesh" });
  const panel = page.getByRole("region", { name: "Split mesh", exact: true });
  await panel.waitFor();
  await panel.locator(".app-select > button").click();
  await page.getByRole("option", { name: "cutter.stl", exact: true }).click();
  await panel.getByRole("button", { name: "Split mesh", exact: true }).click();
  await stage("gui-split-started");
  let guiState;
  for (let i = 0; i < 2400; i++) {
    const state = (await call("session_get")).result;
    if (!state.busy && state.activeJobId === null) {
      guiState = (await call("project_get")).result;
      if (guiState.undo > baseline) break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(guiState?.undo, baseline + 1, "GUI Split did not commit");
  assert.equal(guiState.objects.find((o) => o.id === sourceId).visible, true);
  await stage("gui-split-committed");
  ledger.transportSamples = await page.evaluate(
    () => window.__splitTransportSamples,
  );
  console.log(JSON.stringify({ transportSamples: ledger.transportSamples }));
  const guiDigest = await geometryDigest(sourceId);
  await stage("gui-output-digest");
  if (bounds.finiteInteriorControl) {
    const data = await artifactJson(
      (await call("object_get", { entityId: sourceId, includeGeometry: true }))
        .result.geometry,
    );
    const { vertices, triangles } = data.indexedMesh;
    const edges = new Map();
    for (let i = 0; i < triangles.length; i += 3)
      for (let side = 0; side < 3; side++) {
        const a = triangles[i + side],
          b = triangles[i + ((side + 1) % 3)];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const item = edges.get(key) ?? { a, b, count: 0 };
        item.count++;
        edges.set(key, item);
      }
    let seamLength = 0;
    for (const { a, b, count } of edges.values()) {
      if (count !== 1) continue;
      const ax = vertices[3 * a],
        ay = vertices[3 * a + 1];
      const bx = vertices[3 * b],
        by = vertices[3 * b + 1];
      const seam =
        Math.abs(ax - 0.5) < 1e-8 &&
        Math.abs(bx - 0.5) < 1e-8 &&
        Math.min(ay, by) >= 0.1 - 1e-7 &&
        Math.max(ay, by) <= 0.2 + 1e-7;
      const perimeter =
        (ax === 0 && bx === 0) ||
        (ay === 0 && by === 0) ||
        (Math.abs(ax + ay - 1) < 1e-8 && Math.abs(bx + by - 1) < 1e-8);
      assert(
        seam || perimeter,
        "Split created an edge outside the finite cutter or source perimeter",
      );
      if (seam) seamLength += Math.hypot(ax - bx, ay - by);
    }
    assert(
      Math.abs(seamLength - 0.2) < 1e-6,
      "Finite seam boundary length changed",
    );
    ledger.finiteInteriorBoundaryLength = seamLength;
  }
  assert.deepEqual(
    await geometryDigest(cutterId),
    cutterDigest,
    "GUI changed cutter",
  );
  await page.screenshot({
    path: fileURLToPath(new URL("original-split-gui.png", out)),
  });
  if (
    ["gui-extract", "gui-only"].includes(
      process.env.SCANFORGE_M2_ORIGINAL_COMPONENT,
    )
  ) {
    const core = (records) =>
      records.filter((record) =>
        ["positions", "indexedMesh.vertices", "indexedMesh.triangles"].includes(
          record.path,
        ),
      );
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await mutate("command_run", { name: "ribbon:editScan" });
    await page
      .getByRole("button", { name: "Edit individual meshes", exact: true })
      .click();
    await stage("component-inventory-opened");
    const controls = page.getByRole("region", {
      name: "Individual meshes",
      exact: true,
    });
    await controls
      .getByRole("button", { name: /^Mesh 1 ·/ })
      .waitFor({ timeout: 180000 });
    await stage("component-inventory-ready");
    const before = (await call("project_get")).result.undo;
    await controls
      .getByRole("button", { name: "Create new object", exact: true })
      .click();
    for (let i = 0; i < 2400; i++) {
      const current = (await call("project_get")).result;
      if (current.undo > before) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const guiStateAfter = (await call("project_get")).result;
    assert.equal(guiStateAfter.undo, before + 1, "GUI Extract did not commit");
    const guiPart = guiStateAfter.objects.find(
      (object) => object.id !== sourceId && object.id !== cutterId,
    );
    assert(guiPart, "GUI Extract did not create an object");
    await stage("gui-extract-committed");
    if (process.env.SCANFORGE_M2_PAGE_HEARTBEAT === "1") {
      let inFlight = false;
      heartbeatTimer = setInterval(() => {
        if (inFlight) return;
        inFlight = true;
        const started = Date.now();
        heartbeatTimeout = setTimeout(() => {
          console.log(
            JSON.stringify({
              pageHeartbeat: "timeout",
              started,
              timeoutMs: 3000,
            }),
          );
          (ledger.pageHeartbeats ??= []).push({ status: "timeout", started });
        }, 3000);
        page
          .evaluate(() => performance.now())
          .then(
            () => {
              clearTimeout(heartbeatTimeout);
              const elapsedMs = Date.now() - started;
              console.log(
                JSON.stringify({ pageHeartbeat: "response", elapsedMs }),
              );
              (ledger.pageHeartbeats ??= []).push({
                status: "response",
                elapsedMs,
              });
              inFlight = false;
            },
            (error) => {
              clearTimeout(heartbeatTimeout);
              console.log(
                JSON.stringify({
                  pageHeartbeat: "error",
                  message: error.message,
                }),
              );
              (ledger.pageHeartbeats ??= []).push({
                status: "error",
                message: error.message,
              });
              inFlight = false;
            },
          );
      }, 1000);
    }
    const profileGuiDigest =
      memoryProfile && process.env.SCANFORGE_M2_GUI_DIGEST_PROFILE === "1";
    if (profileGuiDigest)
      await memoryProfile.send("HeapProfiler.startSampling", {
        samplingInterval: 1048576,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
    const guiPartDigest = core(await geometryDigest(guiPart.id));
    if (profileGuiDigest) {
      const { profile } = await memoryProfile.send("HeapProfiler.stopSampling");
      const totals = new Map();
      const visit = (node) => {
        const key = `${node.callFrame.functionName || "(anonymous)"} ${node.callFrame.url}:${node.callFrame.lineNumber + 1}`;
        totals.set(key, (totals.get(key) || 0) + node.selfSize);
        for (const child of node.children) visit(child);
      };
      visit(profile.head);
      const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 30);
      ledger.guiDigestAllocationSample = top;
      console.log(JSON.stringify({ guiDigestAllocationSample: top }));
    }
    assert.equal(guiPartDigest.length, 3, "GUI Extract lost indexed geometry");
    await mutate("history_undo", {});
    await stage("gui-extract-undone");
    assert.deepEqual(
      core(await geometryDigest(sourceId)),
      core(guiDigest),
      "GUI Extract Undo changed source",
    );
    await stage("gui-extract-undo-digest-verified");
    if (process.env.SCANFORGE_M2_ORIGINAL_COMPONENT === "gui-only") {
      await mutate("history_redo", {});
      assert.deepEqual(
        core(await geometryDigest(guiPart.id)),
        guiPartDigest,
        "GUI Extract Redo changed geometry",
      );
      assert.deepEqual(
        core(await geometryDigest(sourceId)),
        core(guiDigest),
        "GUI Extract changed source",
      );
      assert.deepEqual(
        await geometryDigest(cutterId),
        cutterDigest,
        "GUI Extract changed cutter",
      );
      if (process.env.SCANFORGE_M2_EXTRACT_REOPEN === "1") {
        const existingProject = process.env.SCANFORGE_M2_PREEXISTING_PROJECT;
        const saved = existingProject && process.env.SCANFORGE_M2_PREEXISTING_EXPORT !== "1" ? undefined : await job(
          await call("project_export", { format: "project" }),
        );
        await stage(existingProject ? "gui-extract-preexisting-project" : "gui-extract-project-exported");
        if (existingProject && saved) {
          if (process.env.SCANFORGE_M2_PREEXISTING_EXPORT_READ === "1") {
            const downloadHash = createHash("sha256");
            for (let offset = 0; offset < saved.result.bytes;) {
              const part = (await call("artifact_read", {artifactId: saved.result.artifactId, offset, length: 262144})).result;
              assert(part.nextOffset > offset, "Artifact read made no progress");
              const bytes = Buffer.from(part.base64, "base64");
              assert.equal(bytes.length, part.nextOffset - offset, "Artifact chunk length mismatch");
              downloadHash.update(bytes);
              offset = part.nextOffset;
            }
            console.log(JSON.stringify({ artifactDownloadSha256: downloadHash.digest("hex"), bytes: saved.result.bytes }));
            await stage("gui-extract-preexisting-export-read");
          }
          await call("artifact_delete", { artifactId: saved.result.artifactId });
          await stage("gui-extract-preexisting-export-deleted");
          if (process.env.SCANFORGE_M2_PROCESS_PROFILE_GC === "1") {
            await memoryProfile.send("HeapProfiler.collectGarbage");
            await stage("gui-extract-post-gc-profile");
          }
          if (process.env.SCANFORGE_M2_STOP_AFTER_PROCESS_PROFILE === "1")
            throw Error("Intentional diagnostic stop after artifact deletion; reopen was not attempted");
        }
        if (process.env.SCANFORGE_M2_GUI_REOPEN === "1") {
          const path = existingProject || fileURLToPath(new URL("gui-reopen.scanforge", out));
          if (!existingProject) {
          const file = await open(path, "wx");
          const downloadHash = createHash("sha256");
          try {
            for (let offset = 0; offset < saved.result.bytes;) {
              const chunk = (
                await call("artifact_read", {
                  artifactId: saved.result.artifactId,
                  offset,
                  length: 262144,
                })
              ).result;
              const bytes = Buffer.from(chunk.base64, "base64");
              assert(bytes.length > 0, "Artifact read returned no data");
              assert.equal(bytes.length, chunk.nextOffset - offset, "Artifact chunk length mismatch");
              downloadHash.update(bytes);
              await file.writeFile(bytes);
              offset += bytes.length;
            }
          } finally {
            await file.close();
          }
          console.log(JSON.stringify({artifactDownloadSha256:downloadHash.digest("hex"),bytes:saved.result.bytes}));
          await stage("gui-extract-project-downloaded");
          await call("artifact_delete", { artifactId: saved.result.artifactId });
          }
          page.on("dialog", (dialog) => {
            console.log(JSON.stringify({ guiReopenDialog: dialog.type(), message: dialog.message() }));
            void dialog.accept();
          });
          if (process.env.SCANFORGE_M2_GUI_CDP_LOCAL === "1") {
            const cdp = await page.context().newCDPSession(page);
            const { root } = await cdp.send("DOM.getDocument");
            const { nodeId } = await cdp.send("DOM.querySelector", {
              nodeId: root.nodeId,
              selector: 'input[type="file"][accept*=".scanforge"]',
            });
            assert(nodeId, "GUI project file input was not found");
            await cdp.send("DOM.setFileInputFiles", { nodeId, files: [path] });
            await cdp.detach();
          } else {
            await page.locator('input[type="file"][accept*=".scanforge"]').setInputFiles(path);
          }
          console.log(JSON.stringify({ guiReopen: "file-input-set" }));
          try {
            await page.locator('.status-message[title^="Opened · 1/1 files"]').waitFor({timeout: 120000});
          } catch (error) {
            const probe = await Promise.race([
              page.evaluate(() => ({
                status: [...document.querySelectorAll('.status-message')].map(e => ({title:e.getAttribute('title'),text:e.textContent})),
                errors: [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent),
              })).catch(e => ({ error: String(e) })),
              new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 5000)),
            ]);
            console.log(JSON.stringify({ guiReopenFailureProbe: probe, errors, consoleErrors }));
            throw error;
          }
          await idle();
          await stage("gui-extract-gui-project-imported");
          if (existingProject) {
            const project = (await call("project_get")).result;
            const all = [];
            for (const object of project.objects) all.push(core(await geometryDigest(object.id)));
            const strings = all.map(value => JSON.stringify(value));
            for (const expected of [guiPartDigest, core(guiDigest), core(cutterDigest)])
              assert(strings.includes(JSON.stringify(expected)), "GUI reopen geometry not found");
          } else {
          assert.deepEqual(core(await geometryDigest(guiPart.id)), guiPartDigest, "GUI reopen changed Extract geometry");
          assert.deepEqual(core(await geometryDigest(sourceId)), core(guiDigest), "GUI reopen changed Extract source");
          assert.deepEqual(await geometryDigest(cutterId), cutterDigest, "GUI reopen changed cutter");
          }
          await stage("gui-extract-gui-reopen-verified");
          await page.getByRole("tab", { name: "Edit / View", exact: true }).click();
          await page.getByRole("button", { name: "Undo", exact: true }).click();
          for (let attempt = 0; attempt < 120; attempt++) {
            if (!(await call("project_get")).result.objects.some(object => object.id === guiPart.id)) break;
            await page.waitForTimeout(100);
          }
          assert(!(await call("project_get")).result.objects.some(object => object.id === guiPart.id), "GUI Undo retained the extracted object");
          assert.deepEqual(core(await geometryDigest(sourceId)), core(guiDigest), "GUI post-reopen Undo changed source geometry");
          await stage("gui-extract-reopen-gui-undo-verified");
          await page.getByRole("button", { name: "Redo", exact: true }).click();
          for (let attempt = 0; attempt < 120; attempt++) {
            if ((await call("project_get")).result.objects.some(object => object.id === guiPart.id)) break;
            await page.waitForTimeout(100);
          }
          assert((await call("project_get")).result.objects.some(object => object.id === guiPart.id), "GUI Redo did not restore the extracted object");
          assert.deepEqual(core(await geometryDigest(guiPart.id)), guiPartDigest, "GUI post-reopen Redo changed extracted geometry");
          await stage("gui-extract-reopen-gui-redo-verified");
          if (!existingProject) await unlink(path);
        } else {
        if (process.env.SCANFORGE_M2_EXTRACT_REOPEN_FRESH === "1") {
          await mutate("project_new", { discard: true });
          await stage("gui-extract-fresh-project");
        }
        await job(
          await mutate("project_import", {
            artifactId: saved.result.artifactId,
            replace: true,
          }),
        );
        await stage("gui-extract-project-imported");
        await stage("gui-extract-artifact-delete-started");
        await call("artifact_delete", { artifactId: saved.result.artifactId });
        await stage("gui-extract-artifact-deleted");
        await stage("gui-extract-reopen-part-digest-started");
        assert.deepEqual(
          core(await geometryDigest(guiPart.id)),
          guiPartDigest,
          "Reopen changed Extract geometry",
        );
        await stage("gui-extract-reopen-part-digest-verified");
        assert.deepEqual(
          core(await geometryDigest(sourceId)),
          core(guiDigest),
          "Reopen changed Extract source",
        );
        assert.deepEqual(
          await geometryDigest(cutterId),
          cutterDigest,
          "Reopen changed cutter",
        );
        await stage("gui-extract-reopen-verified");
        }
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      ledger.result = {
        inputSha256: bounds.sha256,
        inputFaces: initial.objects[0].triangles,
        splitFaces: guiState.objects.find((o) => o.id === sourceId).triangles,
        extractedFaces: guiPart.triangles,
        guiOutputDigest: guiPartDigest,
        indexedResult: true,
        sourcePreserved: true,
        cutterPreserved: true,
        guiUndoRedo: true,
        ...(process.env.SCANFORGE_M2_EXTRACT_REOPEN === "1"
          ? { binaryReopen: true }
          : {}),
        pageErrors: errors,
        consoleErrors,
      };
      await stage("gui-extract-redo-verified");
      console.log(JSON.stringify(ledger.result));
    } else {
      const mcp = await job(
        await mutate("mesh_process", {
          entityId: sourceId,
          operation: {
            kind: "scanEdit",
            action: "componentExtract",
            indices: [0],
          },
        }),
      );
      const mcpState = (await call("project_get")).result;
      const mcpPart = mcpState.objects.find(
        (object) => object.id !== sourceId && object.id !== cutterId,
      );
      assert(mcpPart, "MCP Extract did not create an object");
      await stage("mcp-extract-committed");
      assert.deepEqual(
        core(await geometryDigest(mcpPart.id)),
        guiPartDigest,
        "GUI and MCP Extract geometry differ",
      );
      assert.deepEqual(
        core(await geometryDigest(sourceId)),
        core(guiDigest),
        "Extract changed source",
      );
      assert.deepEqual(
        await geometryDigest(cutterId),
        cutterDigest,
        "Extract changed cutter",
      );
      await stage("gui-mcp-extract-verified");
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      ledger.result = {
        inputSha256: bounds.sha256,
        inputFaces: initial.objects[0].triangles,
        splitFaces: guiState.objects.find((o) => o.id === sourceId).triangles,
        extractedFaces: guiPart.triangles,
        diagnostics: mcp.result.diagnostics,
        guiMcpEqual: true,
        indexedResult: true,
        sourcePreserved: true,
        cutterPreserved: true,
        guiUndo: true,
        pageErrors: errors,
        consoleErrors,
      };
      console.log(JSON.stringify(ledger.result));
    }
  } else if (process.env.SCANFORGE_M2_ORIGINAL_COMPONENT === "extract") {
    const core = (records) =>
      records.filter((record) =>
        ["positions", "indexedMesh.vertices", "indexedMesh.triangles"].includes(
          record.path,
        ),
      );
    const extracted = await job(
      await mutate("mesh_process", {
        entityId: sourceId,
        operation: {
          kind: "scanEdit",
          action: "componentExtract",
          indices: [0],
        },
      }),
    );
    await stage("component-extract-committed");
    const state = (await call("project_get")).result;
    const created = state.objects.find(
      (object) => object.id !== sourceId && object.id !== cutterId,
    );
    assert(created, "Extraction did not create an object");
    assert.equal(
      state.objects.find((object) => object.id === sourceId).visible,
      false,
    );
    const extractedDigest = core(await geometryDigest(created.id));
    assert.equal(extractedDigest.length, 3, "Extraction lost indexed geometry");
    assert.deepEqual(
      core(await geometryDigest(sourceId)),
      core(guiDigest),
      "Extraction changed source",
    );
    assert.deepEqual(
      await geometryDigest(cutterId),
      cutterDigest,
      "Extraction changed cutter",
    );
    await mutate("history_undo", {});
    assert.deepEqual(
      core(await geometryDigest(sourceId)),
      core(guiDigest),
      "Extraction Undo changed source",
    );
    assert.equal(
      (await call("project_get")).result.objects.some(
        (object) => object.id === created.id,
      ),
      false,
    );
    await mutate("history_redo", {});
    assert.deepEqual(
      core(await geometryDigest(created.id)),
      extractedDigest,
      "Extraction Redo changed geometry",
    );
    await stage("component-extract-redo-verified");
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    ledger.result = {
      inputSha256: bounds.sha256,
      inputFaces: initial.objects[0].triangles,
      splitFaces: guiState.objects.find((o) => o.id === sourceId).triangles,
      extractedFaces: created.triangles,
      mcpOutputDigest: extractedDigest,
      diagnostics: extracted.result.diagnostics,
      indexedResult: true,
      sourcePreserved: true,
      cutterPreserved: true,
      undoRedo: true,
      pageErrors: errors,
      consoleErrors,
    };
    console.log(JSON.stringify(ledger.result));
  } else if (process.env.SCANFORGE_M2_ORIGINAL_COMPONENT === "1") {
    const core = (records) =>
      records.filter((record) =>
        ["positions", "indexedMesh.vertices", "indexedMesh.triangles"].includes(
          record.path,
        ),
      );
    const flipped = await job(
      await mutate("mesh_process", {
        entityId: sourceId,
        operation: { kind: "scanEdit", action: "componentFlip", indices: [0] },
      }),
    );
    await stage("component-flip-committed");
    const flippedDigest = await geometryDigest(sourceId);
    assert.equal(
      core(flippedDigest).length,
      3,
      "Component Flip lost indexed geometry",
    );
    assert.notEqual(
      core(flippedDigest)[0].sha256,
      core(guiDigest)[0].sha256,
      "Component Flip did not change winding",
    );
    assert.deepEqual(
      await geometryDigest(cutterId),
      cutterDigest,
      "Component Flip changed cutter",
    );
    await mutate("history_undo", {});
    assert.deepEqual(
      core(await geometryDigest(sourceId)),
      core(guiDigest),
      "Component Undo changed Split geometry",
    );
    await mutate("history_redo", {});
    assert.deepEqual(
      core(await geometryDigest(sourceId)),
      core(flippedDigest),
      "Component Redo changed geometry",
    );
    await stage("component-redo-verified");
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    ledger.result = {
      inputSha256: bounds.sha256,
      inputFaces: initial.objects[0].triangles,
      splitFaces: guiState.objects.find((o) => o.id === sourceId).triangles,
      diagnostics: flipped.result.diagnostics,
      indexedResult: true,
      cutterPreserved: true,
      undoRedo: true,
      pageErrors: errors,
      consoleErrors,
    };
    console.log(JSON.stringify(ledger.result));
  } else {
    await mutate("history_undo", {});
    assert.deepEqual(
      await geometryDigest(sourceId),
      inputDigest,
      "Undo changed original buffers",
    );
    await stage("gui-undo-verified");
    if (process.env.SCANFORGE_M2_GC_PROBE === "1") {
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send("HeapProfiler.collectGarbage");
      } finally {
        await cdp.detach();
      }
      await stage("gui-undo-after-diagnostic-gc");
    }
    const mcp = await job(
      await mutate("mesh_process", {
        entityId: sourceId,
        targetId: cutterId,
        operation: { kind: "scanEdit", action: "split" },
      }),
    );
    await stage("mcp-split-committed");
    assert.deepEqual(mcp.result.entityIds, [sourceId]);
    assert.deepEqual(
      await geometryDigest(sourceId),
      guiDigest,
      "GUI and MCP geometry differ",
    );
    assert.deepEqual(
      await geometryDigest(cutterId),
      cutterDigest,
      "MCP changed cutter",
    );
    await mutate("history_undo", {});
    assert.deepEqual(
      await geometryDigest(sourceId),
      inputDigest,
      "MCP Undo changed original buffers",
    );
    await mutate("history_redo", {});
    const redoDigest = await geometryDigest(sourceId);
    const core = (records) =>
      records.filter((record) =>
        ["positions", "indexedMesh.vertices", "indexedMesh.triangles"].includes(
          record.path,
        ),
      );
    assert.deepEqual(
      core(redoDigest),
      core(guiDigest),
      "MCP Redo changed positions or indices",
    );
    const extra = redoDigest.filter(
      (record) => !guiDigest.some((prior) => prior.path === record.path),
    );
    assert.deepEqual(extra.map((record) => record.path).sort(), [
      "indexedMesh.facetNormals",
      "indexedMesh.geometryNormals",
    ]);
    assert.equal(
      extra.find((record) => record.path === "indexedMesh.geometryNormals")
        .elements,
      core(redoDigest).find((record) => record.path === "indexedMesh.vertices")
        .elements,
    );
    assert.equal(
      extra.find((record) => record.path === "indexedMesh.facetNormals")
        .elements,
      core(redoDigest).find((record) => record.path === "indexedMesh.triangles")
        .elements,
    );
    await stage("mcp-redo-digest");
    await mutate("history_undo", {});
    assert.deepEqual(
      await geometryDigest(sourceId),
      inputDigest,
      "Second Undo changed original buffers",
    );
    await mutate("history_redo", {});
    assert.deepEqual(
      await geometryDigest(sourceId),
      redoDigest,
      "Repeated Redo changed the geometry or computed normals",
    );
    if (bounds.finiteInteriorControl) {
      const saved = await job(
        await call("project_export", { format: "project" }),
      );
      await job(
        await mutate("project_import", {
          artifactId: saved.result.artifactId,
          replace: true,
        }),
      );
      await call("artifact_delete", { artifactId: saved.result.artifactId });
      assert.deepEqual(
        core(await geometryDigest(sourceId)),
        core(redoDigest),
        "Reopen changed split geometry",
      );
      assert.deepEqual(
        await geometryDigest(cutterId),
        cutterDigest,
        "Reopen changed cutter",
      );
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    ledger.result = {
      inputSha256: bounds.sha256,
      inputFaces: initial.objects[0].triangles,
      outputFaces: guiState.objects.find((o) => o.id === sourceId).triangles,
      diagnostics: mcp.result.diagnostics,
      guiMcpDigestEqual: true,
      sourceUndo: true,
      cutterPreserved: true,
      redo: true,
      redoInitializedComputedNormals: extra,
      ...(bounds.finiteInteriorControl
        ? {
            finiteInteriorBoundaryLength: ledger.finiteInteriorBoundaryLength,
            binaryReopen: true,
          }
        : {}),
      pageErrors: errors,
      consoleErrors,
    };
    console.log(JSON.stringify(ledger.result));
  }
} catch (error) {
  await page
    ?.screenshot({ path: fileURLToPath(new URL("failure.png", out)) })
    .catch(() => {});
  failed = error;
  throw error;
} finally {
  clearTimeout(deadline);
  clearInterval(heartbeatTimer);
  clearTimeout(heartbeatTimeout);
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  if (reserve?.listening)
    await new Promise((resolve) => reserve.close(resolve));
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  ledger.cleanup = [];
  for (const resource of ledger.resources) {
    if (resource.pid) {
      let exited = false;
      try {
        process.kill(resource.pid, 0);
      } catch {
        exited = true;
      }
      ledger.cleanup.push({ pid: resource.pid, exited });
      if (!exited)
        failed ??= Error(`Owned helper ${resource.pid} did not exit`);
    }
    if (resource.port) {
      let closed = false;
      try {
        await fetch(`http://127.0.0.1:${resource.port}`, {
          signal: AbortSignal.timeout(1000),
        });
      } catch {
        closed = true;
      }
      ledger.cleanup.push({ port: resource.port, closed });
      if (!closed)
        failed ??= Error(`Owned port ${resource.port} remained open`);
    }
  }
  await unlink(fixturePath).catch((error) => {
    if (error.code !== "ENOENT") failed ??= error;
  });
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("split-lifecycle-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}

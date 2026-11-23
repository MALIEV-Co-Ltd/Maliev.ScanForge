import assert from "node:assert/strict";
import { freemem } from "node:os";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
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
      "--js-flags=--max-old-space-size=2048",
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
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.__splitTransportSamples = [];
    window.__processingWorkers = { created: 0, terminated: 0 };
    window.Worker = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.__isProcessingWorker = String(url).includes("processing-worker");
        if (this.__isProcessingWorker) {
          window.__processingWorkers.created++;
          this.addEventListener("message", (e) => {
            if (
              e.data.stage === "Collecting finite cutter intersections" &&
              e.data.progress > 0
            )
              window.__activeSplitProgress = {
                stage: e.data.stage,
                progress: e.data.progress,
              };
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
      }
      terminate() {
        if (this.__isProcessingWorker) window.__processingWorkers.terminated++;
        return super.terminate();
      }
    };
  });
  await page.goto(origin);
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
    const response = await client.callTool({ name, arguments: args });
    const wire =
      response.structuredContent ?? JSON.parse(response.content[0].text);
    assert(wire.ok, JSON.stringify(wire));
    return wire;
  };
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
    for (let i = 0; i < 1800; i++) {
      const state = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
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
  ledger.stages = [];
  const stage = async (name) => {
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
    };
    ledger.stages.push(entry);
    console.log(JSON.stringify({ stage: entry }));
  };
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
  const vertices = [
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
  const beforeCancel = await call("project_get");
  await mutate("command_run", { name: "ribbon:splitMesh" });
  const panel = page.getByRole("region", { name: "Split mesh", exact: true });
  await panel.waitFor();
  await panel.locator(".app-select > button").click();
  await page.getByRole("option", { name: "cutter.stl", exact: true }).click();
  await panel.getByRole("button", { name: "Split mesh", exact: true }).click();
  await page.waitForFunction(() => !!window.__activeSplitProgress, null, {
    timeout: 180000,
  });
  const observed = await page.evaluate(() => window.__activeSplitProgress);
  const workerBefore = await page.evaluate(() => ({
    ...window.__processingWorkers,
  }));
  assert(
    workerBefore.created > workerBefore.terminated,
    "No active processing worker observed",
  );
  await panel
    .getByRole("button", { name: "Close Split mesh", exact: true })
    .click();
  await idle();
  const workerAfter = await page.evaluate(() => ({
    ...window.__processingWorkers,
  }));
  assert(
    workerAfter.terminated > workerBefore.terminated,
    "Cancelled worker was not terminated",
  );
  const afterCancel = await call("project_get");
  assert.equal(
    afterCancel.revision,
    beforeCancel.revision,
    "Cancellation changed revision",
  );
  assert.equal(
    afterCancel.result.undo,
    beforeCancel.result.undo,
    "Cancellation changed history",
  );
  assert.deepEqual(
    await geometryDigest(sourceId),
    inputDigest,
    "Cancellation changed source",
  );
  assert.deepEqual(
    await geometryDigest(cutterId),
    cutterDigest,
    "Cancellation changed cutter",
  );
  const inputFaces =
    inputDigest.find((buffer) => buffer.path === "positions").elements / 9;
  assert.equal(inputFaces, 3691133);
  ledger.result = {
    inputFaces,
    observedStage: observed.stage,
    observedProgress: observed.progress,
    terminal: "gui-panel-closed",
    sourcePreserved: true,
    cutterPreserved: true,
    revisionPreserved: true,
    historyPreserved: true,
    workerBefore,
    workerAfter,
    pageErrors: errors,
    consoleErrors,
  };
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify(ledger.result));
} catch (error) {
  await page
    ?.screenshot({ path: fileURLToPath(new URL("failure.png", out)) })
    .catch(() => {});
  failed = error;
  throw error;
} finally {
  clearTimeout(deadline);
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

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { freemem } from "node:os";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = new URL("../.resources/mesh-readiness-browser/", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
assert(
  freemem() >= 3072 * 1048576,
  "Browser validation needs 3072 MiB free; retry when capacity is available.",
);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  ledger = {
    owner: "mesh-readiness-browser-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 360000).toISOString(),
    persistentData: false,
    resources: [],
  };
let server,
  reserve,
  browserServer,
  browser,
  client,
  transport,
  failed,
  validationSTL;
function identity(pid) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-Process -Id ${pid} | Select-Object Id,Path,@{Name='actualStartedAt';Expression={$_.StartTime.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
  assert.equal(result.status, 0, "Could not record owned process identity");
  return JSON.parse(result.stdout);
}
Object.assign(ledger, identity(process.pid));
const deadline = setTimeout(() => {
  failed = Error("Browser validation lease expired");
  void browserServer?.close();
}, 360000);
try {
  server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, "http://127.0.0.1").pathname;
      if (name === "/validation.stl" && validationSTL) {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(validationSTL);
        return;
      }
      const file = new URL(
        name === "/" ? "index.html" : name.slice(1),
        new URL("dist/", root),
      );
      if (!file.href.startsWith(new URL("dist/", root).href))
        throw Error("Invalid path");
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
  client = new Client({ name: "bridge-drag-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    ...identity(transport.pid),
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--js-flags=--max-old-space-size=1536",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    ...identity(browserServer.process().pid),
  });
  await writeFile(
    new URL("mesh-readiness-browser-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(origin);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Local bridge URL" })
    .fill(`http://127.0.0.1:${bridgePort}`);
  await page.getByLabel("Pairing token", { exact: true }).fill(token);
  await page
    .getByRole("button", { name: "Connect agent", exact: true })
    .click();
  await page.getByText(/Connected.*agents control this workspace/).waitFor();
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
  const mutate = async (name, args) =>
    call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  const job = async (receipt, expected = "succeeded") => {
    for (let i = 0; i < 120; i++) {
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

  const source = await readFile(
    process.env.SCANFORGE_READINESS_STL ?? "Z:/scanforge (2).stl",
  );
  const total = source.readUInt32LE(80),
    count = Math.min(
      total,
      Number(process.env.SCANFORGE_READINESS_TRIANGLES ?? 250000),
    );
  const stl = Buffer.from(source.subarray(0, 84 + count * 50));
  stl.writeUInt32LE(count, 80);
  validationSTL = stl;
  const file = fileURLToPath(new URL("readiness-scan.stl", out));
  await writeFile(file, stl);
  const started = performance.now();
  await page.locator('input[type=file][accept*=".stl"]').setInputFiles(file);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByRole("button", { name: "readiness-scan.stl", exact: true })
    .waitFor({ timeout: 120000 });
  const displayed = performance.now();
  const obj = (await call("project_get")).result.objects.find(
    (o) => o.name === "readiness-scan.stl",
  );
  assert.equal(obj.triangles, count);
  await page.getByRole("button", { name: "Edit scan", exact: true }).click();
  await page
    .getByRole("button", { name: "Select all triangles", exact: true })
    .click();
  const selected = performance.now();
  const getPreparation = async () =>
    (await call("object_get", { entityId: obj.id })).result.meshPreparation;
  const selectedAtPhase = (await getPreparation()).phase;
  let state;
  for (let i = 0; i < 1200; i++) {
    state = await getPreparation();
    if (state.phase === "ready") break;
    assert.notEqual(state.phase, "error", JSON.stringify(state));
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(state.phase, "ready", JSON.stringify(state));
  const ready = performance.now();
  const result = await job(
    await call("mesh_analyze", { entityId: obj.id, tolerance: 0.001 }),
  );
  assert.deepEqual(
    result.result.topology,
    state.topology,
    "MCP diagnostics match background preparation",
  );
  assert.equal(
    result.result.diagnostics.topologyCache,
    "memory-hit",
    "MCP reuses prepared index",
  );
  const selectedState = (await call("selection_get", { entityId: obj.id }))
    .result;
  assert.equal(
    selectedState.count,
    count,
    "Selection succeeds while preparation is running",
  );
  // A fresh worker has no resident session. Exercise the real browser IndexedDB
  // cache rather than treating the previous in-memory hit as a persisted hit.
  const workerAsset = (await readdir(new URL("dist/assets/", root))).find(
    (file) => /^processing-worker-.*\.js$/.test(file),
  );
  assert(workerAsset, "Production processing worker was built");
  const persistent = await page.evaluate(async (workerAsset) => {
    const data = new DataView(
      await (await fetch("/validation.stl")).arrayBuffer(),
    );
    const count = data.getUint32(80, true),
      positions = new Float32Array(count * 9);
    for (let face = 0; face < count; face++)
      for (let corner = 0; corner < 9; corner++)
        positions[face * 9 + corner] = data.getFloat32(
          84 + face * 50 + 12 + corner * 4,
          true,
        );
    // GUI import centers XY bounds and places the base at Z=0. The cache key
    // includes coordinates, so the fresh worker must receive that same source.
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis], positions[i]);
      max[axis] = Math.max(max[axis], positions[i]);
    }
    const center = [min[0] / 2 + max[0] / 2, min[1] / 2 + max[1] / 2, min[2]];
    for (let i = 0; i < positions.length; i++) positions[i] -= center[i % 3];
    const worker = new Worker(`/assets/${workerAsset}`, { type: "module" });
    const stages = [],
      started = performance.now();
    let timer;
    try {
      const result = await new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(Error("Persistent topology validation timed out")),
          60000,
        );
        worker.onerror = (event) => reject(Error(event.message));
        worker.onmessage = ({ data }) => {
          if ("error" in data) reject(Error(data.error));
          else if ("result" in data) resolve(data.result);
          else if (data.stage && stages.at(-1) !== data.stage)
            stages.push(data.stage);
        };
        worker.postMessage({ kind: "report", positions, tolerance: 0.001 }, [
          positions.buffer,
        ]);
      });
      return { result, stages, elapsedMs: performance.now() - started };
    } finally {
      clearTimeout(timer);
      worker.terminate();
    }
  }, workerAsset);
  ledger.persistentAttempt = persistent;
  assert.equal(persistent.result.diagnostics.topologyCache, "persistent-hit");
  assert.deepEqual(persistent.result.topology, state.topology);
  assert(
    !persistent.stages.some((stage) => /Welding|Building topology/.test(stage)),
  );
  assert.deepEqual(errors, []);
  ledger.result = {
    triangles: count,
    inputSha256: createHash("sha256").update(stl).digest("hex"),
    displayedMs: displayed - started,
    selectionAfterDisplayMs: selected - displayed,
    selectedAtPhase,
    readyAfterDisplayMs: ready - displayed,
    topology: state.topology,
    guiMcpEqual: true,
    memoryHit: true,
    persistentHit: persistent,
    pageErrors: errors,
  };
  await page.screenshot({
    path: fileURLToPath(new URL("editable-scan.png", out)),
  });
  console.log(JSON.stringify(ledger.result));
} catch (error) {
  failed = error;
  throw error;
} finally {
  clearTimeout(deadline);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
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
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("mesh-readiness-browser-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  if (failed) process.exitCode = 1;
}

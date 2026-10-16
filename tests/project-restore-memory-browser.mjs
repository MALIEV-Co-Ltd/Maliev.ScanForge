import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { freemem } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
if (freemem() < 3072 * 1048576)
  throw Error("Requires 3072 MiB free; do not lower this admission guard");
const root = new URL("../", import.meta.url),
  out = new URL(".resources/project-restore-memory-browser/", root),
  origin = "http://127.0.0.1:5173";
const sourceRoot = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
assert(sourceRoot, "Set SCANFORGE_ALIGNMENT_EXAMPLES");
await mkdir(out, { recursive: true });
const native = JSON.parse(
  await readFile(
    new URL("tests/fixtures/interactive-owner-unselected-native.json", root),
    "utf8",
  ),
);
native.vertexState.cases = native.vertexState.cases.slice(0, 2);
const token = randomBytes(32).toString("hex");
const ledger = {
  owner: "project-restore-memory-regression",
  pid: process.pid,
  executable: process.execPath,
  startedAt: new Date(performance.timeOrigin).toISOString(),
  expiresAt: new Date(Date.now() + 360000).toISOString(),
  persistentData: false,
  resources: [],
};
let browserServer, browser, transport, client, lease, failure;
const report = {
  nativeImageSha256: native.bounds.provenance.imageSha256,
  sourceFiles: [],
  checks: [],
};
const check = (message) => {
  report.checks.push(message);
  console.log(message);
};
const save = () =>
  writeFile(new URL("ledger.json", out), JSON.stringify(ledger, null, 2));
const hashFile = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
const wire = (result) =>
  result.structuredContent ?? JSON.parse(result.content[0].text);
let timedOut;
const deadline = new Promise((_, reject) => {
  lease = setTimeout(() => {
    timedOut = true;
    reject(Error("Interactive browser replay exceeded its six-minute lease"));
  }, 360000);
});
async function run() {
  const reserve = createServer();
  await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
  const port = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("scripts/mcp-server.mjs", root))],
    env: {
      ...process.env,
      NODE_OPTIONS: "--max-old-space-size=384",
      SCANFORGE_MCP_TOKEN: token,
      SCANFORGE_BRIDGE_PORT: String(port),
      SCANFORGE_ORIGINS: origin,
    },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (data) => {
    stderr = (stderr + String(data)).slice(-10000);
  });
  client = new Client({ name: "interactive-native-browser", version: "1.0.0" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-stdio",
    pid: transport.pid,
    port,
    bind: "127.0.0.1",
    startedAt: new Date().toISOString(),
    executable: process.execPath,
  });
  await save();
  const tools = await client.listTools();
  for (const name of [
    "interactive_alignment_get",
    "interactive_alignment_edit",
    "interactive_alignment_apply",
  ])
    assert(
      tools.tools.some((t) => t.name === name),
      name + " missing in real MCP discovery",
    );
  browserServer = await chromium.launchServer({
    channel: "chrome",
    args: [
      "--js-flags=--max-old-space-size=1792",
      "--enable-precise-memory-info",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    pid: browserServer.process().pid,
    startedAt: new Date().toISOString(),
    executable: browserServer.process().spawnfile,
  });
  await save();
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
    viewport: { width: 1183, height: 944 },
    deviceScaleFactor: 2,
  });
  const source = await (
    await fetch(origin + "/src/viewport-display.ts")
  ).text();
  assert(source.includes("export function smoothDisplayNormals(positions)"));
  await page.route("**/src/viewport-display.ts*", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: source.replace(
        "export function smoothDisplayNormals(positions) {",
        "export function smoothDisplayNormals(positions) { globalThis.__displayWeldCalls=(globalThis.__displayWeldCalls??0)+1;",
      ),
    }),
  );
  await page.addInitScript(() => {
    window.__heapRecord = {
      phase: "startup",
      phases: [{ phase: "startup", time: performance.now() }],
      samples: [],
      frames: [],
      longTasks: [],
      workers: [],
      running: true,
    };
    window.__phase = (phase) => {
      window.__heapRecord.phase = phase;
      window.__heapRecord.phases.push({ phase, time: performance.now() });
    };
    const Original = Worker;
    window.Worker = class extends Original {
      constructor(url, opts) {
        super(url, opts);
        this.record = { url: String(url), messages: 0, terminated: false };
        window.__heapRecord.workers.push(this.record);
      }
      postMessage(...args) {
        this.record.messages++;
        return super.postMessage(...args);
      }
      terminate() {
        this.record.terminated = true;
        return super.terminate();
      }
    };
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.__heapRecord.longTasks.push({
          time: e.startTime,
          duration: e.duration,
        });
    });
    observer.observe({ type: "longtask", buffered: false });
    setInterval(() => {
      const r = window.__heapRecord;
      if (r.running)
        r.samples.push({
          time: performance.now(),
          used: performance.memory?.usedJSHeapSize,
          phase: r.phase,
        });
    }, 100);
    let prior;
    const tick = (t) => {
      const r = window.__heapRecord;
      if (!r.running) return;
      if (prior !== undefined)
        r.frames.push({ time: t, ms: t - prior, phase: r.phase });
      prior = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Local bridge URL" })
    .fill("http://127.0.0.1:" + port);
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
    const result = wire(await client.callTool({ name, arguments: args }));
    assert(result.ok, name + ": " + JSON.stringify(result));
    return result;
  };
  const mutate = async (name, args = {}) => {
    const state = await call("project_get");
    return call(name, {
      ...args,
      expectedRevision: state.revision,
      requestId: randomUUID(),
    });
  };
  const exportReceipt = await call("project_export", { format: "project" });
  for (let i = 0; i < 120; i++) {
    const status = (
      await call("job_get", { jobId: exportReceipt.result.jobId })
    ).result;
    if (status.status !== "running") {
      assert.equal(status.status, "succeeded", JSON.stringify(status));
      break;
    }
    if (i === 119) throw Error("MCP project export timeout");
    await new Promise((r) => setTimeout(r, 100));
  }
  check(
    "Public MCP project_export completed through the shared background encoder",
  );
  const files = [];
  for (const c of native.vertexState.cases) {
    const path = sourceRoot + "/" + c.name;
    assert.equal(await hashFile(path), c.fileSha256, "Input hash changed");
    files.push(path);
    report.sourceFiles.push({
      name: c.name,
      sha256: c.fileSha256,
      vertices: c.vertices,
      triangles: c.faces,
    });
  }
  await page.locator('input[type=file][accept*=".stl"]').setInputFiles(files);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  for (const c of native.vertexState.cases)
    await page
      .getByRole("button", { name: c.name, exact: true })
      .waitFor({ timeout: 90000 });
  const imported = await call("project_get");
  const objects = imported.result.objects;
  assert.equal(objects.length, 2);
  for (const c of native.vertexState.cases) {
    const o = objects.find((o) => o.name === c.name);
    assert.equal(o.indexedTopology.vertices, c.vertices);
    assert.equal(o.triangles, c.faces);
  }
  const ids = native.vertexState.cases.map(
    (c) => objects.find((o) => o.name === c.name).id,
  );

  await page.evaluate(() => window.__phase("backup"));
  let backup;
  for (let i = 0; i < 120; i++) {
    const b = (await call("backup_list")).result.backups;
    if (b.length) {
      backup = b[0];
      break;
    }
    await page.waitForTimeout(1000);
  }
  assert(backup, "Automatic backup was not created");
  const beforeState = (await call("project_get")).result;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const beforeMemory = await cdp.send("Runtime.getHeapUsage");
  const mainCalls = await page.evaluate(() => {
    window.__phase("restore");
    return window.__displayWeldCalls ?? 0;
  });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  const receipt = await mutate("backup_restore", {
    backupId: backup.id,
    replace: true,
  });
  for (let i = 0; i < 180; i++) {
    const status = (await call("job_get", { jobId: receipt.result.jobId }))
      .result;
    if (status.status !== "running") {
      assert.equal(status.status, "succeeded", JSON.stringify(status));
      break;
    }
    await page.waitForTimeout(1000);
    if (i === 179) throw Error("Restore deadline");
  }
  await page.waitForTimeout(300);
  const afterState = (await call("project_get")).result;
  assert.equal(afterState.objects.length, 2);
  assert.equal(afterState.undo, beforeState.undo);
  for (const expected of native.vertexState.cases) {
    const actual = afterState.objects.find((o) => o.name === expected.name);
    assert.equal(actual.triangles, expected.faces);
  }
  const afterMemory = await cdp.send("Runtime.getHeapUsage");
  await page.evaluate(() => window.__phase("navigation"));
  const canvas = await page.locator(".viewport canvas").first().boundingBox();
  assert(canvas);
  for (let gesture = 0; gesture < 15; gesture++) {
    const modifier =
      gesture % 3 === 1 ? "Control" : gesture % 3 === 2 ? "Shift" : undefined;
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(
      canvas.x + canvas.width * 0.5,
      canvas.y + canvas.height * 0.5,
    );
    await page.mouse.down({ button: "left" });
    for (let i = 1; i < 6; i++)
      await page.mouse.move(
        canvas.x + canvas.width * 0.5 + i * 5,
        canvas.y + canvas.height * 0.5 + i * 3,
      );
    await page.mouse.up({ button: "left" });
    if (modifier) await page.keyboard.up(modifier);
    await page.mouse.wheel(0, gesture % 2 ? 60 : -60);
  }
  await page.evaluate(() => window.__phase("settled"));
  await page.waitForTimeout(2000);
  const { profile } = await cdp.send("Profiler.stop");
  await writeFile(new URL("restore.cpuprofile", out), JSON.stringify(profile));
  const data = await page.evaluate(() => {
    window.__heapRecord.running = false;
    return {
      ...window.__heapRecord,
      mainDisplayWeldCalls: window.__displayWeldCalls ?? 0,
    };
  });
  const preparationWorkers = data.workers.filter((w) =>
    w.url.includes("project-decoding-worker"),
  );
  assert.equal(preparationWorkers.length, 1);
  assert(preparationWorkers.every((w) => w.messages === 1 && w.terminated));
  assert.equal(
    data.mainDisplayWeldCalls - mainCalls,
    0,
    "Restore rebuilt normals on the UI thread",
  );
  const summary = {};
  for (const phase of [
    "startup",
    "backup",
    "restore",
    "navigation",
    "settled",
  ]) {
    const heaps = data.samples
        .filter((s) => s.phase === phase)
        .map((s) => s.used / 1048576),
      frames = data.frames
        .filter((s) => s.phase === phase)
        .map((s) => s.ms)
        .sort((a, b) => a - b);
    summary[phase] = {
      peakHeapMiB: Math.max(...heaps),
      medianFrameMs: frames[Math.floor(frames.length * 0.5)],
      maxFrameMs: frames.at(-1),
    };
  }
  assert(summary.restore.maxFrameMs < 500, "Restore blocked the UI for 500 ms");
  assert(
    summary.settled.maxFrameMs < 500,
    "Background backup blocked the UI for 500 ms",
  );
  assert(
    summary.navigation.maxFrameMs < 100,
    "Navigation frame exceeded 100 ms",
  );
  Object.assign(report, {
    beforeMemory,
    afterMemory,
    summary,
    preparationWorkers,
    mainDisplayWeldCalls: data.mainDisplayWeldCalls - mainCalls,
    browserErrors: errors,
    passed: true,
  });
  await writeFile(new URL("timeline.json", out), JSON.stringify(data));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: fileURLToPath(new URL("gui.png", out)) });
  await cdp.detach();
  console.log(JSON.stringify(report));
}

try {
  await save();
  await Promise.race([run(), deadline]);
} catch (error) {
  failure = error;
  report.passed = false;
  report.error = String(error).replaceAll(token, "[redacted]");
  throw error;
} finally {
  clearTimeout(lease);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  ledger.closedAt = new Date().toISOString();
  ledger.timedOut = !!timedOut;
  await save();
  await writeFile(
    new URL("results.json", out),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: report.checks,
      error: report.error,
    }),
  );
}

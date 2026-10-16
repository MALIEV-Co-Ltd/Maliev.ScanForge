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
  out = new URL(".resources/viewport-post-landmark-browser/", root),
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
const token = randomBytes(32).toString("hex");
const ledger = {
  owner: "viewport-post-landmark-performance",
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
    args: ["--js-flags=--max-old-space-size=1792"],
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
  assert.equal(objects.length, 3);
  for (const c of native.vertexState.cases) {
    const o = objects.find((o) => o.name === c.name);
    assert.equal(o.indexedTopology.vertices, c.vertices);
    assert.equal(o.triangles, c.faces);
  }
  const ids = native.vertexState.cases.map(
    (c) => objects.find((o) => o.name === c.name).id,
  );

  const movingId = ids[1],
    fixedId = ids[0];
  await mutate("landmark_edit", {
    action: "begin",
    movingId,
    fixedId,
    targetScope: "fixed",
  });
  for (const point of [
    [0, 0, 0],
    [10, 0, 0],
    [0, 10, 0],
  ]) {
    await mutate("landmark_edit", {
      action: "pick",
      entityId: movingId,
      point,
    });
    await mutate("landmark_edit", {
      action: "pick",
      entityId: fixedId,
      point: point.map((n, i) => n + [3, 4, 5][i]),
    });
  }
  const receipt = await mutate("landmark_preview", {
    parallel: true,
    workerCount: 2,
  });
  for (let i = 0; i < 600; i++) {
    const state = await call("job_get", { jobId: receipt.result.jobId });
    if (state.result.status !== "running") {
      assert.equal(state.result.status, "succeeded", JSON.stringify(state));
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 599) throw Error("Landmark preview timeout");
  }
  await mutate("landmark_accept");
  check("Accepted public landmark preview before viewport replay");
  await mutate("settings_set", { patch: { theme: "dark" } });
  await mutate("viewport_set", { view: "top" });
  await mutate("viewport_set", { view: "fit" });
  await page.waitForTimeout(600);
  report.viewportSetup = {
    theme: "dark",
    view: "top",
    fit: "visible scene",
    deviceScaleFactor: 2,
    width: 1183,
    height: 944,
  };
  await page.screenshot({
    path: fileURLToPath(new URL("navigation-start.png", out)),
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  await page.evaluate(() => {
    const sample = { frames: [], longTasks: [], drawCalls: 0, running: true };
    window.viewportSample = sample;
    const gl = document.querySelector(".viewport canvas").getContext("webgl2");
    for (const key of ["drawArrays", "drawElements"]) {
      const original = gl[key].bind(gl);
      gl[key] = (...args) => {
        sample.drawCalls++;
        return original(...args);
      };
    }
    sample.observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) sample.longTasks.push(e.duration);
    });
    sample.observer.observe({ type: "longtask", buffered: false });
    let prior;
    const frame = (now) => {
      if (!sample.running) return;
      if (prior !== undefined) sample.frames.push(now - prior);
      prior = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.getByRole("button", { name: "ply-2.ply", exact: true }).click();
  const canvas = await page.locator(".viewport canvas").first().boundingBox();
  assert(canvas);
  const gestureCounts = { orbit: 0, pan: 0, dragZoom: 0, wheelZoom: 0 };
  for (let gesture = 0; gesture < 20; gesture++) {
    const x = canvas.x + canvas.width * (0.3 + (gesture % 4) * 0.12);
    const y = canvas.y + canvas.height * (0.35 + (gesture % 3) * 0.12);
    const modifier =
      gesture % 5 === 2 ? "Control" : gesture % 5 === 3 ? "Shift" : undefined;
    const button = modifier ? "left" : gesture % 2 ? "middle" : "left";
    gestureCounts[
      modifier === "Control"
        ? "pan"
        : modifier === "Shift"
          ? "dragZoom"
          : "orbit"
    ]++;
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(x, y);
    await page.mouse.down({ button });
    for (let step = 1; step <= 6; step++)
      await page.mouse.move(x + step * 4, y + step * 3);
    await page.mouse.up({ button });
    if (modifier) await page.keyboard.up(modifier);
    gestureCounts.wheelZoom++;
    await page.mouse.wheel(0, gesture % 2 ? 60 : -60);
  }
  report.gestureCounts = gestureCounts;
  const { profile } = await cdp.send("Profiler.stop");
  await writeFile(new URL("profile.cpuprofile", out), JSON.stringify(profile));
  report.viewportPerformance = await page.evaluate(() => {
    const s = window.viewportSample;
    s.running = false;
    for (const e of s.observer.takeRecords()) s.longTasks.push(e.duration);
    s.observer.disconnect();
    const frames = s.frames.toSorted((a, b) => a - b);
    const gl = document.querySelector(".viewport canvas").getContext("webgl2");
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      gpu: ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      medianFrameMs: frames[Math.floor(frames.length * 0.5)],
      p95FrameMs: frames[Math.floor(frames.length * 0.95)],
      maxFrameMs: frames.at(-1),
      longTasks: s.longTasks,
      drawCalls: s.drawCalls,
      frameCount: frames.length,
    };
  });
  console.log(
    JSON.stringify({ viewportPerformance: report.viewportPerformance }),
  );
  assert(
    report.viewportPerformance.maxFrameMs < 100,
    "A viewport frame exceeded 100 ms after alignment",
  );
  assert.deepEqual(errors, []);
  report.browserErrors = errors;
  report.passed = true;
  await page.screenshot({ path: fileURLToPath(new URL("gui.png", out)) });
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

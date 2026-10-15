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
  out = new URL(".resources/interactive-public-browser/", root),
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
const prior = JSON.parse(
  await readFile(
    new URL("tests/fixtures/interactive-owner-bounds-native.json", root),
    "utf8",
  ),
);
const token = randomBytes(32).toString("hex");
const ledger = {
  owner: "interactive-public-gui-mcp",
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
const bits = (values) =>
  Buffer.from(Float32Array.from(values).buffer).toString("hex");
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
  const session = async () => {
    const s = (await call("interactive_alignment_get")).result;
    assert(s.active);
    return { sessionId: s.sessionId, expectedSessionVersion: s.version };
  };
  const edit = async (action, args = {}) =>
    mutate("interactive_alignment_edit", {
      action,
      ...(await session()),
      ...args,
    });
  const compareBounds = (state, transform) => {
    assert.equal(state.bounds.length, 3);
    for (let i = 0; i < state.entityIds.length; i++) {
      const object = objects.find((o) => o.id === state.entityIds[i]);
      const expected = native.bounds.cases.find(
        (c) => c.name === object.name && c.transform === transform,
      );
      assert(expected, "Missing native bounds");
      assert.equal(
        bits([...state.bounds[i].min, ...state.bounds[i].max]),
        expected.boundsBits,
        "Native bounds differ for " + object.name,
      );
    }
  };
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
  for (let gesture = 0; gesture < 20; gesture++) {
    const x = canvas.x + canvas.width * (0.3 + (gesture % 4) * 0.12);
    const y = canvas.y + canvas.height * (0.35 + (gesture % 3) * 0.12);
    const button = gesture % 2 ? "middle" : "left";
    await page.mouse.move(x, y);
    await page.mouse.down({ button });
    for (let step = 1; step <= 6; step++)
      await page.mouse.move(x + step * 4, y + step * 3);
    await page.mouse.up({ button });
    await page.mouse.wheel(0, gesture % 2 ? 60 : -60);
  }
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
  for (let i = 0; i < ids.length; i++)
    await mutate("object_select", { entityId: ids[i], toggle: i > 0 });
  const baseline = await call("project_get");
  const undo = baseline.result.undo;
  await page.getByRole("tab", { name: "Scan Data", exact: true }).click();
  await page.getByRole("button", { name: "Interactive", exact: true }).click();
  let begun;
  for (let i = 0; i < 200; i++) {
    begun = await call("interactive_alignment_get");
    if (begun.result.active) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert(
    begun.result.active,
    "Enabled ribbon did not begin the shared session",
  );
  // Begin measures the pivot without publishing measured bounds. A zero step
  // requests fresh bounds through the same public operation used by real steps.
  begun = await edit("step", { kind: "translatePositive", axis: 0, value: 0 });
  compareBounds(begun.result, 0);
  await page
    .getByRole("complementary", { name: "Interactive alignment", exact: true })
    .waitFor();
  assert(
    await page.locator(".explorer").evaluate((e) => e.inert),
    "Explorer did not pause while preview owns scans",
  );
  check(
    "Enabled ribbon mounted GUI and MCP matched all original identity bounds",
  );
  const rotationVersion = begun.result.version;
  await page.getByLabel("Rotation step in degrees", { exact: true }).fill("45");
  await page
    .getByRole("button", { name: "Rotate positive", exact: true })
    .click();
  let s;
  for (let i = 0; i < 100; i++) {
    s = (await call("interactive_alignment_get")).result;
    if (s.version > rotationVersion) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  for (const t of s.targets)
    for (let i = 0; i < 12; i++)
      assert(
        Math.abs(t.matrix[i] - prior.transforms[2][i]) < 1e-12,
        "GUI rotation differs from original native step",
      );
  const dragged = await edit("drag", {
    handle: 4,
    from: [0.5, 0.5],
    to: [0.56, 0.53],
    continuation: false,
  });
  assert.equal(
    dragged.result.accepted,
    true,
    "Public drag did not reach the camera adapter",
  );
  assert.equal((await call("project_get")).result.undo, undo);
  const viewVersion = dragged.result.version;
  await page
    .getByRole("button", { name: "As current view", exact: true })
    .click();
  for (let i = 0; i < 100; i++) {
    s = (await call("interactive_alignment_get")).result;
    if (s.version > viewVersion) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert(
    s.version > viewVersion && s.boundsFresh,
    "GUI Current View did not measure and publish its pose",
  );
  check(
    "Public drag and GUI Current View reached the live camera/session adapters without history",
  );
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  for (let i = 0; i < 100; i++) {
    s = (await call("interactive_alignment_get")).result;
    if (!s.changed) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert(!s.changed);
  check("GUI rotation reached native pose and Reset preserved source/history");
  await page.getByLabel("Mirror mesh preview", { exact: true }).check();
  for (let i = 0; i < 160; i++) {
    const view = (await call("viewport_get")).result;
    if (view.interactiveMirror?.ready) {
      report.mirror = view.interactiveMirror;
      break;
    }
    if (view.interactiveMirror?.error)
      throw Error(view.interactiveMirror.error);
    await new Promise((r) => setTimeout(r, 50));
  }
  assert(report.mirror?.ready, "GUI mirror did not become ready");
  assert.equal((await call("project_get")).result.undo, undo);
  await page.getByLabel("Mirror mesh preview", { exact: true }).uncheck();
  await page
    .getByLabel("Translation step in millimeters", { exact: true })
    .fill("3.125");
  const version = s.version;
  await page
    .getByRole("button", { name: "Translate positive", exact: true })
    .click();
  for (let i = 0; i < 100; i++) {
    s = (await call("interactive_alignment_get")).result;
    if (s.version > version && s.targets.every((t) => t.matrix[3] === 3.125))
      break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert(s.targets.every((t) => t.matrix[3] === 3.125));
  await edit("step", { kind: "translateNegative", axis: 1, value: 2.5 });
  await edit("step", { kind: "translatePositive", axis: 2, value: 50000 });
  await edit("step", { kind: "translatePositive", axis: 2, value: 0.1 });
  s = (await call("interactive_alignment_get")).result;
  compareBounds(s, 1);
  assert.equal((await call("project_get")).result.undo, undo);
  check(
    "GUI/MCP step sequence matched six original owner bounds; preview added no history",
  );
  await mutate("viewport_control", { action: "fit" });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page
    .getByRole("complementary", { name: "Interactive alignment", exact: true })
    .waitFor({ state: "hidden", timeout: 90000 });
  for (let i = 0; i < 200; i++) {
    const p = await call("project_get");
    if (p.result.undo === undo + 1) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await call("project_get")).result.undo, undo + 1);
  assert.equal((await call("interactive_alignment_get")).result.active, false);
  begun = await mutate("interactive_alignment_edit", {
    action: "begin",
    entityIds: ids,
    parallel: true,
  });
  begun = await edit("step", { kind: "translatePositive", axis: 0, value: 0 });
  compareBounds(begun.result, 1);
  await page.keyboard.press("Escape");
  await page
    .getByRole("complementary", { name: "Interactive alignment", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal((await call("project_get")).result.undo, undo + 1);
  check(
    "GUI Apply baked once; reopening matched native transformed bounds; Escape cancelled without another history entry",
  );
  await mutate("history_undo");
  begun = await mutate("interactive_alignment_edit", {
    action: "begin",
    entityIds: ids,
    parallel: true,
  });
  begun = await edit("step", { kind: "translatePositive", axis: 0, value: 0 });
  compareBounds(begun.result, 0);
  await mutate("preview_discard", { target: "interactive" });
  assert.equal((await call("project_get")).result.undo, undo);
  assert.equal((await call("project_get")).result.redo, 1);
  check(
    "MCP Undo restored all native identity bounds; MCP cancellation preserved redo",
  );
  assert.deepEqual(errors, []);
  report.browserErrors = errors;
  await page.screenshot({ path: fileURLToPath(new URL("gui.png", out)) });
  report.passed = true;
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

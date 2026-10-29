import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PerspectiveCamera, Vector3 } from "three";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { sketchMirror } from "./helpers/sketch-mirror-browser.mjs";
import { sketchJunctions } from "./helpers/sketch-junctions-browser.mjs";

// Actual pointer gestures and public stdio MCP only. The parent owns the Windows
// Job, memory/CPU admission and serialized heavy-work slot; this script owns its
// loopback server, bridge child, disposable browser/profile and finite lease.
const root = new URL("../", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit", timeout: 10000, windowsHide: true },
);
assert.equal(admission.status, 0, "Existing resource admission failed");
const artifactDir = new URL(
  `.resources/m4-sketch-editing/${randomUUID()}/`,
  root,
);
await mkdir(artifactDir, { recursive: true });
const evidence = new URL("browser-validation.json", artifactDir);
const lease = new AbortController();
const ledger = {
  owner: "m4-sketch-editing-public-validation",
  startedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  scope: "CURRENT_APPLICATION_EDITING_GUI_PUBLIC_MCP_NOT_NATIVE_EQUIVALENCE",
  browserPath: "Playwright explicitly requested; Browser plugin not available",
  persistentData: false,
  resources: [],
  cleanup: [],
  scenarios: [],
};
let saving = Promise.resolve();
const save = () =>
  (saving = saving.then(() =>
    writeFile(evidence, JSON.stringify(ledger, null, 2)),
  ));
function identity(pid, allowAbsent = false) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  if (process.platform !== "win32")
    return { pid, executable: process.execPath };
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($null -eq $p){'null';exit 0}; [pscustomobject]@{pid=$p.Id;startedAt=$p.StartTime.ToUniversalTime().ToString('o');executable=$p.Path}|ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  if (!allowAbsent)
    assert(
      value?.startedAt && value?.executable,
      "Owned process identity unavailable",
    );
  return value;
}
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}
const mime = {
  html: "text/html",
  js: "application/javascript",
  css: "text/css",
  wasm: "application/wasm",
  json: "application/json",
  svg: "image/svg+xml",
};
const staticServer = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    const base = new URL("dist/", root);
    const file = new URL(
      pathname === "/" ? "index.html" : pathname.slice(1),
      base,
    );
    if (!file.href.startsWith(base.href)) throw Error("Forbidden path");
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type":
        mime[file.pathname.split(".").pop()] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
staticServer.requestTimeout = 10000;
let browserServer,
  browser,
  client,
  transport,
  reserve,
  page,
  bridgePort,
  appPort,
  failure;
const timer = setTimeout(() => {
  failure ??= Error("Sketch editing validation exceeded its four-minute lease");
  lease.abort(failure);
  void browserServer?.close().catch(() => {});
  void transport?.close().catch(() => {});
}, 240000);
try {
  const index = await readFile(new URL("dist/index.html", root));
  ledger.servedIndexSha256 = createHash("sha256").update(index).digest("hex");
  await new Promise((resolve, reject) => {
    staticServer.once("error", reject);
    staticServer.listen(0, "127.0.0.1", resolve);
  });
  appPort = staticServer.address().port;
  const origin = `http://127.0.0.1:${appPort}`;
  ledger.origin = origin;
  ledger.resources.push({
    kind: "http-server",
    ...identity(process.pid),
    port: appPort,
    bind: "127.0.0.1",
  });
  reserve = http.createServer();
  await new Promise((resolve, reject) => {
    reserve.once("error", reject);
    reserve.listen(0, "127.0.0.1", resolve);
  });
  bridgePort = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const token = randomBytes(32).toString("hex");
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--max-old-space-size=128",
      "--max-semi-space-size=16",
      fileURLToPath(new URL("scripts/mcp-server.mjs", root)),
    ],
    env: {
      ...process.env,
      SCANFORGE_MCP_TOKEN: token,
      SCANFORGE_BRIDGE_PORT: String(bridgePort),
      SCANFORGE_ORIGINS: origin,
    },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (data) => {
    stderr += data;
  });
  client = new Client({ name: "m4-sketch-editing-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    ...identity(transport.pid),
    port: bridgePort,
    bind: "127.0.0.1",
  });
  const tools = (await client.listTools()).tools;
  for (const name of [
    "sketch_get",
    "sketch_draw",
    "sketch_set",
    "sketch_manage",
    "history_undo",
    "history_redo",
    "viewport_get",
    "viewport_control",
    "project_export",
    "project_import",
  ])
    assert(
      tools.some((tool) => tool.name === name),
      `Missing ${name}`,
    );
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    timeout: 20000,
    args: [
      "--enable-unsafe-swiftshader",
      "--js-flags=--max-old-space-size=768 --max-semi-space-size=16",
    ],
  });
  ledger.resources.push({
    kind: "browser",
    ...identity(browserServer.process().pid),
    persistentData: false,
  });
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(20000);
  const errors = [],
    consoleWarnings = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    else if (message.type() === "warning") consoleWarnings.push(message.text());
  });
  await page.goto(origin);
  assert.equal(new URL(page.url()).origin, origin);
  assert((await page.title()).length > 0);
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
  const raw = async (name, args = {}) => {
    lease.signal.throwIfAborted();
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 15000,
      signal: lease.signal,
    });
    return result.structuredContent ?? JSON.parse(result.content[0].text);
  };
  const call = async (name, args = {}) => {
    const wire = await raw(name, args);
    assert(wire.ok, `${name}: ${JSON.stringify(wire)}`);
    return wire;
  };
  const mutate = async (name, args = {}) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!(await call("session_get")).result.busy) break;
      if (attempt === 99) throw Error("Previous GUI operation did not settle");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
  };
  const readSketch = async () => (await call("sketch_get")).result;
  const eventually = async (check) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      lease.signal.throwIfAborted();
      try {
        await check();
        return;
      } catch (error) {
        if (attempt === 79) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const settled = async (receipt) => {
    assert(receipt.ok, JSON.stringify(receipt));
    if (!receipt.result.jobId) return receipt.result;
    for (let attempt = 0; attempt < 200; attempt++) {
      lease.signal.throwIfAborted();
      const job = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      if (job.status !== "running") {
        assert.equal(job.status, "succeeded", JSON.stringify(job));
        return job.result;
      }
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    throw Error("Public job exceeded bounded polling");
  };
  await mutate("project_new", {
    discard: true,
    name: "Sketch editing acceptance",
  });
  await mutate("settings_set", {
    patch: {
      theme: "dark",
      floorGrid: false,
      originVisible: false,
      automaticGrid: false,
      snapGrid: false,
      gridSpacing: 1,
    },
  });
  const helperContext = {
    page,
    call,
    raw,
    mutate,
    tools,
    ledger,
    save,
    signal: lease.signal,
  };
  await sketchMirror(helperContext);
  assert.equal(ledger.sketchMirror.savedAndLegacyHistoryIsolated, true);
  await sketchJunctions(helperContext);
  assert.equal(ledger.sketchJunctions.completedWorkflowPassed, true);

  const frame = {
    origin: [0, 0, 12],
    u: [1, 0, 0],
    v: [0, 1, 0],
    normal: [0, 0, 1],
  };
  const rectangle = {
    version: 1,
    frame,
    points: [
      { id: "p0", x: 0, y: 0 },
      { id: "p1", x: 10, y: 0 },
      { id: "p2", x: 10, y: 10 },
      { id: "p3", x: 0, y: 10 },
    ],
    segments: [
      { id: "bottom", a: "p0", b: "p1" },
      { id: "right", a: "p1", b: "p2" },
      { id: "top", a: "p2", b: "p3" },
      { id: "left", a: "p3", b: "p0" },
    ],
    constraints: [],
  };
  await mutate("sketch_manage", {
    action: "create",
    name: "Fillet GUI MCP",
    sketch: rectangle,
  });
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
  });
  const panel = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  const modelBefore = (await call("project_get")).result;
  const assertModelUnchanged = async () => {
    const current = (await call("project_get")).result;
    assert.deepEqual(current.objects, modelBefore.objects);
    assert.equal(current.undo, modelBefore.undo);
    assert.equal(current.redo, modelBefore.redo);
  };
  const selection = {
    first: "bottom",
    second: "right",
    firstEnd: "b",
    secondEnd: "a",
    radiusMm: 2,
  };
  const fillet = (await mutate("sketch_corner_fillet", selection)).result;
  assert.equal(fillet.changed, true);
  assert.deepEqual(fillet.intersection, [10, 0]);
  assert(
    Math.abs(fillet.center[0] - 8) < 1e-10 &&
      Math.abs(fillet.center[1] - 2) < 1e-10,
  );
  const filleted = (await readSketch()).sketch;
  assert.equal(filleted.arcs.length, 1);
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual((await readSketch()).sketch, rectangle);
  async function choose(label, option) {
    await panel.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  }
  await choose("First line", "bottom");
  await choose("Second line", "right");
  await choose("First line end", "End · b");
  await choose("Second line end", "Start · a");
  await panel.getByLabel("Fillet radius (mm)", { exact: true }).fill("2");
  await panel
    .getByRole("button", { name: "Create fillet", exact: true })
    .click();
  await eventually(async () =>
    assert.deepEqual((await readSketch()).sketch, filleted),
  );
  await panel
    .getByRole("button", { name: "Undo sketch edit", exact: true })
    .click();
  await eventually(async () =>
    assert.deepEqual((await readSketch()).sketch, rectangle),
  );
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await readSketch()).sketch, filleted);
  await assertModelUnchanged();
  await mutate("history_undo", { scope: "sketch" });
  const failedRadiusRevision = (await call("project_get")).revision;
  const badRadius = await raw("sketch_corner_fillet", {
    ...selection,
    radiusMm: 20,
    expectedRevision: failedRadiusRevision,
    requestId: randomUUID(),
  });
  assert.equal(badRadius.ok, false);
  assert.match(badRadius.error.message, /radius|fit|tangent|length/i);
  await panel.getByLabel("Fillet radius (mm)", { exact: true }).fill("20");
  await panel
    .getByRole("button", { name: "Create fillet", exact: true })
    .click();
  await panel
    .getByRole("alert")
    .filter({ hasText: /radius|fit|tangent|length/i })
    .waitFor();
  assert.equal((await call("project_get")).revision, failedRadiusRevision);
  assert.deepEqual((await readSketch()).sketch, rectangle);
  // Successful recovery clears the error and remains one scoped edit.
  await panel.getByLabel("Fillet radius (mm)", { exact: true }).fill("2");
  await panel
    .getByRole("button", { name: "Create fillet", exact: true })
    .click();
  await eventually(async () =>
    assert.deepEqual((await readSketch()).sketch, filleted),
  );
  ledger.scenarios.push({
    name: "GUI/public MCP fillet",
    identicalAnalyticGraph: true,
    failedRadiusAtomic: true,
    scopedHistory: true,
    recovery: true,
  });

  const cross = {
    version: 1,
    frame,
    points: [
      { id: "a", x: -20, y: 0 },
      { id: "b", x: 20, y: 0 },
      { id: "c", x: 0, y: -20 },
      { id: "d", x: 0, y: 20 },
    ],
    segments: [
      { id: "horizontal", a: "a", b: "b" },
      { id: "vertical", a: "c", b: "d" },
    ],
    constraints: [],
  };
  await mutate("sketch_manage", {
    action: "create",
    name: "Paint trim GUI MCP",
    sketch: cross,
  });
  const trimRequest = {
    stroke: [
      [-10, -1],
      [-10, 1],
    ],
    radiusMm: 0.25,
  };
  assert.equal(
    (await mutate("sketch_trim_stroke", trimRequest)).result.changed,
    true,
  );
  const trimmed = (await readSketch()).sketch;
  const horizontal = trimmed.segments.find((row) => row.id === "horizontal");
  const point = (sketch, id) => {
    const p = sketch.points.find((row) => row.id === id);
    assert(p);
    return [p.x, p.y];
  };
  assert.deepEqual(point(trimmed, horizontal.a), [0, 0]);
  assert.deepEqual(point(trimmed, horizontal.b), [20, 0]);
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual((await readSketch()).sketch, cross);
  await panel.getByRole("button", { name: "Paint trim", exact: true }).click();
  await panel.getByLabel("Trim radius (mm)", { exact: true }).fill("0.25");
  await mutate("viewport_control", {
    action: "camera",
    position: [0, 0, 172],
    target: frame.origin,
    up: frame.v,
    projection: "perspective",
    zoom: 1,
  });
  const canvas = page.locator(".viewport canvas").first();
  const project = async (uv) => {
    const view = (await call("viewport_get")).result;
    assert.equal(view.cameraMatrixFormat, "column-major-4x4");
    const camera = new PerspectiveCamera();
    camera.projectionMatrix.fromArray(view.projectionMatrix);
    camera.matrixWorld.fromArray(view.cameraWorldMatrix);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const clip = new Vector3(...frame.origin)
      .addScaledVector(new Vector3(...frame.u), uv[0])
      .addScaledVector(new Vector3(...frame.v), uv[1])
      .project(camera);
    const box = await canvas.boundingBox();
    assert(box && clip.z >= -1 && clip.z <= 1);
    const p = {
      x: box.x + ((clip.x + 1) * box.width) / 2,
      y: box.y + ((1 - clip.y) * box.height) / 2,
    };
    assert(
      p.x > box.x + 6 &&
        p.x < box.x + box.width - 6 &&
        p.y > box.y + 6 &&
        p.y < box.y + box.height - 6,
    );
    return p;
  };
  const paint = async (cancel = false) => {
    const a = await project(trimRequest.stroke[0]),
      b = await project(trimRequest.stroke[1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
  };
  const cancelRevision = (await call("project_get")).revision;
  await paint(true);
  assert.equal((await call("project_get")).revision, cancelRevision);
  assert.deepEqual((await readSketch()).sketch, cross);
  await paint();
  await eventually(async () =>
    assert.deepEqual((await readSketch()).sketch, trimmed),
  );
  await panel
    .getByRole("button", { name: "Undo sketch edit", exact: true })
    .click();
  await eventually(async () =>
    assert.deepEqual((await readSketch()).sketch, cross),
  );
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await readSketch()).sketch, trimmed);
  const noHitRevision = (await call("project_get")).revision;
  assert.equal(
    (
      await mutate("sketch_trim_stroke", {
        stroke: [[-10, 15]],
        radiusMm: 0.25,
      })
    ).result.changed,
    false,
  );
  assert.equal((await call("project_get")).revision, noHitRevision);
  const blocked = {
    ...cross,
    constraints: [{ id: "fixed-a", kind: "fixed", point: "a", x: -20, y: 0 }],
  };
  await mutate("sketch_set", { sketch: blocked });
  const blockedRevision = (await call("project_get")).revision;
  const badTrim = await raw("sketch_trim_stroke", {
    ...trimRequest,
    expectedRevision: blockedRevision,
    requestId: randomUUID(),
  });
  assert.equal(badTrim.ok, false);
  assert.match(badTrim.error.message, /constrain/i);
  await paint();
  await page
    .getByRole("alert")
    .filter({ hasText: /constrain/i })
    .waitFor();
  assert.equal((await call("project_get")).revision, blockedRevision);
  assert.deepEqual((await readSketch()).sketch, blocked);
  await mutate("sketch_set", { sketch: cross });
  await paint();
  await eventually(async () =>
    assert.deepEqual((await readSketch()).sketch, trimmed),
  );
  await assertModelUnchanged();
  ledger.scenarios.push({
    name: "actual canvas/public MCP paint trim",
    identicalAnalyticGraph: true,
    failedConstraintAtomic: true,
    escapeNoMutation: true,
    noHitNoMutation: true,
    scopedHistory: true,
    recovery: true,
  });
  const savedSketches = await readSketch();
  const exported = await settled(
    await call("project_export", { format: "project" }),
  );
  await mutate("sketch_set", { sketch: cross });
  await settled(
    await mutate("project_import", {
      artifactId: exported.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(await readSketch(), savedSketches);
  const savedFillet = savedSketches.sketches.find(
    (row) => row.name === "Fillet GUI MCP",
  );
  assert.deepEqual(savedFillet.sketch, filleted);
  assert.deepEqual(savedSketches.sketch, trimmed);
  ledger.scenarios.push({
    name: "worker project reopen",
    exactSavedFilletAndTrimGraphs: true,
    allSavedSketchIdentities: true,
  });
  await page.screenshot({
    path: fileURLToPath(new URL("editing-example.png", artifactDir)),
  });
  assert.deepEqual(errors, []);
  assert.equal(stderr, "");
  ledger.browserErrors = errors;
  ledger.consoleWarnings = consoleWarnings;
  ledger.nativeAcceptance = false;
  await save();
} catch (error) {
  failure ??= error;
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: fileURLToPath(new URL("failure.png", artifactDir)) })
      .catch(() => {});
    await page
      .locator("body")
      .innerText()
      .then((text) =>
        writeFile(new URL("failure.txt", artifactDir), text.slice(0, 65536)),
      )
      .catch(() => {});
  }
} finally {
  clearTimeout(timer);
  for (const [kind, close] of [
    ["browser-context", () => browser?.close()],
    ["browser-server", () => browserServer?.close()],
    ["mcp-client", () => client?.close()],
    ["mcp-transport", () => transport?.close()],
  ]) {
    try {
      await close();
    } catch (error) {
      ledger.cleanup.push({ kind, error: error.message });
      failure ??= error;
    }
  }
  if (reserve?.listening)
    await new Promise((resolve) => reserve.close(resolve));
  if (staticServer.listening)
    await new Promise((resolve) => {
      staticServer.close(resolve);
      staticServer.closeAllConnections();
    });
  for (const resource of ledger.resources.filter(
    (r) => r.kind === "browser" || r.kind === "mcp-server",
  )) {
    let absent = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        if (process.platform === "win32") {
          const current = identity(resource.pid, true);
          absent =
            !current ||
            current.startedAt !== resource.startedAt ||
            current.executable.toLowerCase() !==
              resource.executable.toLowerCase();
        } else {
          try {
            process.kill(resource.pid, 0);
          } catch {
            absent = true;
          }
        }
      } catch (error) {
        ledger.cleanup.push({
          kind: resource.kind,
          pid: resource.pid,
          error: error.message,
        });
        failure ??= error;
        break;
      }
      if (absent) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    ledger.cleanup.push({
      kind: resource.kind,
      pid: resource.pid,
      originalStart: resource.startedAt,
      absent,
    });
    if (!absent)
      failure ??= Error(`Owned ${resource.kind} ${resource.pid} remains`);
  }
  for (const port of [appPort, bridgePort].filter(Boolean)) {
    const closed = !(await portOpen(port));
    ledger.cleanup.push({ port, closed });
    if (!closed) failure ??= Error(`Owned port ${port} remains open`);
  }
  ledger.finishedAt = new Date().toISOString();
  ledger.passed = !failure;
  ledger.error = failure?.stack ?? failure?.message;
  await save();
}
if (failure) throw failure;
console.log(
  `Sketch editing GUI/public MCP acceptance passed: ${fileURLToPath(evidence)}`,
);

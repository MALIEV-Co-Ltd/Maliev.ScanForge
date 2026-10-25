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
import { sketchCollinear } from "./helpers/sketch-collinear-browser.mjs";

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
  `.resources/m4-sketch-canvas/${randomUUID()}/`,
  root,
);
await mkdir(artifactDir, { recursive: true });
const evidence = new URL("browser-validation.json", artifactDir);
const lease = new AbortController();
const ledger = {
  owner: "m4-sketch-canvas-public-validation",
  startedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  scope: "CURRENT_APPLICATION_CANVAS_GUI_PUBLIC_MCP_NOT_NATIVE_EQUIVALENCE",
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
  failure ??= Error("Sketch canvas validation exceeded its four-minute lease");
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
  client = new Client({ name: "m4-sketch-canvas-validation", version: "1" });
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
  const mutate = async (name, args = {}) =>
    call(name, {
      ...args,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    });
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
    name: "Canvas sketch acceptance",
  });
  await mutate("settings_set", {
    patch: {
      theme: "dark",
      floorGrid: false,
      originVisible: false,
      automaticGrid: false,
      gridSpacing: 1,
      snapGrid: true,
    },
  });
  const frame = {
    origin: [0, 0, 12],
    u: [1, 0, 0],
    v: [0, 1, 0],
    normal: [0, 0, 1],
  };
  const blank = {
    version: 1,
    points: [],
    segments: [],
    arcs: [],
    constraints: [],
    frame,
  };
  const active = (
    await mutate("sketch_manage", {
      action: "create",
      name: "Actual canvas line arc circle",
      sketch: blank,
    })
  ).result.sketchId;
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
  });
  const panel = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  await panel.waitFor();
  await panel
    .getByLabel("Constraints · snap origin, endpoints and axes", {
      exact: true,
    })
    .check();
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
    const world = new Vector3(...frame.origin)
      .addScaledVector(new Vector3(...frame.u), uv[0])
      .addScaledVector(new Vector3(...frame.v), uv[1]);
    const clip = world.project(camera),
      rect = await canvas.boundingBox();
    assert(rect && clip.z >= -1 && clip.z <= 1, "Sketch target is clipped");
    const point = {
      x: rect.x + ((clip.x + 1) * rect.width) / 2,
      y: rect.y + ((1 - clip.y) * rect.height) / 2,
    };
    assert(
      point.x > rect.x + 6 &&
        point.x < rect.x + rect.width - 6 &&
        point.y > rect.y + 6 &&
        point.y < rect.y + rect.height - 6,
      "Sketch pointer target outside visible canvas",
    );
    return point;
  };
  const selectTool = async (name) => {
    const button = panel.getByRole("button", { name, exact: true });
    await button.click();
    assert.equal(await button.getAttribute("aria-pressed"), "true");
  };
  const drag = async (from, to) => {
    const a = await project(from),
      b = await project(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  };
  const click = async (uv) => {
    const p = await project(uv);
    await page.mouse.click(p.x, p.y);
  };
  const point = (sketch, id) => {
    const p = sketch.points.find((p) => p.id === id);
    assert(p, `Missing sketch point ${id}`);
    return [p.x, p.y];
  };
  const assertModelUnchanged = async () => {
    const model = (await call("project_get")).result;
    assert.equal(model.objects.length, 0);
    assert.equal(model.undo, 0);
    assert.equal(model.redo, 0);
  };
  await selectTool("Line");
  await drag([0.2, 0.2], [15.2, 0.2]);
  await eventually(async () =>
    assert.equal((await readSketch()).sketch.segments.length, 1),
  );
  const first = (await readSketch()).sketch,
    firstLine = first.segments[0];
  assert.deepEqual(point(first, firstLine.a), [0, 0]);
  assert.deepEqual(point(first, firstLine.b), [15, 0]);
  assert(
    first.constraints.some(
      (c) => c.kind === "fixed" && c.point === firstLine.a,
    ),
  );
  assert(
    first.constraints.some(
      (c) => c.kind === "horizontal" && c.segment === firstLine.id,
    ),
  );
  await drag([15.2, 0.2], [15.2, 10.2]);
  await eventually(async () =>
    assert.equal((await readSketch()).sketch.segments.length, 2),
  );
  const lines = (await readSketch()).sketch,
    secondLine = lines.segments[1];
  assert.equal(lines.points.length, 3);
  assert.equal(secondLine.a, firstLine.b);
  assert.deepEqual(point(lines, secondLine.b), [15, 10]);
  assert(
    lines.constraints.some(
      (c) => c.kind === "vertical" && c.segment === secondLine.id,
    ),
  );
  await assertModelUnchanged();
  ledger.scenarios.push({
    name: "actual-canvas-continuous-lines",
    gridSpacingMm: 1,
    originFixed: true,
    sharedEndpoint: true,
    horizontalVertical: true,
    modelHistoryUnchanged: true,
  });
  await selectTool("Arc · 3 points");
  const beforeArc = (await readSketch()).sketch,
    arcRevision = (await call("project_get")).revision;
  await click([-25, -5]);
  await click([-20, 0]);
  await page.keyboard.press("Escape");
  assert.deepEqual((await readSketch()).sketch, beforeArc);
  assert.equal((await call("project_get")).revision, arcRevision);
  await click([-25, -5]);
  await click([-20, 0]);
  await click([-15, -5]);
  await eventually(async () =>
    assert.equal((await readSketch()).sketch.arcs.length, 1),
  );
  const arcSketch = (await readSketch()).sketch,
    arc = arcSketch.arcs[0];
  assert.deepEqual(point(arcSketch, arc.a), [-25, -5]);
  assert.deepEqual(point(arcSketch, arc.b), [-15, -5]);
  assert.deepEqual(point(arcSketch, arc.center), [-20, -5]);
  assert.equal(arc.clockwise, true);
  ledger.scenarios.push({
    name: "actual-canvas-three-point-arc",
    start: [-25, -5],
    via: [-20, 0],
    end: [-15, -5],
    center: [-20, -5],
    clockwise: true,
    unfinishedPicksEscapePreservesRevision: true,
  });
  await selectTool("Line");
  const beforeCancel = (await readSketch()).sketch,
    cancelRevision = (await call("project_get")).revision;
  const ca = await project([-30, 20]),
    cb = await project([-20, 20]);
  await page.mouse.move(ca.x, ca.y);
  await page.mouse.down();
  await page.mouse.move(cb.x, cb.y, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual((await readSketch()).sketch, beforeCancel);
  assert.equal((await call("project_get")).revision, cancelRevision);
  await selectTool("Move endpoint");
  await drag([15, 10], [15, 12]);
  await eventually(async () =>
    assert.deepEqual(
      point((await readSketch()).sketch, secondLine.b),
      [15, 12],
    ),
  );
  await selectTool("Circle · center/radius");
  const beforeCircle = (await readSketch()).sketch;
  await drag([15.2, -10.2], [20.2, -10.2]);
  await eventually(async () =>
    assert.equal((await readSketch()).sketch.arcs.length, 3),
  );
  const gui = (await readSketch()).sketch,
    newArcs = gui.arcs.filter(
      (curve) => !beforeCircle.arcs.some((old) => old.id === curve.id),
    );
  assert.equal(newArcs.length, 2);
  const [top, bottom] = newArcs;
  assert.equal(top.center, bottom.center);
  assert.equal(top.a, bottom.b);
  assert.equal(top.b, bottom.a);
  assert.equal(top.clockwise, false);
  assert.equal(bottom.clockwise, false);
  assert.deepEqual(point(gui, top.center), [15, -10]);
  assert.deepEqual(point(gui, top.a), [20, -10]);
  assert.deepEqual(point(gui, top.b), [10, -10]);
  assert.equal(gui.points.length, 9);
  assert.deepEqual(gui.frame, frame);
  await assertModelUnchanged();
  ledger.scenarios.push({
    name: "actual-canvas-center-radius-circle",
    center: [15, -10],
    radiusMm: 5,
    twoAnalyticArcs: true,
    dragEscapePreservesRevision: true,
    successfulNextGesture: true,
  });
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual((await readSketch()).sketch, beforeCircle);
  await panel
    .getByRole("button", { name: "Redo sketch edit", exact: true })
    .click();
  await eventually(async () =>
    assert.deepEqual((await readSketch()).sketch, gui),
  );
  await panel
    .getByRole("button", { name: "Undo sketch edit", exact: true })
    .click();
  await eventually(async () =>
    assert.deepEqual((await readSketch()).sketch, beforeCircle),
  );
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await readSketch()).sketch, gui);
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual((await readSketch()).sketch, beforeCircle);
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await readSketch()).sketch, gui);
  await assertModelUnchanged();
  await mutate("sketch_manage", {
    action: "create",
    name: "Independent public MCP drawing intents",
    sketch: blank,
  });
  await mutate("sketch_draw", {
    kind: "line",
    points: [
      [0.2, 0.2],
      [15.2, 0.2],
    ],
    autoConstraints: true,
    snapToleranceMm: 0.5,
  });
  const mcpSecond = (
    await mutate("sketch_draw", {
      kind: "line",
      points: [
        [15.2, 0.2],
        [15.2, 10.2],
      ],
      autoConstraints: true,
      snapToleranceMm: 0.5,
    })
  ).result;
  await mutate("sketch_draw", {
    kind: "arc3",
    points: [
      [-25, -5],
      [-20, 0],
      [-15, -5],
    ],
  });
  await mutate("sketch_draw", {
    kind: "move",
    pointId: mcpSecond.createdPointIds[0],
    position: [15, 12],
  });
  await mutate("sketch_draw", {
    kind: "circle",
    points: [
      [15.2, -10.2],
      [20.2, -10.2],
    ],
  });
  const canonical = (sketch) => {
    const ids = new Map([
      ...sketch.points.map((p, i) => [p.id, `point/${i}`]),
      ...sketch.segments.map((p, i) => [p.id, `line/${i}`]),
      ...(sketch.arcs ?? []).map((p, i) => [p.id, `arc/${i}`]),
    ]);
    const row = (value) =>
      Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "id")
          .map(([key, item]) => [
            key,
            typeof item === "string" ? (ids.get(item) ?? item) : item,
          ]),
      );
    return {
      frame: sketch.frame,
      points: sketch.points.map(row),
      segments: sketch.segments.map(row),
      arcs: (sketch.arcs ?? []).map(row),
      constraints: sketch.constraints.map(row),
    };
  };
  assert.deepEqual(
    canonical((await readSketch()).sketch),
    canonical(gui),
    "Independent public drawing intents reproduce GUI geometry/topology/constraints",
  );
  await mutate("sketch_manage", { action: "activate", sketchId: active });
  const expected = await readSketch();
  await page.screenshot({
    path: fileURLToPath(new URL("canvas-line-arc-circle.png", artifactDir)),
  });
  const exported = await settled(
    await call("project_export", { format: "project" }),
  );
  const download = (
    await call("artifact_read", { artifactId: exported.artifactId })
  ).result;
  assert.equal(download.eof, true);
  await writeFile(
    new URL("canvas-sketches.scanforge", artifactDir),
    Buffer.from(download.base64, "base64"),
  );
  await settled(
    await mutate("project_import", {
      artifactId: exported.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(await readSketch(), expected);
  await assertModelUnchanged();
  ledger.scenarios.push({
    name: "public-sketch-equivalence-history-worker-reopen",
    guiMcpUndoRedo: true,
    independentIntentGeometryEquality: true,
    idsPreservedOnReopen: true,
    savedSketches: 2,
    modelHistoryUnchanged: true,
  });
  await save();
  // This existing helper covers real GUI Add constraint and public MCP failure
  // atomicity, plus solved collinearity/history/reopen on all three frame planes.
  await sketchCollinear({
    page,
    call,
    raw,
    mutate,
    tools,
    ledger,
    save,
    signal: lease.signal,
  });
  assert.equal(ledger.sketchCollinear.guiMcpConflictAtomicity, true);
  assert.equal(ledger.sketchCollinear.completedWorkflowPassed, true);
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
  `Sketch canvas GUI/public MCP acceptance passed: ${fileURLToPath(evidence)}`,
);

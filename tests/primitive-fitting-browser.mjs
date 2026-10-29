import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
const startedAt = new Date().toISOString();
const token = randomBytes(32).toString("hex");
const ledger = {
  owner: "scanforge-m4-primitive-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(
  `.resources/m4-primitive-datum/${randomUUID()}/`,
  root,
);
await mkdir(artifactDir, { recursive: true });
ledger.artifactDirectory = fileURLToPath(artifactDir);
console.log("Artifacts:", ledger.artifactDirectory);
const evidence = new URL("browser-validation.json", artifactDir);
let browserServer, browser, client, transport, page;
let failed;
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
    const path = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    const file = new URL(
      path === "/" ? "index.html" : path.slice(1),
      new URL("dist/", root),
    );
    if (!file.href.startsWith(new URL("dist/", root).href))
      throw Error("Forbidden path");
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
await new Promise((resolve, reject) => {
  staticServer.once("error", reject);
  staticServer.listen(0, "127.0.0.1", resolve);
});
const appPort = staticServer.address().port,
  origin = `http://127.0.0.1:${appPort}`;
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const bridgePort = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
ledger.resources.push({
  kind: "http-server",
  pid: process.pid,
  executable: process.execPath,
  startedAt,
  port: appPort,
  bind: "127.0.0.1",
  purpose: "isolated built application",
});
const deadline = setTimeout(() => {
  failed = Error("Browser validation exceeded4minute lease");
  void cleanup();
}, 240000);
async function cleanup() {
  clearTimeout(deadline);
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  await new Promise((resolve) => {
    staticServer.close(resolve);
    staticServer.closeAllConnections();
  });
  for (const port of [appPort, bridgePort]) {
    let closed = false;
    try {
      await fetch(`http://127.0.0.1:${port}`, {
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      closed = true;
    }
    ledger.cleanup.push({ port, closed });
    assert(closed, `Port ${port} remained open`);
  }
  for (const resource of ledger.resources.filter((r) =>
    ["mcp-stdio-child", "disposable-browser"].includes(r.kind),
  )) {
    let exited = false;
    try {
      process.kill(resource.pid, 0);
    } catch {
      exited = true;
    }
    ledger.cleanup.push({ pid: resource.pid, exited });
    assert(exited, `${resource.kind} process still alive`);
  }
  await writeFile(
    evidence,
    JSON.stringify(
      { ...ledger, passed: !failed, error: failed?.message },
      null,
      2,
    ),
  );
}
try {
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
  let stderr = "";
  transport.stderr?.on("data", (data) => {
    stderr += data;
  });
  client = new Client({ name: "scanforge-browser-smoke", version: "1.0.0" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-stdio-child",
    pid: transport.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    port: bridgePort,
    bind: "127.0.0.1",
    purpose: "actual stdio SDK and browser bridge",
  });
  const discovered = await client.listTools();
  assert(discovered.tools.length >= 35);
  const guide = await client.readResource({ uri: "scanforge://agent-guide" });
  assert(guide.contents[0].text.includes("expectedRevision"));
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  ledger.resources.push({
    kind: "disposable-browser",
    pid: browserServer.process().pid,
    executable: "installed Chrome",
    startedAt: new Date().toISOString(),
    purpose: "isolated profile and UI validation",
  });
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (error) => {
    if (errors.length < 20)
      console.error("Browser page error:", error.stack ?? error.message);
    errors.push(error.message);
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
  // Closing Settings must leave the paired session alive.
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    const wire = result.structuredContent ?? JSON.parse(result.content[0].text);
    assert(wire.ok, `${name}: ${JSON.stringify(wire)}`);
    return wire;
  }
  async function mutate(name, args) {
    const state = await call("project_get");
    return call(name, {
      ...args,
      expectedRevision: state.revision,
      requestId: randomUUID(),
    });
  }
  async function waitForImportPresentation() {
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = (await call("application_inspect", { maxControls: 1 }))
        .result;
      if (state.busy === false) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Imported objects appeared before presentation finished");
  }
  async function job(receipt) {
    const id = receipt.result.jobId;
    for (let i = 0; i < 120; i++) {
      const result = await call("job_get", { jobId: id });
      if (result.result.status !== "running") {
        assert.equal(result.result.status, "succeeded", JSON.stringify(result));
        return result.result.result;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw Error("Geometry job failed to settle");
  }
  async function waitForSketch(expected) {
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        assert.deepEqual((await call("sketch_get")).result.sketch, expected);
        return;
      } catch (error) {
        if (attempt === 119) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  const points = [
    0.000000001, 0, 5, 10.00000001, 0, 5, 0, 10.00000001, 5, 100, 100, 100, 110,
    100, 100, 100, 110, 100,
  ];
  const project = {
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "M4 analytic",
    entities: [
      {
        id: "scan",
        name: "Analytic scan",
        kind: "mesh",
        positions: points,
        color: "#aaaaaa",
        visible: true,
        opacity: 1,
      },
    ],
  };
  await page
    .locator('input[type=file][accept*=".scanforge"]')
    .first()
    .setInputFiles({
      name: "m4-analytic.scanforge",
      mimeType: "application/x-scanforge",
      buffer: Buffer.from(JSON.stringify(project)),
    });
  await page
    .getByRole("button", { name: "Analytic scan", exact: true })
    .waitFor();
  await waitForImportPresentation();
  await mutate("object_select", { entityId: "scan" });
  const whole = await job(
    await call("analysis_fit", { entityId: "scan", kind: "plane" }),
  );
  const region = { center: [0, 0, 5], radius: 20 };
  const local = await job(
    await call("analysis_fit", { entityId: "scan", kind: "plane", region }),
  );
  assert.equal(local.samples, 3);
  assert.equal(local.fit.rms, 0);
  await mutate("ui_set", { workspace: "fit", toolPanelOpen: true });
  await page.getByRole("tab", { name: "Construct", exact: true }).click();
  await page
    .getByRole("group", { name: "Primitives", exact: true })
    .getByRole("button", { name: "Plane", exact: true })
    .click();
  const createButton = page.getByRole("button", {
    name: "Create fitted plane",
    exact: true,
  });
  await createButton.waitFor();
  await createButton.click();
  await page
    .getByRole("button", { name: "Fitted plane reference", exact: true })
    .waitFor();
  const guiPlane = (await call("project_get")).result.objects.find(
    (row) => row.kind === "plane",
  );
  assert.deepEqual(guiPlane.fit, whole.fit);
  assert.deepEqual(guiPlane.planeFrame.center, whole.fit.center);
  assert.deepEqual(guiPlane.planeFrame.normal, whole.fit.axis);
  await mutate("history_undo", {});
  assert.equal((await call("project_get")).result.objects.length, 1);
  const agentPlane = await job(
    await mutate("primitive_fit_create", { entityId: "scan", kind: "plane" }),
  );
  assert.deepEqual(agentPlane.fit, guiPlane.fit);
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  const reopened = (await call("object_get", { entityId: agentPlane.entityId }))
    .result;
  assert.deepEqual(reopened.fit, agentPlane.fit);
  assert.deepEqual(reopened.planeFrame, guiPlane.planeFrame);
  await page.screenshot({
    path: fileURLToPath(new URL("analytic-plane.png", artifactDir)),
  });
  console.log("analytic GUI/MCP fit/create/reopen passed");
  await mutate("project_new", { discard: true });
  const original =
    process.env.SCANFORGE_M4_SCAN ??
    "C:/repo/alignment-example-files/ply-1.ply";
  const bytes = await readFile(original);
  ledger.originalInput = {
    path: original,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await page
    .locator('input[type=file][accept*=".scanforge"]')
    .first()
    .setInputFiles(original);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByRole("button", { name: "ply-1.ply", exact: true })
    .waitFor()
    .catch(async (error) => {
      await page.screenshot({
        path: fileURLToPath(new URL("import-state.png", artifactDir)),
      });
      await writeFile(
        new URL("import-state.txt", artifactDir),
        await page.locator("body").innerText(),
      );
      throw error;
    });
  await waitForImportPresentation();
  const scan = (await call("project_get")).result.objects[0];
  const scanDigest = (
    await job(await call("object_geometry_digest", { entityId: scan.id }))
  ).buffers;
  await mutate("object_select", { entityId: scan.id });
  const actualFit = await job(
    await call("analysis_fit", { entityId: scan.id, kind: "plane" }),
  );
  assert(actualFit.samples > 0 && actualFit.samples <= 20000);
  assert(Number.isFinite(actualFit.fit.rms));
  await mutate("ui_set", { workspace: "fit", toolPanelOpen: true });
  await page.getByRole("tab", { name: "Construct", exact: true }).click();
  await page
    .getByRole("group", { name: "Primitives", exact: true })
    .getByRole("button", { name: "Plane", exact: true })
    .click();
  await createButton.waitFor();
  await createButton.click();
  await page
    .getByRole("button", { name: "Fitted plane reference", exact: true })
    .waitFor();
  const scanPlane = (await call("project_get")).result.objects.find(
    (row) => row.kind === "plane",
  );
  assert.deepEqual(scanPlane.fit, actualFit.fit);
  assert.deepEqual(scanPlane.planeFrame.center, actualFit.fit.center);
  ledger.originalPlaneFit = actualFit;
  // R37's original-native fitted-plane duplicate retained the displayed
  // normal and offset after reopening. Compare the shared GUI/MCP action on
  // this same scan, without claiming the native and application fit inputs
  // or resulting planes are numerically identical.
  const beforeDuplicate = (await call("project_get")).result.objects;
  const planeIndex = beforeDuplicate.findIndex(
    (row) => row.id === scanPlane.id,
  );
  assert(planeIndex >= 0);
  await page
    .locator(".objects-panel > .object-list > li")
    .nth(planeIndex)
    .getByRole("button", { name: scanPlane.name, exact: true })
    .click({ button: "right" });
  const objectMenu = page.getByRole("menu", {
    name: "Object actions",
    exact: true,
  });
  await objectMenu
    .getByRole("menuitem", { name: "Duplicate", exact: true })
    .click();
  const afterGuiDuplicate = (await call("project_get")).result.objects;
  const guiCopy = afterGuiDuplicate.find(
    (row) => !beforeDuplicate.some((before) => before.id === row.id),
  );
  assert(guiCopy && guiCopy.id !== scanPlane.id);
  assert.deepEqual(guiCopy.fit, scanPlane.fit);
  assert.deepEqual(guiCopy.planeFrame, scanPlane.planeFrame);
  await page.screenshot({
    path: fileURLToPath(new URL("fitted-plane-gui-duplicate.png", artifactDir)),
  });
  await mutate("history_undo", {});
  assert.deepEqual(
    (await call("project_get")).result.objects.map((row) => row.id),
    beforeDuplicate.map((row) => row.id),
  );
  const agentCopyId = (
    await mutate("object_duplicate", { entityId: scanPlane.id })
  ).result.entityId;
  const agentCopy = (await call("object_get", { entityId: agentCopyId }))
    .result;
  assert(agentCopyId !== scanPlane.id);
  assert.deepEqual(agentCopy.fit, guiCopy.fit);
  assert.deepEqual(agentCopy.planeFrame, guiCopy.planeFrame);
  const duplicateProject = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: duplicateProject.artifactId,
      replace: true,
    }),
  );
  const reopenedCopy = (await call("object_get", { entityId: agentCopyId }))
    .result;
  assert.deepEqual(reopenedCopy.fit, scanPlane.fit);
  assert.deepEqual(reopenedCopy.planeFrame, scanPlane.planeFrame);
  assert.deepEqual(
    (await call("object_get", { entityId: scanPlane.id })).result.planeFrame,
    scanPlane.planeFrame,
  );
  await mutate("history_undo", {});
  assert.deepEqual(
    (await call("project_get")).result.objects.map((row) => row.id),
    beforeDuplicate.map((row) => row.id),
  );
  ledger.fittedPlaneDuplicate = {
    guiAndPublicMcpEqual: true,
    distinctIdentity: true,
    copiedFitAndFrame: true,
    undoAndWorkerReopen: true,
    nativeFixture: "R37",
    nativeFitPopulationEquivalent: false,
    nativeCopyLinkPolicyEstablished: false,
  };
  await page.screenshot({
    path: fileURLToPath(new URL("original-scan-plane.png", artifactDir)),
  });

  // A fitted source plane must retain its in-plane tangent in both editors.
  await page.getByRole("tab", { name: "Sketch", exact: true }).click();
  await page.getByRole("button", { name: "New sketch", exact: true }).click();
  await page
    .getByRole("button", { name: "Reference or custom plane…", exact: true })
    .click();
  const planeDialog = page.getByRole("dialog", {
    name: "Create sketch on a plane",
    exact: true,
  });
  await planeDialog.locator(".app-select > button").click();
  await page
    .getByRole("option", { name: "Fitted plane reference", exact: true })
    .click();
  await planeDialog
    .getByLabel("Normal offset (mm)", { exact: true })
    .fill("2.5");
  await planeDialog
    .getByRole("button", { name: "Create sketch", exact: true })
    .click();
  await planeDialog.waitFor({ state: "hidden" });
  const guiSketch = (await call("sketch_get")).result;
  assert.equal(guiSketch.sketches.length, 1);
  const guiFrame = guiSketch.sketch.frame;
  const createdSketch = await mutate("sketch_manage", {
    action: "create",
    name: "MCP on same scan plane",
    planeSourceId: scanPlane.id,
    normalOffset: 2.5,
  });
  assert.deepEqual(createdSketch.result.frame, guiFrame);
  const empty = (await call("sketch_get")).result.sketch;
  assert.deepEqual(empty.frame, guiFrame);
  // Keep failure and cancellation checks on the same scan-derived plane.
  await mutate("sketch_manage", {
    action: "activate",
    sketchId: guiSketch.activeSketchId,
  });
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
    dismissError: true,
  });
  const sketchPanel = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  await sketchPanel.waitFor();
  await sketchPanel
    .getByRole("button", { name: "Reset rectangle", exact: true })
    .click();
  const draft = sketchPanel.getByLabel("p2 x", { exact: true });
  await draft.waitFor();
  const guiRectangle = (await call("sketch_get")).result.sketch;
  assert.deepEqual(guiRectangle.frame, guiFrame);
  assert.equal(guiRectangle.segments.length, 4);
  const guiBeforeCancel = (await call("sketch_get")).result;
  const guiRevision = (await call("project_get")).revision;
  await draft.click();
  await draft.press("ControlOrMeta+A");
  await draft.pressSequentially("-12.5");
  assert.equal(await draft.inputValue(), "-12.5");
  await draft.press("Escape");
  assert.equal(await draft.inputValue(), "40");
  assert.deepEqual((await call("sketch_get")).result, guiBeforeCancel);
  assert.equal((await call("project_get")).revision, guiRevision);
  for (const [control, option] of [
    ["Constraint", "distance"],
    ["First reference", "p1"],
    ["Second reference", "p2"],
  ]) {
    await sketchPanel
      .getByRole("button", { name: control, exact: true })
      .click();
    await page.getByRole("option", { name: option, exact: true }).click();
  }
  await sketchPanel.getByLabel("Dimension", { exact: true }).fill("10");
  await sketchPanel
    .getByRole("button", { name: "Add constraint", exact: true })
    .click();
  await sketchPanel.getByText(/Conflicting or unsolved constraints:/).waitFor();
  assert.deepEqual((await call("sketch_get")).result, guiBeforeCancel);
  assert.equal((await call("project_get")).revision, guiRevision);
  await page.screenshot({
    path: fileURLToPath(
      new URL("scan-plane-conflicting-constraint.png", artifactDir),
    ),
  });
  await mutate("ui_set", { dismissError: true });
  await sketchPanel
    .getByRole("button", { name: "Undo sketch edit", exact: true })
    .click();
  await waitForSketch(empty);
  await sketchPanel
    .getByRole("button", { name: "Redo sketch edit", exact: true })
    .click();
  await waitForSketch(guiRectangle);

  await mutate("sketch_manage", {
    action: "activate",
    sketchId: createdSketch.result.sketchId,
  });
  await mutate("sketch_edit", { kind: "preset", profile: "rectangle" });
  assert.deepEqual((await call("sketch_get")).result.sketch, guiRectangle);
  const mcpBeforeConflict = (await call("sketch_get")).result;
  const mcpRevision = (await call("project_get")).revision;
  const rejectedResult = await client.callTool({
    name: "sketch_edit",
    arguments: {
      kind: "constraintAdd",
      constraint: { kind: "distance", a: "p1", b: "p2", value: 10 },
      expectedRevision: mcpRevision,
      requestId: randomUUID(),
    },
  });
  const rejected =
    rejectedResult.structuredContent ??
    JSON.parse(rejectedResult.content[0].text);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "OPERATION_FAILED");
  assert.deepEqual((await call("sketch_get")).result, mcpBeforeConflict);
  assert.equal((await call("project_get")).revision, mcpRevision);
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual((await call("sketch_get")).result.sketch, empty);
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await call("sketch_get")).result.sketch, guiRectangle);
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual((await call("sketch_get")).result.sketch, empty);
  ledger.scanPlaneSketchGuards = {
    guiCancel: true,
    guiAndMcpRejectedConflictAtomically: true,
    guiAndMcpScopedUndoRedo: true,
  };
  const profile = {
    ...empty,
    points: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 0 },
      { id: "c", x: 10, y: 5 },
      { id: "d", x: 0, y: 5 },
    ],
    segments: [
      { id: "ab", a: "a", b: "b" },
      { id: "bc", a: "b", b: "c" },
      { id: "cd", a: "c", b: "d" },
      { id: "da", a: "d", b: "a" },
    ],
    constraints: [
      { id: "anchor", kind: "fixed", point: "a", x: 0, y: 0 },
      { id: "h1", kind: "horizontal", segment: "ab" },
      { id: "h2", kind: "horizontal", segment: "cd" },
      { id: "v1", kind: "vertical", segment: "bc" },
      { id: "v2", kind: "vertical", segment: "da" },
      { id: "width", kind: "distance", a: "a", b: "b", value: 10 },
      { id: "height", kind: "distance", a: "b", b: "c", value: 5 },
    ],
  };
  const solved = await mutate("sketch_set", { sketch: profile, solve: true });
  assert(solved.result.solution.converged);
  assert.equal(solved.result.solution.degreesOfFreedom, 0);
  await mutate("history_undo", { scope: "sketch" });
  assert.equal((await call("sketch_get")).result.sketch.points.length, 0);
  await mutate("history_redo", { scope: "sketch" });
  const solvedSketch = (await call("sketch_get")).result.sketch;
  assert.deepEqual(solvedSketch.frame, guiFrame);
  assert.equal(solvedSketch.constraints.length, 7);
  await mutate("viewport_control", {
    action: "camera",
    position: guiFrame.origin.map((n, i) => n + guiFrame.normal[i] * 100),
    target: guiFrame.origin,
    up: guiFrame.v,
    projection: "perspective",
    zoom: 1,
  });
  const sketchView = (await call("viewport_get")).result;
  const canvas = page.locator(".viewport > canvas").first();
  const halfHeight = 100 * Math.tan((42 * Math.PI) / 360);
  const samples = Array.from({ length: 30 }, (_, i) => [
    sketchView.viewport.width / 2 +
      ((1 + (8 * i) / 29) * sketchView.viewport.height) / (2 * halfHeight),
    sketchView.viewport.height / 2 -
      (5 * sketchView.viewport.height) / (2 * halfHeight),
  ]);
  ledger.sketchCurveCoverage = {};
  for (const theme of ["light", "dark"]) {
    await mutate("settings_set", { patch: { theme } });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const screenshot = await canvas.screenshot();
    await writeFile(new URL(`sketch-${theme}.png`, artifactDir), screenshot);
    const coverage = await page.evaluate(
      async ({ base64, samples, theme }) => {
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const surface = new OffscreenCanvas(image.width, image.height),
          context = surface.getContext("2d");
        context.drawImage(image, 0, 0);
        const { data, width, height } = context.getImageData(
          0,
          0,
          image.width,
          image.height,
        );
        const visible = samples.filter(([x, y]) => {
          for (let yy = Math.round(y) - 1; yy <= Math.round(y) + 1; yy++)
            for (let xx = Math.round(x) - 1; xx <= Math.round(x) + 1; xx++) {
              if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
              const offset = (yy * width + xx) * 4;
              const rgb = [data[offset], data[offset + 1], data[offset + 2]];
              if (
                theme === "light"
                  ? Math.max(...rgb) < 110
                  : Math.min(...rgb) > 180
              )
                return true;
            }
          return false;
        });
        return visible.length / samples.length;
      },
      { base64: screenshot.toString("base64"), samples, theme },
    );
    assert(coverage > 0.9, `Sketch curve contrast in ${theme}: ${coverage}`);
    ledger.sketchCurveCoverage[theme] = coverage;
  }
  await mutate("settings_set", { patch: { theme: "light" } });
  await page.screenshot({
    path: fileURLToPath(new URL("scan-plane-closed-sketch.png", artifactDir)),
  });
  const sketchArtifact = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: sketchArtifact.artifactId,
      replace: true,
    }),
  );
  const restoredSketch = (await call("sketch_get")).result;
  assert.deepEqual(restoredSketch.sketch, solvedSketch);
  assert.equal(restoredSketch.sketches.length, 2);
  await mutate("sketch_manage", {
    action: "activate",
    sketchId: guiSketch.activeSketchId,
  });
  assert.deepEqual((await call("sketch_get")).result.sketch, guiRectangle);
  await mutate("sketch_manage", {
    action: "activate",
    sketchId: createdSketch.result.sketchId,
  });
  assert.deepEqual((await call("sketch_get")).result.sketch, solvedSketch);
  assert.deepEqual(
    (await job(await call("object_geometry_digest", { entityId: scan.id })))
      .buffers,
    scanDigest,
  );
  ledger.scanPlaneSketch = {
    sourceEntityId: scanPlane.id,
    frame: guiFrame,
    constraints: 7,
    closedProfile: true,
    reopened: true,
  };
  console.log(
    "original scan -> fitted plane -> GUI/MCP oriented sketch -> constrained profile/history/reopen passed",
  );

  ledger.solidFits = [];
  for (const [kind] of [
    ["sphere", "e"],
    ["cylinder", "c"],
    ["cone", "o"],
  ]) {
    const positions = [];
    for (let ring = 0; ring < 7; ring++)
      for (let angle = 0; angle < 24; angle++) {
        const theta = (angle * 2 * Math.PI) / 24;
        if (kind === "sphere") {
          const phi = ((ring + 1) * Math.PI) / 8;
          positions.push(
            5 * Math.sin(phi) * Math.cos(theta),
            5 * Math.sin(phi) * Math.sin(theta),
            5 * Math.cos(phi),
          );
        } else {
          const z = (ring * 10) / 6,
            radius = kind === "cone" ? 2 + z / 5 : 3;
          positions.push(radius * Math.cos(theta), radius * Math.sin(theta), z);
        }
      }
    const fixture = {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: `M4 ${kind}`,
      entities: [
        {
          id: `${kind}-scan`,
          name: `${kind} samples`,
          kind: "pointcloud",
          positions,
          color: "#aaff00",
          visible: true,
          opacity: 1,
        },
      ],
    };
    await page
      .locator('input[type=file][accept*=".scanforge"]')
      .first()
      .setInputFiles({
        name: `${kind}.scanforge`,
        mimeType: "application/x-scanforge",
        buffer: Buffer.from(JSON.stringify(fixture)),
      });
    await page
      .getByRole("button", { name: `${kind} samples`, exact: true })
      .waitFor();
    await waitForImportPresentation();
    await mutate("object_select", { entityId: `${kind}-scan` });
    const expected = await job(
      await call("analysis_fit", { entityId: `${kind}-scan`, kind }),
    );
    assert(expected.fit.rms < 1e-5, JSON.stringify(expected));
    await mutate("ui_set", { workspace: "fit", toolPanelOpen: true });
    await page.getByRole("tab", { name: "Construct", exact: true }).click();
    await page
      .getByRole("group", { name: "Primitives", exact: true })
      .getByRole("button", {
        name: kind[0].toUpperCase() + kind.slice(1),
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: `Create fitted ${kind}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: `Fitted ${kind}`, exact: true })
      .waitFor();
    const solid = (await call("project_get")).result.objects.find(
      (row) => row.exactCad,
    );
    assert(solid);
    assert.equal(solid.kind, kind);
    assert.deepEqual(solid.fit, expected.fit);
    ledger.solidFits.push({
      kind,
      fit: solid.fit,
      entityId: solid.id,
      exactCad: solid.exactCad,
    });
    const artifact = await job(
      await call("project_export", { format: "project" }),
    );
    await job(
      await mutate("project_import", {
        artifactId: artifact.artifactId,
        replace: true,
      }),
    );
    const restored = (await call("object_get", { entityId: solid.id })).result;
    assert(restored.exactCad);
    assert.deepEqual(restored.fit, expected.fit);
    console.log(`${kind} actual CAD GUI/MCP fit and reopen passed`);
  }
  // STEP uses exact CAD only in the same mixed scene for GUI and public MCP.
  const beforeStep = await job(
    await call("project_export", { format: "project" }),
  );
  for (const kind of ["plane", "frame"])
    await mutate("datum_construct", {
      kind,
      origin: [1000, 2000, 3000],
      normal: [0, 0, 1],
      displaySize: 20,
      name: `STEP excluded ${kind}`,
    });
  const mixedStepScene = (await call("project_get")).result.objects;
  assert(mixedStepScene.some((row) => row.exactCad));
  assert(mixedStepScene.some((row) => row.kind === "pointcloud"));
  assert(mixedStepScene.some((row) => row.kind === "plane"));
  assert(mixedStepScene.some((row) => row.kind === "referenceFrame"));
  const guiStepDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STEP", exact: true }).click();
  const guiStep = await guiStepDownload;
  assert.equal(await guiStep.failure(), null);
  const guiStepChunks = [];
  for await (const chunk of await guiStep.createReadStream())
    guiStepChunks.push(chunk);
  const guiStepBytes = Buffer.concat(guiStepChunks);
  await waitForImportPresentation();
  async function artifactBytes(artifactId) {
    const chunks = [];
    let offset = 0;
    for (;;) {
      const part = (
        await call("artifact_read", { artifactId, offset, length: 262144 })
      ).result;
      chunks.push(Buffer.from(part.base64, "base64"));
      if (part.eof) return Buffer.concat(chunks);
      assert(part.nextOffset > offset);
      offset = part.nextOffset;
    }
  }
  const mcpStep = await job(
    await call("project_export", { format: "step", cadOnly: true }),
  );
  const mcpStepBytes = await artifactBytes(mcpStep.artifactId);
  const stepReadbacks = [];
  for (const [producer, bytes] of [
    ["GUI", guiStepBytes],
    ["MCP", mcpStepBytes],
  ]) {
    assert(bytes.length > 0);
    assert(bytes.toString("utf8").includes("ISO-10303-21"));
    assert(
      bytes.length <= 1048576,
      "Small STEP fixture must fit one upload chunk",
    );
    const uploaded = (
      await call("artifact_put", {
        name: `${producer.toLowerCase()}-mixed-scene.step`,
        base64: bytes.toString("base64"),
        offset: 0,
      })
    ).result;
    const imported = await job(
      await mutate("project_import", {
        artifactId: uploaded.artifactId,
        replace: true,
      }),
    );
    const objects = (await call("project_get")).result.objects;
    assert.equal(
      objects.length,
      1,
      `${producer} STEP restores only the exact CAD body`,
    );
    const details = (
      await call("object_get", {
        entityId: imported.entityId,
        includeGeometry: true,
      })
    ).result;
    assert(details.exactCad);
    assert(details.triangles > 0);
    const geometry = JSON.parse(
      (await artifactBytes(details.geometry.artifactId)).toString("utf8"),
    );
    assert(geometry.positions.length > 0);
    assert(
      geometry.positions.every(
        (value) => Number.isFinite(value) && Math.abs(value) < 100,
      ),
      "Far-away datum display must not enter the real CAD readback",
    );
    stepReadbacks.push(geometry.positions);
  }
  assert.deepEqual(
    stepReadbacks[0],
    stepReadbacks[1],
    "GUI download and independent MCP artifact restore identical real-kernel geometry",
  );
  ledger.mixedSceneStep = {
    guiBytes: guiStepBytes.length,
    mcpBytes: mcpStepBytes.length,
    producers: ["actual GUI download", "public MCP artifact"],
    excluded: [
      "pointcloud scan",
      "numeric plane display",
      "coordinate frame display",
    ],
    realKernelImports: 2,
    restoredExactBodiesPerImport: 1,
    identicalRestoredTriangleGeometry: true,
  };
  await job(
    await mutate("project_import", {
      artifactId: beforeStep.artifactId,
      replace: true,
    }),
  );
  console.log(
    "mixed-scene actual GUI/MCP STEP export and real CAD readback passed",
  );
  // Named numeric datum planes use the same publication boundary from GUI and MCP.
  const numericArgs = {
    kind: "plane",
    origin: [2, 3, 4],
    normal: [0, 0, 1],
    xDirection: [0, 1, 0],
    displaySize: 25,
    name: "Numeric rolled plane",
  };
  const numericApi = (await mutate("datum_construct", numericArgs)).result;
  const expectedNumeric = (
    await call("object_get", { entityId: numericApi.entityId })
  ).result;
  await mutate("history_undo", {});
  await page.getByRole("tab", { name: "Construct", exact: true }).click();
  await page
    .getByRole("button", { name: "Reference plane", exact: true })
    .click();
  let datumDialog = page.getByRole("dialog", {
    name: "Create reference plane",
    exact: true,
  });
  await datumDialog
    .getByLabel("Datum name", { exact: true })
    .fill(numericArgs.name);
  for (const [label, values] of [
    ["Origin (mm)", [2, 3, 4]],
    ["Normal", [0, 0, 1]],
    ["X direction", [0, 1, 0]],
  ])
    for (const [index, axis] of ["X", "Y", "Z"].entries())
      await datumDialog
        .getByLabel(`${label} ${axis}`, { exact: true })
        .fill(String(values[index]));
  await datumDialog
    .getByLabel("Datum display size", { exact: true })
    .fill("25");
  await datumDialog.getByRole("button", { name: "Apply", exact: true }).click();
  await datumDialog.waitFor({ state: "detached" });
  const numericGui = (await call("project_get")).result.objects.find(
    (row) => row.name === numericArgs.name,
  );
  assert(numericGui);
  let numericReadback = (await call("object_get", { entityId: numericGui.id }))
    .result;
  assert.deepEqual(numericReadback.planeFrame, expectedNumeric.planeFrame);
  assert.equal(numericReadback.fit, undefined);
  await mutate("object_select", { entityId: numericGui.id });
  await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
  const beforeNumericCancel = await call("project_get");
  await page
    .getByRole("button", { name: "Edit reference plane", exact: true })
    .click();
  datumDialog = page.getByRole("dialog", {
    name: "Edit reference plane",
    exact: true,
  });
  await datumDialog.getByLabel("Origin (mm) X", { exact: true }).fill("99");
  await datumDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await datumDialog.waitFor({ state: "detached" });
  assert.equal(
    (await call("project_get")).revision,
    beforeNumericCancel.revision,
  );
  assert.deepEqual(
    (await call("object_get", { entityId: numericGui.id })).result.planeFrame,
    expectedNumeric.planeFrame,
  );
  await page
    .getByRole("button", { name: "Edit reference plane", exact: true })
    .click();
  datumDialog = page.getByRole("dialog", {
    name: "Edit reference plane",
    exact: true,
  });
  await datumDialog.getByLabel("Origin (mm) X", { exact: true }).fill("6");
  await datumDialog.getByRole("button", { name: "Apply", exact: true }).click();
  await datumDialog.waitFor({ state: "detached" });
  numericReadback = (await call("object_get", { entityId: numericGui.id }))
    .result;
  assert.deepEqual(numericReadback.planeFrame.center, [6, 3, 4]);
  await mutate("history_undo", {});
  assert.deepEqual(
    (await call("object_get", { entityId: numericGui.id })).result.planeFrame,
    expectedNumeric.planeFrame,
  );
  await mutate("history_redo", {});
  const numericProject = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: numericProject.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(
    (await call("object_get", { entityId: numericGui.id })).result.planeFrame,
    numericReadback.planeFrame,
  );
  const numericSketch = (
    await mutate("sketch_manage", {
      action: "create",
      name: "Numeric datum sketch",
      planeSourceId: numericGui.id,
      normalOffset: 2,
    })
  ).result;
  assert.deepEqual(numericSketch.frame, {
    origin: [6, 3, 6],
    u: [0, 1, 0],
    v: [-1, 0, 0],
    normal: [0, 0, 1],
  });
  ledger.numericDatum = {
    guiMcpEqual: true,
    cancelUnchanged: true,
    editUndoRedo: true,
    workerReopen: true,
    sketchFrame: numericSketch.frame,
  };
  console.log(
    "numeric reference plane GUI/MCP create/edit/Cancel/history/reopen and detached sketch placement passed",
  );
  // Plane transforms retain their datum through the same GUI/MCP operation.
  const planeTransform = {
    entityId: numericGui.id,
    translation: [1, 2, 3],
    rotation: [0, 0, 90],
    scale: 2,
  };
  await mutate("mesh_transform", planeTransform);
  const transformedNumeric = (
    await call("object_get", { entityId: numericGui.id })
  ).result;
  assert.equal(transformedNumeric.kind, "plane");
  assert(transformedNumeric.planeFrame);
  await mutate("history_undo", {});
  await mutate("object_select", { entityId: numericGui.id });
  await mutate("ui_set", { workspace: "transform", toolPanelOpen: true });
  for (const [index, axis] of ["X", "Y", "Z"].entries())
    await page
      .getByLabel(`Move (mm) ${axis}`, { exact: true })
      .fill(String(planeTransform.translation[index]));
  await page.getByLabel(/^Rotate .* Z$/).fill("90");
  await page.getByLabel("Uniform scale", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Apply transform", exact: true })
    .click();
  await page
    .getByText("Reference plane transform applied", { exact: true })
    .waitFor();
  assert.deepEqual(
    (await call("object_get", { entityId: numericGui.id })).result.planeFrame,
    transformedNumeric.planeFrame,
  );
  await mutate("history_undo", {});
  ledger.numericDatum.transformGuiMcpEqual = true;
  const frameArgs = {
    kind: "frame",
    origin: [2, 3, 4],
    normal: [0, 0, 1],
    xDirection: [0, 1, 0],
    displaySize: 15,
    name: "GUI coordinate system",
  };
  const frameApi = (await mutate("datum_construct", frameArgs)).result;
  const expectedFrame = (
    await call("object_get", { entityId: frameApi.entityId })
  ).result.coordinateFrame;
  await mutate("history_undo", {});
  await page.getByRole("tab", { name: "Construct", exact: true }).click();
  await page
    .getByRole("button", { name: "Coordinate system", exact: true })
    .click();
  datumDialog = page.getByRole("dialog", {
    name: "Create coordinate system",
    exact: true,
  });
  await datumDialog
    .getByLabel("Datum name", { exact: true })
    .fill(frameArgs.name);
  for (const [label, values] of [
    ["Origin (mm)", [2, 3, 4]],
    ["Normal", [0, 0, 1]],
    ["X direction", [0, 1, 0]],
  ])
    for (const [index, axis] of ["X", "Y", "Z"].entries())
      await datumDialog
        .getByLabel(`${label} ${axis}`, { exact: true })
        .fill(String(values[index]));
  await datumDialog
    .getByLabel("Datum display size", { exact: true })
    .fill("15");
  await datumDialog.getByRole("button", { name: "Apply", exact: true }).click();
  await datumDialog.waitFor({ state: "detached" });
  const guiFrameObject = (await call("project_get")).result.objects.find(
    (row) => row.name === frameArgs.name,
  );
  assert(guiFrameObject);
  assert.equal(guiFrameObject.kind, "referenceFrame");
  // A GUI draft captures its model revision; concurrent MCP changes must win.
  await mutate("object_select", { entityId: guiFrameObject.id });
  await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
  await page
    .getByRole("button", { name: "Edit coordinate system", exact: true })
    .click();
  datumDialog = page.getByRole("dialog", {
    name: "Edit coordinate system",
    exact: true,
  });
  await mutate("datum_construct", {
    ...frameArgs,
    entityId: guiFrameObject.id,
    name: undefined,
    origin: [8, 3, 4],
  });
  const concurrentFrameRevision = (await call("project_get")).revision;
  await datumDialog.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForFunction(() => {
    const dialog = document.querySelector(
      '[role="dialog"][aria-labelledby="datum-title"]',
    );
    return (
      !dialog ||
      !Array.from(dialog.querySelectorAll("button")).some((button) =>
        button.textContent.includes("Applying"),
      )
    );
  });
  assert(
    await datumDialog.isVisible(),
    "A stale GUI datum draft must remain open and reject Apply",
  );
  assert.match(
    await datumDialog.getByRole("alert").innerText(),
    /revision|changed|stale/i,
  );
  assert.equal((await call("project_get")).revision, concurrentFrameRevision);
  assert.deepEqual(
    (await call("object_get", { entityId: guiFrameObject.id })).result
      .coordinateFrame.frame.origin,
    [8, 3, 4],
  );
  await datumDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await datumDialog.waitFor({ state: "detached" });
  await mutate("history_undo", {});
  ledger.coordinateFrameStaleDraftRejected = true;
  let frameReadback = (
    await call("object_get", { entityId: guiFrameObject.id })
  ).result;
  assert.deepEqual(frameReadback.coordinateFrame, expectedFrame);
  assert.equal(frameReadback.triangles, 0);
  const frameScene = (await call("project_get")).result.objects;
  for (const object of frameScene)
    if (object.id !== guiFrameObject.id)
      await mutate("object_update", {
        entityId: object.id,
        patch: { visible: false },
      });
  await mutate("object_update", {
    entityId: guiFrameObject.id,
    patch: { color: "#ffbb44" },
  });
  await mutate("viewport_control", {
    action: "camera",
    position: [82, 83, 84],
    target: [2, 3, 4],
    up: [0, 0, 1],
    projection: "perspective",
    zoom: 1,
  });
  const frameView = (await call("viewport_get")).result;
  const projectionCamera = new PerspectiveCamera();
  projectionCamera.projectionMatrix.fromArray(frameView.projectionMatrix);
  projectionCamera.matrixWorld.fromArray(frameView.cameraWorldMatrix);
  projectionCamera.matrixWorldInverse
    .copy(projectionCamera.matrixWorld)
    .invert();
  const frameSamples = [
    expectedFrame.frame.u,
    expectedFrame.frame.v,
    expectedFrame.frame.normal,
  ].flatMap((axis) =>
    Array.from({ length: 12 }, (_, i) => {
      const point = new Vector3(...expectedFrame.frame.origin)
        .addScaledVector(new Vector3(...axis), 2 + i)
        .project(projectionCamera);
      return [
        ((point.x + 1) * frameView.viewport.width) / 2,
        ((1 - point.y) * frameView.viewport.height) / 2,
      ];
    }),
  );
  const frameHit = await call("viewport_pick", {
    x: frameSamples[5][0] / frameView.viewport.width,
    y: frameSamples[5][1] / frameView.viewport.height,
    maxHits: 1,
  });
  assert.equal(frameHit.result.hits[0].entityId, guiFrameObject.id);
  assert.equal(frameHit.result.hits[0].referenceKind, "frame");
  ledger.coordinateFrameCoverage = {};
  for (const theme of ["light", "dark"]) {
    await mutate("settings_set", { patch: { theme } });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const screenshot = await canvas.screenshot();
    await writeFile(
      new URL(`coordinate-frame-${theme}.png`, artifactDir),
      screenshot,
    );
    const coverage = await page.evaluate(
      async ({ base64, samples }) => {
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const surface = new OffscreenCanvas(image.width, image.height),
          context = surface.getContext("2d");
        context.drawImage(image, 0, 0);
        const { data, width, height } = context.getImageData(
          0,
          0,
          image.width,
          image.height,
        );
        return (
          samples.filter(([x, y]) => {
            for (let yy = Math.round(y) - 2; yy <= Math.round(y) + 2; yy++)
              for (let xx = Math.round(x) - 2; xx <= Math.round(x) + 2; xx++) {
                if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
                const offset = (yy * width + xx) * 4;
                if (
                  data[offset] > 180 &&
                  data[offset + 1] > 90 &&
                  data[offset + 2] < 150
                )
                  return true;
              }
            return false;
          }).length / samples.length
        );
      },
      { base64: screenshot.toString("base64"), samples: frameSamples },
    );
    assert(
      coverage > 0.85,
      `Coordinate-frame axes visible in ${theme}: ${coverage}`,
    );
    ledger.coordinateFrameCoverage[theme] = coverage;
  }
  await mutate("object_select", { entityId: guiFrameObject.id });
  await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
  const beforeFrameCancel = await call("project_get");
  await page
    .getByRole("button", { name: "Edit coordinate system", exact: true })
    .click();
  datumDialog = page.getByRole("dialog", {
    name: "Edit coordinate system",
    exact: true,
  });
  await datumDialog.getByLabel("Origin (mm) X", { exact: true }).fill("99");
  await datumDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await datumDialog.waitFor({ state: "detached" });
  assert.equal(
    (await call("project_get")).revision,
    beforeFrameCancel.revision,
  );
  await page
    .getByRole("button", { name: "Edit coordinate system", exact: true })
    .click();
  datumDialog = page.getByRole("dialog", {
    name: "Edit coordinate system",
    exact: true,
  });
  await datumDialog.getByLabel("Origin (mm) X", { exact: true }).fill("6");
  await datumDialog.getByRole("button", { name: "Apply", exact: true }).click();
  await datumDialog.waitFor({ state: "detached" });
  frameReadback = (await call("object_get", { entityId: guiFrameObject.id }))
    .result;
  assert.deepEqual(frameReadback.coordinateFrame.frame.origin, [6, 3, 4]);
  await mutate("history_undo", {});
  assert.deepEqual(
    (await call("object_get", { entityId: guiFrameObject.id })).result
      .coordinateFrame,
    expectedFrame,
  );
  await mutate("history_redo", {});
  const frameProject = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: frameProject.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(
    (await call("object_get", { entityId: guiFrameObject.id })).result
      .coordinateFrame,
    frameReadback.coordinateFrame,
  );
  for (const framePlane of ["XY", "YZ", "XZ"]) {
    const result = (
      await mutate("sketch_manage", {
        action: "create",
        name: `Frame ${framePlane}`,
        planeSourceId: guiFrameObject.id,
        framePlane,
        normalOffset: 2,
      })
    ).result;
    assert(result.frame);
    ledger[`coordinateFrame${framePlane}`] = result.frame;
  }
  await page.getByRole("tab", { name: "Sketch", exact: true }).click();
  await page.getByRole("button", { name: "New sketch", exact: true }).click();
  await page
    .getByRole("button", { name: /^Reference or custom plane/, exact: false })
    .click();
  const framePlacementDialog = page.getByRole("dialog", {
    name: "Create sketch on a plane",
    exact: true,
  });
  await framePlacementDialog.locator(".app-select > button").first().click();
  await page.getByRole("option", { name: frameArgs.name, exact: true }).click();
  await framePlacementDialog
    .getByRole("button", { name: "Coordinate-system plane", exact: true })
    .click();
  await page.getByRole("option", { name: "XZ", exact: true }).click();
  await framePlacementDialog
    .getByLabel("Normal offset (mm)", { exact: true })
    .fill("2");
  await framePlacementDialog
    .getByRole("button", { name: "Create sketch", exact: true })
    .click();
  await framePlacementDialog.waitFor({ state: "hidden" });
  assert.deepEqual(
    (await call("sketch_get")).result.sketch.frame,
    ledger.coordinateFrameXZ,
  );
  const frameReferences = await job(
    await call("alignment_references", { entityId: guiFrameObject.id }),
  );
  assert.equal(frameReferences.references.length, 7);
  assert.deepEqual(frameReferences.references[0].point, [6, 3, 4]);
  const alignmentTarget = frameScene.find(
    (row) => row.kind === "mesh" || row.kind === "pointcloud" || row.exactCad,
  );
  assert(alignmentTarget);
  await mutate("object_update", {
    entityId: alignmentTarget.id,
    patch: { visible: true },
  });
  await mutate("object_select", { entityId: alignmentTarget.id });
  await mutate("ui_set", { datumAlignmentOpen: true });
  await page
    .getByLabel("Reference 1 object", { exact: true })
    .selectOption(guiFrameObject.id);
  const featureSelect = page.getByLabel("Reference 1 feature", { exact: true });
  await featureSelect
    .getByRole("option", { name: /XY plane/ })
    .waitFor({ state: "attached" });
  assert.equal(await featureSelect.locator("option").count(), 8);
  await featureSelect.selectOption(
    frameReferences.references.find((row) => row.label === "XY plane").id,
  );
  await mutate("ui_set", { datumAlignmentOpen: false });
  ledger.coordinateFrameAlignment = {
    references: 7,
    guiPicker: true,
    origin: [6, 3, 4],
  };
  ledger.coordinateFrame = {
    guiMcpEqual: true,
    kind: "referenceFrame",
    cancelUnchanged: true,
    editUndoRedo: true,
    workerReopen: true,
    picking: true,
  };
  console.log(
    "coordinate frame GUI/MCP create/edit/Cancel/history/worker reopen, actual axis pixels and picking passed",
  );
  const preciseDatum = (
    await mutate("datum_construct", {
      kind: "plane",
      origin: [100000000.125, -20, 30],
      normal: [0, 0, 1],
      xDirection: [1, 0, 0],
      displaySize: 0.125,
      name: "Small plane at large origin",
    })
  ).result;
  const preciseProject = await job(
    await call("project_export", { format: "project" }),
  );
  await job(
    await mutate("project_import", {
      artifactId: preciseProject.artifactId,
      replace: true,
    }),
  );
  await waitForImportPresentation();
  const preciseScene = (await call("project_get")).result.objects;
  for (const object of preciseScene)
    await mutate("object_update", {
      entityId: object.id,
      patch:
        object.id === preciseDatum.entityId
          ? { visible: true, opacity: 1, color: "#ffbb44" }
          : { visible: false },
    });
  // Reframe the now-isolated plane to update TrackballControls' scene-scale limits.
  await mutate("viewport_control", {
    action: "fit",
    entityId: preciseDatum.entityId,
  });
  await mutate("viewport_control", {
    action: "camera",
    position: [100000000.125, -20.5, 31],
    target: [100000000.125, -20, 30],
    up: [0, 0, 1],
    projection: "perspective",
    zoom: 1,
  });
  await mutate("settings_set", { patch: { theme: "light" } });
  const preciseView = (await call("viewport_get")).result;
  assert.deepEqual(preciseView.bounds, {
    min: [100000000.0625, -20.0625, 30],
    max: [100000000.1875, -19.9375, 30],
  });
  projectionCamera.projectionMatrix.fromArray(preciseView.projectionMatrix);
  projectionCamera.matrixWorld.fromArray(preciseView.cameraWorldMatrix);
  projectionCamera.matrixWorldInverse
    .copy(projectionCamera.matrixWorld)
    .invert();
  const preciseSamples = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    const point = new Vector3(
      100000000.125 + u * 0.03125,
      -20 + v * 0.03125,
      30,
    ).project(projectionCamera);
    return [
      ((point.x + 1) * preciseView.viewport.width) / 2,
      ((1 - point.y) * preciseView.viewport.height) / 2,
    ];
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const preciseScreenshot = await canvas.screenshot();
  await writeFile(
    new URL("small-plane-large-origin.png", artifactDir),
    preciseScreenshot,
  );
  const preciseCoverage = await page.evaluate(
    async ({ base64, samples }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + base64;
      await image.decode();
      const surface = new OffscreenCanvas(image.width, image.height),
        context = surface.getContext("2d");
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(
        0,
        0,
        image.width,
        image.height,
      );
      return (
        samples.filter(([x, y]) => {
          const xx = Math.round(x),
            yy = Math.round(y);
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) return false;
          const offset = (yy * width + xx) * 4,
            r = data[offset],
            g = data[offset + 1],
            b = data[offset + 2];
          // The oblique, lit plane is darker than unlit datum axes. Test its
          // orange hue at all four interior points, preserving the area check.
          return r > 60 && g > 35 && b < 180 && r > g * 1.1 && g > b * 1.2;
        }).length / samples.length
      );
    },
    { base64: preciseScreenshot.toString("base64"), samples: preciseSamples },
  );
  ledger.numericPlaneLargeOriginObservation = {
    viewport: preciseView,
    samples: preciseSamples,
    coverage: preciseCoverage,
  };
  assert.equal(
    preciseCoverage,
    1,
    "Small translated numeric plane retains all four rendered interior samples",
  );
  const precisePick = await call("viewport_pick", {
    x: 0.5,
    y: 0.5,
    maxHits: 1,
  });
  assert.equal(precisePick.result.hits[0].entityId, preciseDatum.entityId);
  assert.deepEqual(precisePick.result.hits[0].point, [100000000.125, -20, 30]);
  ledger.numericPlaneLargeOrigin = {
    coverage: preciseCoverage,
    worldBounds: preciseView.bounds,
    picked: precisePick.result.hits[0].point,
  };
  console.log(
    "small numeric plane at large world origin retains actual WebGL area, exact bounds and picking",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(stderr, "", stderr);
  ledger.steps = [
    "actual stdio SDK discovery and pairing",
    "analytic whole and local region fitting",
    "Construct ribbon GUI fitting and shared plane creation",
    "exact GUI/MCP fit/frame equality",
    "Undo and MCP recreation",
    "fit diagnostics/frame through real project worker reopen",
    "original unmodified ply-1.ply GUI import and same GUI/MCP plane fit/materialization",
    "original scan plane to equal GUI/MCP sketch frame, constrained closed profile, sketch Undo/Redo and worker reopen",
    "sphere/cylinder/cone analytic GUI fits, actual CAD creation and worker reopen",
    "numeric datum plane GUI/MCP frame equality, edit/Cancel/history/reopen and downstream sketch placement",
    "coordinate frame GUI/MCP create/edit/Cancel/history/reopen, axis pixels/picking and XY/YZ/XZ sketch placement",
    "0.125 mm numeric plane at 100000000.125 mm retains actual WebGL area, exact bounds and picking",
    "WebGL and process/port cleanup",
  ];
  console.log(`PASS: ${ledger.steps.join("; ")}`);
} catch (error) {
  failed = error;
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: fileURLToPath(new URL("failure.png", artifactDir)) })
      .catch(() => {});
    await writeFile(
      new URL("failure-state.txt", artifactDir),
      await page.locator("body").innerText(),
    ).catch(() => {});
  }
  throw error;
} finally {
  await cleanup();
}

import assert from "node:assert/strict";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
import { PerspectiveCamera, Vector3 } from "three";

const root = new URL("../", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit", timeout: 10000, windowsHide: true },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
const startedAt = new Date().toISOString();
const token = randomBytes(32).toString("hex");
const ledger = {
  owner: "scanforge-m4-sketch-section-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 360000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(
  `.resources/m4-sketch-section/${randomUUID()}/`,
  root,
);
await mkdir(artifactDir, { recursive: true });
const evidence = new URL("browser-validation.json", artifactDir);
let browserServer, browser, client, transport, page;
let failed, cleanupPromise;
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
  failed = Error("Browser validation exceeded 6 minute lease");
  void cleanup();
}, 360000);
function cleanup() {
  return (cleanupPromise ??= closeResources());
}
async function closeResources() {
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
    if (!closed) failed ??= Error(`Port ${port} remained open`);
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
    if (!exited) failed ??= Error(`${resource.kind} process still alive`);
  }
  await writeFile(
    evidence,
    JSON.stringify(
      { ...ledger, passed: !failed, error: failed?.message },
      null,
      2,
    ),
  );
  if (failed) process.exitCode = 1;
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

  const state = async () => (await call("project_get")).result;
  const sketchState = async () => (await call("sketch_get")).result;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  async function eventually(check) {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (failed) throw failed;
      try {
        return await check();
      } catch (error) {
        if (attempt === 119) throw error;
      }
      await pause();
    }
  }
  async function artifactJson(artifact) {
    assert(artifact?.artifactId, "A public operation must return an artifact");
    const chunks = [];
    let offset = 0;
    for (;;) {
      const result = (
        await call("artifact_read", {
          artifactId: artifact.artifactId,
          offset,
          length: 262144,
        })
      ).result;
      chunks.push(Buffer.from(result.base64, "base64"));
      if (result.eof) break;
      assert(result.nextOffset > offset, "Artifact transfer must advance");
      offset = result.nextOffset;
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const core = (value) => ({
    objects: value.objects.map(({ meshPreparation, ...object }) => object),
    authoring: value.authoring,
    undo: value.undo,
    redo: value.redo,
    selectedId: value.selectedId,
    selectedIds: value.selectedIds,
  });
  const model = (value) => ({
    objects: core(value).objects,
    undo: value.undo,
    redo: value.redo,
  });
  async function digest(entityId) {
    const result = await job(
      await call("object_geometry_digest", { entityId }),
    );
    return result.buffers.map(({ path, encoding, elements, sha256 }) => ({
      path,
      encoding,
      elements,
      sha256,
    }));
  }
  async function extract(entityId, options) {
    const before = core(await state());
    const result = await job(
      await mutate("mesh_process", {
        entityId,
        operation: { kind: "sketchSection", options },
      }),
    );
    const report = await artifactJson(result.artifact);
    assert(
      report.sketchSection,
      "Actual processing worker must return the section",
    );
    assert.deepEqual(
      core(await state()),
      before,
      "MCP extraction preserves geometry, authoring, selection and model history",
    );
    return report.sketchSection;
  }
  async function guiPreview(sourceId, options, screenshot) {
    await mutate("object_select", { entityId: sourceId });
    await page.getByRole("tab", { name: "Sketch", exact: true }).click();
    const before = core(await state());
    await page
      .getByRole("button", { name: "Section to sketch", exact: true })
      .click();
    const panel = page.getByRole("complementary", {
      name: "Create Sketch",
      exact: true,
    });
    await panel.waitFor();
    if (options.plane !== "OXY") {
      await panel.locator(".app-select > button").click();
      await page
        .getByRole("option", { name: new RegExp(`^${options.plane} ·`) })
        .click();
    }
    await panel
      .getByLabel("Slice offset (mm)", { exact: true })
      .fill(String(options.offset));
    await panel
      .getByLabel("Create sketch on slicing plane", { exact: true })
      .setChecked(options.onSlicingPlane);
    await panel
      .getByLabel("Through selection only", { exact: true })
      .setChecked(options.selectedOnly);
    await panel
      .getByRole("button", { name: "Apply section", exact: true })
      .click();
    await panel.getByRole("status").waitFor();
    await eventually(async () =>
      assert(
        await panel
          .getByRole("button", { name: "Create", exact: true })
          .isEnabled(),
      ),
    );
    assert.deepEqual(
      core(await state()),
      before,
      "GUI Preview preserves model/history/authoring",
    );
    assert.equal(
      (await call("application_inspect", { maxControls: 1 })).result.previews
        .sketchSection,
      true,
    );
    await page.screenshot({
      path: fileURLToPath(new URL(screenshot, artifactDir)),
    });
    return { panel, before };
  }
  async function cancelPreview(session) {
    await session.panel
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await session.panel.waitFor({ state: "hidden" });
    assert.deepEqual(
      core(await state()),
      session.before,
      "Cancel preserves source/model/history/authoring/selection",
    );
    assert.equal(
      (await call("application_inspect", { maxControls: 1 })).result.previews
        .sketchSection,
      false,
    );
  }
  async function acceptPreview(session, expected) {
    const previousIds = new Set(
      (session.before.authoring.sketches ?? []).map((s) => s.id),
    );
    await session.panel
      .getByRole("button", { name: "Create", exact: true })
      .click();
    await session.panel.waitFor({ state: "hidden" });
    const result = await eventually(async () => {
      const next = await sketchState();
      assert.equal(next.sketches.length, previousIds.size + 1);
      assert(!previousIds.has(next.activeSketchId));
      return next;
    });
    assert.deepEqual(result.sketch, {
      version: 1,
      points: [],
      segments: [],
      constraints: [],
      frame: expected.frame,
      reference: expected.reference,
    });
    assert.deepEqual(
      model(await state()),
      model(session.before),
      "Accept adds authoring only, without a mesh history entry",
    );
    assert.equal(
      (await state()).selectedId,
      null,
      "GUI Accept clears object selection like sketch_manage",
    );
    return { id: result.activeSketchId, sketch: result.sketch };
  }
  async function mcpAccept(section, name) {
    const before = model(await state());
    const sketch = {
      version: 1,
      points: [],
      segments: [],
      constraints: [],
      frame: section.frame,
      reference: section.reference,
    };
    const created = (
      await mutate("sketch_manage", { action: "create", name, sketch })
    ).result;
    assert.deepEqual((await sketchState()).sketch, sketch);
    assert.deepEqual(model(await state()), before);
    assert.equal((await state()).selectedId, null);
    return { id: created.sketchId, sketch };
  }
  function assertClosedRectangle(section, onSlicingPlane) {
    const segments = section.reference.segments;
    assert(segments.length > 0 && segments.length % 4 === 0);
    assert.equal(section.eligibleTriangles, 12);
    assert.equal(section.reference.sourceId, boxId);
    assert.equal(section.reference.onSlicingPlane, onSlicingPlane);
    assert.deepEqual(section.frame, {
      origin: [0, 0, onSlicingPlane ? 2 : 0],
      u: [1, 0, 0],
      v: [0, 1, 0],
      normal: [0, 0, 1],
    });
    const vertices = new Map(),
      adjacency = new Map();
    const key = (point) => point.map((n) => Math.round(n * 1e8)).join(",");
    let perimeter = 0;
    for (let i = 0; i < segments.length; i += 4) {
      const a = segments.slice(i, i + 2),
        b = segments.slice(i + 2, i + 4);
      perimeter += Math.hypot(a[0] - b[0], a[1] - b[1]);
      for (const [point, other] of [
        [a, b],
        [b, a],
      ]) {
        assert(
          point[0] >= -4 && point[0] <= 6 && point[1] >= -3 && point[1] <= 5,
        );
        assert(
          point[0] === -4 ||
            point[0] === 6 ||
            point[1] === -3 ||
            point[1] === 5,
        );
        const id = key(point);
        vertices.set(id, point);
        adjacency.set(id, [...(adjacency.get(id) ?? []), key(other)]);
      }
    }
    assert(
      Math.abs(perimeter - 36) < 1e-6,
      `Expected perimeter36, got ${perimeter}`,
    );
    for (const neighbours of adjacency.values())
      assert.equal(
        neighbours.length,
        2,
        "Closed section vertices have degree two",
      );
    const start = vertices.keys().next().value,
      visited = new Set();
    let current = start,
      previous,
      twiceArea = 0;
    do {
      assert(
        !visited.has(current),
        "One closed polygon, without a second loop",
      );
      visited.add(current);
      const next = adjacency.get(current).find((id) => id !== previous);
      const a = vertices.get(current),
        b = vertices.get(next);
      twiceArea += a[0] * b[1] - b[0] * a[1];
      previous = current;
      current = next;
    } while (current !== start);
    assert.equal(visited.size, vertices.size);
    assert(Math.abs(Math.abs(twiceArea) / 2 - 80) < 1e-6);
    for (let i = 2; i < section.actualSegments.length; i += 3)
      assert.equal(section.actualSegments[i], 2);
    for (let i = 2; i < section.placedSegments.length; i += 3)
      assert.equal(section.placedSegments[i], onSlicingPlane ? 2 : 0);
    return {
      segments: segments.length / 4,
      perimeter,
      area: Math.abs(twiceArea) / 2,
    };
  }
  function closedProfile(sketch) {
    return {
      ...sketch,
      points: [
        { id: "a", x: -4, y: -3 },
        { id: "b", x: 6, y: -3 },
        { id: "c", x: 6, y: 5 },
        { id: "d", x: -4, y: 5 },
      ],
      segments: [
        { id: "ab", a: "a", b: "b" },
        { id: "bc", a: "b", b: "c" },
        { id: "cd", a: "c", b: "d" },
        { id: "da", a: "d", b: "a" },
      ],
      constraints: [
        { id: "anchor", kind: "fixed", point: "a", x: -4, y: -3 },
        { id: "h1", kind: "horizontal", segment: "ab" },
        { id: "h2", kind: "horizontal", segment: "cd" },
        { id: "v1", kind: "vertical", segment: "bc" },
        { id: "v2", kind: "vertical", segment: "da" },
        { id: "width", kind: "distance", a: "a", b: "b", value: 10 },
        { id: "height", kind: "distance", a: "b", b: "c", value: 8 },
      ],
    };
  }
  async function bodyWitness(entityId, expectedSketch) {
    const object = (
      await call("object_get", { entityId, includeGeometry: true })
    ).result;
    assert(object.exactCad, "Extrusion must be an actual kernel body");
    const recipe = object.parametric.feature.recipe;
    assert.equal(recipe.kind, "extrude");
    assert.deepEqual(recipe.profile.sketch.frame, expectedSketch.frame);
    assert.deepEqual(recipe.profile.sketch.reference, expectedSketch.reference);
    const geometry = await artifactJson(object.geometry);
    let positions = geometry.positions;
    if (geometry.indexedMesh) {
      const { vertices, triangles } = geometry.indexedMesh;
      positions = triangles.flatMap((index) =>
        vertices.slice(index * 3, index * 3 + 3),
      );
    }
    assert(positions.length > 0 && positions.length % 9 === 0);
    let sixVolume = 0;
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 9) {
      const a = positions.slice(i, i + 3),
        b = positions.slice(i + 3, i + 6),
        c = positions.slice(i + 6, i + 9);
      sixVolume +=
        a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0]);
      for (const point of [a, b, c])
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
    }
    const volume = Math.abs(sixVolume / 6);
    assert(
      Math.abs(volume - 240) < 1e-5,
      `Extruded display triangle volume must be240 mm³, got ${volume}`,
    );
    assert.deepEqual(min, [-4, -3, expectedSketch.frame.origin[2]]);
    assert.deepEqual(max, [6, 5, expectedSketch.frame.origin[2] + 3]);
    return {
      entityId,
      volume,
      bounds: { min, max },
      frame: expectedSketch.frame,
      sourceId: recipe.profile.sketch.reference.sourceId,
    };
  }
  async function workerReopen(expectedSketches, sourceId, sourceDigest) {
    const before = await state();
    const artifact = await job(
      await call("project_export", { format: "project" }),
    );
    await job(
      await mutate("project_import", {
        artifactId: artifact.artifactId,
        replace: true,
      }),
    );
    await waitForImportPresentation();
    const reopened = await state();
    assert.equal(reopened.undo, before.undo);
    assert.equal(reopened.redo, before.redo);
    for (const saved of expectedSketches) {
      assert.deepEqual(
        reopened.authoring.sketches.find((s) => s.id === saved.id)?.sketch,
        saved.sketch,
      );
      assert.equal(saved.sketch.reference.sourceId, sourceId);
    }
    assert(reopened.objects.some((object) => object.id === sourceId));
    if (sourceDigest) assert.deepEqual(await digest(sourceId), sourceDigest);
    return {
      artifactId: artifact.artifactId,
      sketches: expectedSketches.length,
      modelUndo: reopened.undo,
      modelRedo: reopened.redo,
    };
  }

  // A real ASCII STL fixture with twelve outward-wound facets, no project state injection.
  const corners = [
    [-4, -3, -2],
    [6, -3, -2],
    [6, 5, -2],
    [-4, 5, -2],
    [-4, -3, 8],
    [6, -3, 8],
    [6, 5, 8],
    [-4, 5, 8],
  ];
  const triangles = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  const box = Buffer.from(
    `solid analytic_box\n${triangles.map((triangle) => `facet normal 0 0 0\nouter loop\n${triangle.map((i) => `vertex ${corners[i].join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n")}\nendsolid analytic_box\n`,
  );
  const boxPath = new URL("analytic-closed-box.stl", artifactDir);
  await writeFile(boxPath, box);
  ledger.analyticInput = {
    path: fileURLToPath(boxPath),
    bytes: box.length,
    sha256: createHash("sha256").update(box).digest("hex"),
    triangles: 12,
    expectedSectionAreaMm2: 80,
    expectedSectionPerimeterMm: 36,
  };
  await page
    .locator('input[type=file][accept*=".scanforge"]')
    .first()
    .setInputFiles(fileURLToPath(boxPath));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByRole("button", { name: "analytic-closed-box.stl", exact: true })
    .waitFor();
  await waitForImportPresentation();
  const boxSource = (await state()).objects.find(
    (object) => object.name === "analytic-closed-box.stl",
  );
  assert(boxSource && boxSource.kind === "mesh");
  const boxId = boxSource.id,
    boxDigest = await digest(boxId),
    accepted = [];
  ledger.analyticCases = [];
  ledger.steps = [
    "actual stdio MCP discovery and GUI AI agents pairing",
    "analytic closed-box STL imported through the real GUI",
  ];
  await mutate("viewport_control", {
    action: "camera",
    position: [30, -45, 35],
    target: [1, 1, 2],
    up: [0, 0, 1],
    projection: "perspective",
    zoom: 1,
  });
  for (const onSlicingPlane of [true, false]) {
    const options = {
      plane: "OXY",
      offset: 2,
      onSlicingPlane,
      selectedOnly: false,
    };
    const section = await extract(boxId, options);
    const polygon = assertClosedRectangle(section, onSlicingPlane);
    await writeFile(
      new URL(`section-${onSlicingPlane}.json`, artifactDir),
      JSON.stringify(section, null, 2),
    );
    const cancel = await guiPreview(
      boxId,
      options,
      `preview-cancel-${onSlicingPlane}.png`,
    );
    await cancelPreview(cancel);
    const preview = await guiPreview(
      boxId,
      options,
      `preview-accept-${onSlicingPlane}.png`,
    );
    const gui = await acceptPreview(preview, section);
    const mcp = await mcpAccept(
      section,
      `MCP ${onSlicingPlane ? "slice" : "projected"} section`,
    );
    assert.deepEqual(
      gui.sketch,
      mcp.sketch,
      "GUI/MCP accepted frame and reference must match exactly",
    );
    accepted.push(gui, mcp);
    const baseModel = model(await state());
    await mutate("sketch_manage", { action: "activate", sketchId: gui.id });
    const solved = (
      await mutate("sketch_set", {
        sketch: closedProfile(gui.sketch),
        solve: true,
      })
    ).result;
    assert(solved.solution.converged);
    assert.equal(solved.solution.degreesOfFreedom, 0);
    const profile = (await sketchState()).sketch;
    gui.sketch = profile;
    assert.deepEqual(profile.frame, section.frame);
    assert.deepEqual(profile.reference, section.reference);
    await mutate("history_undo", { scope: "sketch" });
    assert.deepEqual((await sketchState()).sketch, mcp.sketch);
    assert.deepEqual(model(await state()), baseModel);
    await mutate("history_redo", { scope: "sketch" });
    assert.deepEqual((await sketchState()).sketch, profile);
    assert.deepEqual(model(await state()), baseModel);
    await mutate("ui_set", {
      workspace: "sketch",
      ribbonTab: "sketch",
      toolPanelOpen: true,
    });
    const panel = page.getByRole("region", {
      name: "Parametric sketch",
      exact: true,
    });
    await panel.getByLabel("Extrusion height", { exact: true }).fill("3");
    const beforeGuiBody = await state(),
      previousBodies = new Set(
        beforeGuiBody.objects.map((object) => object.id),
      );
    await panel
      .getByRole("button", { name: "Extrude solved profile", exact: true })
      .click();
    const guiBody = await eventually(async () => {
      const next = await state();
      assert.equal((await call("session_get")).result.busy, false);
      assert.equal(next.objects.length, beforeGuiBody.objects.length + 1);
      return next.objects.find((object) => !previousBodies.has(object.id));
    });
    assert.equal((await state()).undo, beforeGuiBody.undo + 1);
    const guiBodyResult = await bodyWitness(guiBody.id, profile);
    const mcpBody = await job(
      await mutate("cad_create", {
        name: `MCP section extrusion ${onSlicingPlane}`,
        recipe: {
          kind: "extrude",
          profile: { kind: "sketch-curves", sketch: profile },
          height: 3,
        },
      }),
    );
    const mcpBodyResult = await bodyWitness(mcpBody.entityIds[0], profile);
    assert.deepEqual(
      { ...guiBodyResult, entityId: undefined },
      { ...mcpBodyResult, entityId: undefined },
    );
    assert.deepEqual(
      await digest(boxId),
      boxDigest,
      "Source scan remains owned and unchanged after both extrusions",
    );
    const beforeUndo = await state();
    await mutate("history_undo", { scope: "model" });
    assert.equal((await state()).objects.length, beforeUndo.objects.length - 1);
    assert.deepEqual((await sketchState()).sketch.frame, profile.frame);
    assert.deepEqual((await sketchState()).sketch.reference, profile.reference);
    await mutate("history_redo", { scope: "model" });
    assert.equal((await state()).objects.length, beforeUndo.objects.length);
    await bodyWitness(mcpBody.entityIds[0], profile);
    ledger.analyticCases.push({
      onSlicingPlane,
      polygon,
      guiSketchId: gui.id,
      mcpSketchId: mcp.id,
      guiBody: guiBodyResult,
      mcpBody: mcpBodyResult,
    });
    ledger.steps.push(
      `onSlicingPlane=${onSlicingPlane}: real GUI Preview/Cancel/Accept equals public MCP artifact + saved sketch; constrained closed profile, scoped history and equal GUI/MCP kernel extrusions`,
    );
  }
  ledger.analyticReopen = await workerReopen(accepted, boxId, boxDigest);
  const reopenedBeforeUndo = await state();
  await mutate("history_undo", { scope: "model" });
  assert.equal(
    (await state()).objects.length,
    reopenedBeforeUndo.objects.length - 1,
  );
  await mutate("history_redo", { scope: "model" });
  assert.equal(
    (await state()).objects.length,
    reopenedBeforeUndo.objects.length,
  );
  for (const sample of ledger.analyticCases) {
    const sketch = accepted.find(
      (item) => item.id === sample.guiSketchId,
    ).sketch;
    await bodyWitness(sample.guiBody.entityId, sketch);
    await bodyWitness(sample.mcpBody.entityId, sketch);
  }
  ledger.steps.push(
    "actual project worker export/import preserves all saved frames/references, source geometry, bodies and model history",
  );

  await mutate("project_new", { discard: true });
  const original =
    process.env.SCANFORGE_M4_SCAN ??
    "C:/repo/alignment-example-files/ply-1.ply";
  const originalBytes = await readFile(original);
  ledger.originalInput = {
    path: original,
    bytes: originalBytes.length,
    sha256: createHash("sha256").update(originalBytes).digest("hex"),
    nativeAcceptanceClaim: false,
  };
  await page
    .locator('input[type=file][accept*=".scanforge"]')
    .first()
    .setInputFiles(original);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await eventually(async () => assert.equal((await state()).objects.length, 1));
  await waitForImportPresentation();
  const scan = (await state()).objects[0];
  assert.equal(scan.kind, "mesh");
  const sourceBounds = (await call("viewport_get")).result.bounds;
  assert(
    sourceBounds,
    "The only visible object supplies actual viewport bounds",
  );
  ledger.originalInput.viewportBounds = sourceBounds;
  const spans = sourceBounds.min
    .map((value, axis) => ({ axis, length: sourceBounds.max[axis] - value }))
    .sort((a, b) => b.length - a.length);
  const attempted = [];
  let originalSection;
  for (const { axis, length } of spans) {
    if (!(length > 0)) continue;
    const options = {
      plane: ["OYZ", "OXZ", "OXY"][axis],
      offset: (sourceBounds.min[axis] + sourceBounds.max[axis]) / 2,
      onSlicingPlane: true,
      selectedOnly: false,
    };
    try {
      const section = await extract(scan.id, options);
      assert(section.reference.segments.length > 0);
      originalSection = { options, section };
      break;
    } catch (error) {
      if (
        !/does not intersect|No eligible visible scan triangles/.test(
          error.message,
        )
      )
        throw error;
      attempted.push({ options, error: error.message });
    }
  }
  ledger.originalAttempts = attempted;
  assert(originalSection, "The original PLY must provide a nonempty section");
  if (originalSection) {
    const { options, section } = originalSection;
    const preview = await guiPreview(scan.id, options, "original-preview.png");
    await cancelPreview(preview);
    const acceptedOriginal = await acceptPreview(
      await guiPreview(scan.id, options, "original-accepted-preview.png"),
      section,
    );
    const mcpOriginal = await mcpAccept(section, "MCP original scan section");
    assert.deepEqual(acceptedOriginal.sketch, mcpOriginal.sketch);
    const scanDigest = await digest(scan.id);
    await mutate("sketch_manage", {
      action: "activate",
      sketchId: acceptedOriginal.id,
    });
    await mutate("ui_set", {
      workspace: "sketch",
      ribbonTab: "sketch",
      toolPanelOpen: true,
      dismissError: true,
    });
    const panel = page.getByRole("region", {
      name: "Parametric sketch",
      exact: true,
    });
    await panel.waitFor();
    await mutate("settings_set", {
      patch: { automaticGrid: false, gridSpacing: 1, snapGrid: true },
    });
    await panel
      .getByLabel("Constraints · snap origin, endpoints and axes", {
        exact: true,
      })
      .uncheck();
    const [u0, v0, u1, v1] = section.reference.segments;
    const center = [Math.round((u0 + u1) / 2), Math.round((v0 + v1) / 2)];
    const frame = section.frame;
    const worldCenter = new Vector3(...frame.origin)
      .addScaledVector(new Vector3(...frame.u), center[0])
      .addScaledVector(new Vector3(...frame.v), center[1]);
    const cameraPosition = worldCenter
      .clone()
      .addScaledVector(new Vector3(...frame.normal), 180);
    await mutate("viewport_control", {
      action: "camera",
      position: cameraPosition.toArray(),
      target: worldCenter.toArray(),
      up: frame.v,
      projection: "perspective",
      zoom: 1,
    });
    const canvas = page.locator(".viewport canvas").first();
    const project = async ([u, v]) => {
      const view = (await call("viewport_get")).result;
      const camera = new PerspectiveCamera();
      camera.projectionMatrix.fromArray(view.projectionMatrix);
      camera.matrixWorld.fromArray(view.cameraWorldMatrix);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      const point = new Vector3(...frame.origin)
        .addScaledVector(new Vector3(...frame.u), u)
        .addScaledVector(new Vector3(...frame.v), v)
        .project(camera);
      const rect = await canvas.boundingBox();
      assert(rect && point.z >= -1 && point.z <= 1);
      return {
        x: rect.x + ((point.x + 1) * rect.width) / 2,
        y: rect.y + ((1 - point.y) * rect.height) / 2,
      };
    };
    const drawing = [
      [center[0] - 5, center[1]],
      [center[0] + 5, center[1]],
    ];
    const a = await project(drawing[0]),
      b = await project(drawing[1]);
    await panel.getByRole("button", { name: "Line", exact: true }).click();
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    await eventually(async () =>
      assert.equal((await sketchState()).sketch.segments.length, 1),
    );
    const guiDrawing = (await sketchState()).sketch;
    assert.deepEqual(
      guiDrawing.points.map(({ x, y }) => [x, y]),
      drawing,
    );
    assert.deepEqual(guiDrawing.reference, section.reference);
    await page.screenshot({
      path: fileURLToPath(new URL("original-canvas-drawing.png", artifactDir)),
    });
    await mutate("sketch_manage", {
      action: "activate",
      sketchId: mcpOriginal.id,
    });
    await mutate("sketch_draw", {
      kind: "line",
      points: drawing,
      autoConstraints: false,
      snapToleranceMm: 0.5,
    });
    const mcpDrawing = (await sketchState()).sketch;
    assert.deepEqual(
      mcpDrawing.points.map(({ x, y }) => [x, y]),
      drawing,
    );
    const topology = (sketch) =>
      sketch.segments.map((line) => ({
        a: sketch.points.findIndex((point) => point.id === line.a),
        b: sketch.points.findIndex((point) => point.id === line.b),
        construction: !!line.construction,
      }));
    assert.deepEqual(topology(guiDrawing), [
      { a: 0, b: 1, construction: false },
    ]);
    assert.deepEqual(topology(mcpDrawing), topology(guiDrawing));
    assert.deepEqual(mcpDrawing.reference, guiDrawing.reference);
    await mutate("history_undo", { scope: "sketch" });
    assert.equal((await sketchState()).sketch.segments.length, 0);
    await mutate("sketch_manage", {
      action: "activate",
      sketchId: acceptedOriginal.id,
    });
    await mutate("history_undo", { scope: "sketch" });
    const empty = (await sketchState()).sketch;
    assert.equal(empty.segments.length, 0);
    await panel
      .getByRole("button", { name: "Reset rectangle", exact: true })
      .click();
    await eventually(async () =>
      assert.notDeepEqual((await sketchState()).sketch, empty),
    );
    const guiRectangle = (await sketchState()).sketch;
    assert.deepEqual(guiRectangle.reference, section.reference);
    const beforeCancel = await sketchState();
    const beforeCancelRevision = (await call("project_get")).revision;
    const draft = panel.getByLabel("p2 x", { exact: true });
    await draft.click();
    await draft.press("ControlOrMeta+A");
    await draft.pressSequentially("-12.5");
    assert.equal(await draft.inputValue(), "-12.5");
    await draft.press("Escape");
    assert.equal(await draft.inputValue(), "40");
    assert.deepEqual(await sketchState(), beforeCancel);
    assert.equal((await call("project_get")).revision, beforeCancelRevision);
    for (const [control, option] of [
      ["Constraint", "distance"],
      ["First reference", "p1"],
      ["Second reference", "p2"],
    ]) {
      await panel.getByRole("button", { name: control, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    }
    await panel.getByLabel("Dimension", { exact: true }).fill("10");
    const beforeConflict = await sketchState();
    const conflictRevision = (await call("project_get")).revision;
    await panel
      .getByRole("button", { name: "Add constraint", exact: true })
      .click();
    await panel.getByText(/Conflicting or unsolved constraints:/).waitFor();
    assert.deepEqual(await sketchState(), beforeConflict);
    assert.equal((await call("project_get")).revision, conflictRevision);
    await mutate("ui_set", { dismissError: true });
    await panel
      .getByRole("button", { name: "Undo sketch edit", exact: true })
      .click();
    await eventually(async () =>
      assert.deepEqual((await sketchState()).sketch, empty),
    );
    await mutate("history_redo", { scope: "sketch" });
    assert.deepEqual((await sketchState()).sketch, guiRectangle);
    await page.screenshot({
      path: fileURLToPath(new URL("original-sketch-edits.png", artifactDir)),
    });

    await mutate("sketch_manage", {
      action: "activate",
      sketchId: mcpOriginal.id,
    });
    await mutate("sketch_edit", { kind: "preset", profile: "rectangle" });
    assert.deepEqual((await sketchState()).sketch, guiRectangle);
    const mcpBeforeConflict = await sketchState();
    const revision = (await call("project_get")).revision;
    const response = await client.callTool({
      name: "sketch_edit",
      arguments: {
        kind: "constraintAdd",
        constraint: { kind: "distance", a: "p1", b: "p2", value: 10 },
        expectedRevision: revision,
        requestId: randomUUID(),
      },
    });
    const rejected =
      response.structuredContent ?? JSON.parse(response.content[0].text);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "OPERATION_FAILED");
    assert.deepEqual(await sketchState(), mcpBeforeConflict);
    assert.equal((await call("project_get")).revision, revision);
    await mutate("history_undo", { scope: "sketch" });
    assert.deepEqual((await sketchState()).sketch, empty);
    await mutate("history_redo", { scope: "sketch" });
    assert.deepEqual((await sketchState()).sketch, guiRectangle);
    acceptedOriginal.sketch = guiRectangle;
    mcpOriginal.sketch = guiRectangle;
    assert.deepEqual(await digest(scan.id), scanDigest);
    ledger.originalExtraction = {
      status: "passed",
      options,
      eligibleTriangles: section.eligibleTriangles,
      segments: section.reference.segments.length / 4,
      guiSketchId: acceptedOriginal.id,
      mcpSketchId: mcpOriginal.id,
      sampled: section.reference.sampled,
      independentGuiMcpSketchEdits: true,
      failedConstraintAtomicity: true,
      canceledNumericDraft: true,
      scopedUndoRedo: true,
      sourceDigestUnchanged: true,
      actualCanvasAndMcpDrawingNearScan: true,
      reopen: await workerReopen(
        [acceptedOriginal, mcpOriginal],
        scan.id,
        scanDigest,
      ),
    };
    ledger.steps.push(
      "unmodified original PLY GUI import/extraction/Cancel/Accept, independent GUI/MCP sketch edits, failed constraint, draft cancellation, scoped undo/redo and worker reopen; SHA recorded, no native claim",
    );
  } else {
    ledger.originalExtraction = {
      status: "not-intersected",
      reason:
        "No clean midpoint section across the three world planes; retained failures are not passing extraction evidence",
    };
  }
  assert.equal(
    createHash("sha256")
      .update(await readFile(original))
      .digest("hex"),
    ledger.originalInput.sha256,
    "Original PLY remains unmodified",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(stderr, "", stderr);
  await page.screenshot({
    path: fileURLToPath(new URL("completed.png", artifactDir)),
  });
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

import assert from "node:assert/strict";
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
  owner: "scanforge-m6-inspection-validation",
  startedAt,
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
};
const artifactDir = new URL(".resources/m6-inspection/", root);
await mkdir(artifactDir, { recursive: true });
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
  page.on("pageerror", (error) => errors.push(error.message));
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
  const created = await job(
    await mutate("cad_create", {
      name: "Inspection fixture",
      recipe: {
        kind: "primitive",
        input: { kind: "box", center: [0, 0, 0], size: [20, 20, 5] },
      },
    }),
  );
  const entityId = created.entityIds[0];
  await mutate("object_select", { entityId });
  await mutate("viewport_control", {
    action: "camera",
    position: [0, 0, 60],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "orthographic",
  });
  await mutate("viewport_control", { action: "fit", entityId });
  await mutate("ui_set", {
    workspace: "measure",
    mode: "measure",
    toolPanelOpen: true,
  });
  const canvas = page.locator(".canvas-area canvas").first();
  await page.getByLabel("Measurement kind", { exact: true }).waitFor();
  const box = await canvas.boundingBox();
  const coordinates = [
    [0.46, 0.47],
    [0.54, 0.47],
    [0.54, 0.55],
  ];
  const picks = [];
  for (const [x, y] of coordinates) {
    const hit = (await call("viewport_pick", { x, y })).result.hits[0];
    assert(hit, "fixture pick missed");
    picks.push(hit.point);
  }
  async function readDownload(download) {
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  for (const kind of ["distance", "angle", "radius", "diameter"]) {
    await page
      .getByLabel("Measurement kind", { exact: true })
      .selectOption(kind);
    const count = kind === "distance" ? 2 : 3;
    for (const [x, y] of coordinates.slice(0, count))
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    console.log(kind, await page.locator(".measurement").innerText());
    await page.screenshot({
      path: fileURLToPath(new URL(kind + ".png", artifactDir)),
    });
    await page
      .getByRole("button", { name: "Export measurement JSON", exact: true })
      .waitFor({ timeout: 5000 });
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export measurement JSON", exact: true })
      .click();
    const gui = await readDownload(await download);
    const remote = (
      await call("analysis_measure", {
        kind,
        first: gui.points[0],
        second: gui.points[1],
        ...(count === 3 ? { third: gui.points[2] } : {}),
      })
    ).result;
    for (let i = 0; i < count; i++)
      for (let axis = 0; axis < 3; axis++)
        assert(
          Math.abs(gui.points[i][axis] - picks[i][axis]) < 1e-5,
          "GUI/public-pick coordinate mismatch exceeds 0.00001 mm",
        );
    assert.deepEqual(
      gui,
      remote,
      kind + " GUI/MCP mismatch for identical world picks",
    );
    const displayed = await mutate("inspection_display", {
      action: "measurement",
      measurement: {
        kind,
        first: gui.points[0],
        second: gui.points[1],
        ...(count === 3 ? { third: gui.points[2] } : {}),
      },
    });
    assert.deepEqual(displayed.result, gui);
    const displayedDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export measurement JSON", exact: true })
      .click();
    assert.deepEqual(
      await readDownload(await displayedDownload),
      gui,
      "MCP measurement display differs from GUI export",
    );
    ledger[kind] = gui;
    await page
      .getByRole("button", { name: "Clear measurement", exact: true })
      .click();
  }
  await page.screenshot({
    path: fileURLToPath(new URL("measurement.png", artifactDir)),
  });
  const displayedSection = await mutate("inspection_display", {
    action: "section",
    entityId,
    axis: "x",
    offset: 0,
  });
  assert(
    await page
      .getByRole("checkbox", { name: "Show cross section", exact: true })
      .isChecked(),
  );
  const sectionDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export section CSV", exact: true })
    .click();
  const sectionStream = await (await sectionDownload).createReadStream();
  const sectionChunks = [];
  for await (const chunk of sectionStream) sectionChunks.push(chunk);
  const sectionReport = await job(
    await call("analysis_section", { entityId, axis: "x", offset: 0 }),
  );
  const sectionArtifact = (
    await call("artifact_read", {
      artifactId: sectionReport.csv.artifactId,
      offset: 0,
    })
  ).result;
  assert.equal(
    Buffer.concat(sectionChunks).toString(),
    Buffer.from(sectionArtifact.base64, "base64").toString(),
  );
  assert.equal(displayedSection.result.length, sectionReport.length);
  assert.equal(displayedSection.result.segments, sectionReport.segments);
  await mutate("inspection_display", { action: "clear" });
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Show cross section", exact: true })
      .isChecked(),
    false,
  );
  ledger.sectionDisplay = displayedSection.result;
  const before = await call("history_get");
  const fit = {
    kind: "plane",
    center: [0, 0, 0],
    axis: [0, 0, 1],
    rms: 0,
    maxError: 0,
  };
  const report = await job(
    await call("analysis_deviation", { entityId, fit, tolerance: 1 }),
  );
  assert.equal(report.samples, 36);
  assert.equal(report.excluded, 0);
  assert.equal(report.rms, 2.5);
  assert.deepEqual((await call("history_get")).result, before.result);
  ledger.deviation = report;
  const target = await job(
    await mutate("cad_create", {
      name: "Inspection reference",
      recipe: {
        kind: "primitive",
        input: { kind: "box", center: [0, 0, -1], size: [40, 40, 1] },
      },
    }),
  );
  const referenceId = target.entityIds[0];
  await mutate("object_select", { entityId });
  await mutate("ui_set", {
    workspace: "deviation",
    mode: "inspect",
    toolPanelOpen: true,
  });
  await page
    .getByRole("button", { name: "Inspection reference surface", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Inspection reference", exact: true })
    .click();
  await page.getByLabel("Search distance (mm)", { exact: true }).fill("5");
  await page.getByLabel("Comparison tolerance (mm)", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Compare reference surface", exact: true })
    .click();
  await page
    .getByLabel("Reference comparison statistics", { exact: true })
    .waitFor();
  const referenceDownload = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Export reference comparison JSON",
      exact: true,
    })
    .click();
  const guiComparison = await readDownload(await referenceDownload);
  await page
    .getByLabel("Inspection name", { exact: true })
    .fill("Saved reference fixture");
  const metadataHistory = (await call("history_get")).result;
  await page
    .getByRole("button", { name: "Save reference inspection", exact: true })
    .click();
  const savedDefinition = (await call("inspection_get")).result.inspections[0];
  assert.equal(savedDefinition.name, "Saved reference fixture");
  assert.deepEqual(
    (await call("history_get")).result,
    metadataHistory,
    "metadata save changed modeling history",
  );
  const savedProject = await job(
    await call("project_export", { format: "project" }),
  );
  const remoteComparison = await job(
    await call("analysis_deviation", {
      entityId,
      referenceId,
      maxDistance: 5,
      tolerance: 1,
    }),
  );
  const chunk = (
    await call("artifact_read", {
      artifactId: remoteComparison.report.artifactId,
      offset: 0,
    })
  ).result;
  const remoteJson = JSON.parse(Buffer.from(chunk.base64, "base64").toString());
  assert.deepEqual(
    guiComparison,
    remoteJson,
    "reference GUI/MCP report mismatch",
  );
  await mutate("inspection_display", {
    action: "show",
    inspectionId: remoteComparison.inspectionId,
  });
  await page
    .getByLabel("Reference comparison statistics", { exact: true })
    .waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("reference-comparison.png", artifactDir)),
  });
  await mutate("inspection_display", { action: "clear" });
  await page
    .getByLabel("Reference comparison statistics", { exact: true })
    .waitFor({ state: "hidden" });
  ledger.referenceComparison = remoteComparison;
  // Show a report whose threshold deliberately differs from the current GUI field.
  const differentTolerance = await job(
    await call("analysis_deviation", {
      entityId,
      referenceId,
      maxDistance: 5,
      tolerance: 5,
    }),
  );
  await mutate("inspection_display", {
    action: "show",
    inspectionId: differentTolerance.inspectionId,
  });
  const scale = page.locator('.reduction-color-scale[data-read-only="true"]');
  assert((await scale.innerText()).includes("+5.000"));
  assert((await scale.innerText()).includes("−5.000"));
  assert.equal(await scale.getByRole("slider").count(), 0);
  const scaleBox = await scale.boundingBox(),
    canvasBox = await canvas.boundingBox();
  assert(
    scaleBox && canvasBox && scaleBox.x > canvasBox.x + canvasBox.width * 0.75,
    "inspection scale is not on the right of the viewport",
  );
  assert(scaleBox.height > scaleBox.width, "inspection scale is not vertical");
  await page.setViewportSize({ width: 600, height: 800 });
  assert(
    await scale.isVisible(),
    "inspection scale disappeared on narrow screens",
  );
  const narrowScale = await scale.boundingBox();
  assert(
    narrowScale &&
      narrowScale.x >= 0 &&
      narrowScale.x + narrowScale.width <= 600,
    "narrow inspection scale is clipped",
  );
  await page.screenshot({
    path: fileURLToPath(new URL("inspection-scale-narrow.png", artifactDir)),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: fileURLToPath(new URL("report-tolerance.png", artifactDir)),
  });
  await mutate("inspection_manage", {
    action: "delete",
    inspectionId: savedDefinition.id,
  });
  assert.equal((await call("inspection_get")).result.inspections.length, 0);
  await job(
    await mutate("project_import", {
      artifactId: savedProject.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(
    (await call("inspection_get")).result.inspections,
    [savedDefinition],
    "binary project lost saved inspection parameters",
  );
  await mutate("object_select", { entityId });
  await mutate("ui_set", {
    workspace: "deviation",
    mode: "inspect",
    toolPanelOpen: true,
  });
  await page
    .getByRole("button", { name: "Saved inspection", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Saved reference fixture", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run saved inspection", exact: true })
    .click();
  await page
    .getByLabel("Reference comparison statistics", { exact: true })
    .waitFor();
  const reopenedDownload = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Export reference comparison JSON",
      exact: true,
    })
    .click();
  assert.deepEqual(
    await readDownload(await reopenedDownload),
    guiComparison,
    "saved GUI replay changed reference report",
  );
  ledger.persistence = {
    definition: savedDefinition,
    reportIdenticalAfterBinaryReopen: true,
  };
  const idsBefore = new Set(
    (await call("project_get")).result.objects.map((object) => object.id),
  );
  const indexedUpload = await call("artifact_put", {
    name: "m6-indexed-plane.ply",
    offset: 0,
    base64: (
      await readFile(new URL("tests/fixtures/m6-indexed-plane.ply", root))
    ).toString("base64"),
  });
  await job(
    await mutate("project_import", {
      artifactId: indexedUpload.result.artifactId,
      placeAtOrigin: false,
    }),
  );
  const indexedId = (await call("project_get")).result.objects.find(
    (object) => !idsBefore.has(object.id),
  ).id;
  for (const id of idsBefore)
    await mutate("object_update", { entityId: id, patch: { visible: false } });
  await mutate("object_select", { entityId: indexedId });
  await mutate("viewport_control", { action: "fit", entityId: indexedId });
  const geometry = (
    await call("object_get", { entityId: indexedId, includeGeometry: true })
  ).result.geometry;
  const geometryChunk = (
    await call("artifact_read", { artifactId: geometry.artifactId, offset: 0 })
  ).result;
  const indexedGeometry = JSON.parse(
    Buffer.from(geometryChunk.base64, "base64").toString(),
  );
  assert.equal(indexedGeometry.indexedMesh.vertices.length, 12);
  assert.equal(indexedGeometry.positions.length, 18);
  async function screenshotPixel(x, y) {
    const png = await page.screenshot();
    return page.evaluate(
      async ({ data, x, y }) => {
        const image = new Image();
        image.src = "data:image/png;base64," + data;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(x, y, 1, 1).data);
      },
      { data: png.toString("base64"), x, y },
    );
  }
  async function indexedReport(expected) {
    const measured = await job(
      await call("analysis_deviation", {
        entityId: indexedId,
        fit,
        tolerance: 2,
      }),
    );
    const data = (
      await call("artifact_read", {
        artifactId: measured.artifact.artifactId,
        offset: 0,
      })
    ).result;
    assert.deepEqual(
      JSON.parse(Buffer.from(data.base64, "base64").toString()),
      expected,
    );
    await mutate("inspection_display", {
      action: "show",
      inspectionId: measured.inspectionId,
    });
    return measured;
  }
  const originalIndexed = await indexedReport([0, 0, 1, 0, 1, 1]);
  await page.screenshot({
    path: fileURLToPath(new URL("indexed-heatmap.png", artifactDir)),
  });
  await mutate("selection_set", { entityId: indexedId, triangles: [1] });
  await mutate("scan_selection_control", {
    entityId: indexedId,
    action: "hide",
  });
  const staleState = await call("project_get");
  const staleRaw = await client.callTool({
    name: "inspection_display",
    arguments: {
      action: "show",
      inspectionId: originalIndexed.inspectionId,
      expectedRevision: staleState.revision,
      requestId: randomUUID(),
    },
  });
  const stale =
    staleRaw.structuredContent ?? JSON.parse(staleRaw.content[0].text);
  assert.equal(stale.ok, false, "hidden faces accepted a stale heatmap");
  const hidden = await indexedReport([0, 0, 1, null, null, null]);
  assert.equal(hidden.samples, 3);
  assert.equal(hidden.excluded, 3);
  await page.screenshot({
    path: fileURLToPath(new URL("hidden-heatmap.png", artifactDir)),
  });
  const hiddenPixel = await screenshotPixel(800, 650);
  assert(
    hiddenPixel[1] > hiddenPixel[0] + 10,
    "orientation shading obscured the indexed inspection heatmap",
  );

  await mutate("scan_selection_control", {
    entityId: indexedId,
    action: "reveal",
  });
  await mutate("mesh_transform", {
    entityId: indexedId,
    translation: [0, 0, 2],
    rotation: [0, 0, 0],
    scale: 1,
  });
  await indexedReport([2, 2, 3, 2, 3, 3]);
  await page.screenshot({
    path: fileURLToPath(new URL("aligned-heatmap.png", artifactDir)),
  });
  await mutate("history_undo", {});
  await indexedReport([0, 0, 1, 0, 1, 1]);
  await mutate("history_redo", {});
  await indexedReport([2, 2, 3, 2, 3, 3]);
  await mutate("selection_set", { entityId: indexedId, triangles: [1] });
  await mutate("selection_edit", { entityId: indexedId, operation: "delete" });
  await indexedReport([2, 2, 3]);
  await mutate("history_undo", {});
  await indexedReport([2, 2, 3, 2, 3, 3]);
  ledger.mapping = {
    indexedVertices: 4,
    sourceCorners: 6,
    hiddenSamples: 3,
    staleReportRejected: true,
    transformUndoRedoAndEditMapping: true,
  };

  // Replay the exact STL used by the native section observation through both boundaries.
  const beforeTetra = new Set(
    (await call("project_get")).result.objects.map((object) => object.id),
  );
  const tetraBytes = await readFile(
    new URL("tests/fixtures/m6-section-tetrahedron.stl", root),
  );
  const tetraUpload = await call("artifact_put", {
    name: "m6-section-tetrahedron.stl",
    offset: 0,
    base64: tetraBytes.toString("base64"),
  });
  await job(
    await mutate("project_import", {
      artifactId: tetraUpload.result.artifactId,
      placeAtOrigin: false,
    }),
  );
  const tetraId = (await call("project_get")).result.objects.find(
    (object) => !beforeTetra.has(object.id),
  ).id;
  await mutate("object_select", { entityId: tetraId });
  await mutate("ui_set", {
    workspace: "measure",
    mode: "measure",
    toolPanelOpen: true,
  });
  const tetraDisplay = await mutate("inspection_display", {
    action: "section",
    entityId: tetraId,
    axis: "x",
    offset: 2,
  });
  const tetraAnalysis = await job(
    await call("analysis_section", { entityId: tetraId, axis: "x", offset: 2 }),
  );
  assert.equal(tetraAnalysis.segments, 3);
  assert(Math.abs(tetraAnalysis.length - (16 + Math.sqrt(128))) <= 1e-9);
  assert.equal(tetraDisplay.result.length, tetraAnalysis.length);
  const tetraDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export section CSV", exact: true })
    .click();
  const tetraChunks = [];
  for await (const chunk of await (await tetraDownload).createReadStream())
    tetraChunks.push(chunk);
  const tetraArtifact = (
    await call("artifact_read", {
      artifactId: tetraAnalysis.csv.artifactId,
      offset: 0,
    })
  ).result;
  assert.equal(
    Buffer.concat(tetraChunks).toString(),
    Buffer.from(tetraArtifact.base64, "base64").toString(),
  );
  ledger.nativeTetrahedronSection = {
    sourceSha256: createHash("sha256").update(tetraBytes).digest("hex"),
    axis: "x",
    offset: 2,
    segments: tetraAnalysis.segments,
    length: tetraAnalysis.length,
    guiMcpCsvIdentical: true,
  };
  await mutate("inspection_display", { action: "clear" });

  const beforeCancelIds = new Set(
    (await call("project_get")).result.objects.map((object) => object.id),
  );
  const cancelUpload = await call("artifact_put", {
    name: "m6-cancel-cloud.asc",
    offset: 0,
    base64: Buffer.from("1 2 3\n".repeat(100000)).toString("base64"),
  });
  await job(
    await mutate("project_import", {
      artifactId: cancelUpload.result.artifactId,
      placeAtOrigin: false,
    }),
  );
  const cancelSource = (await call("project_get")).result.objects.find(
    (object) => !beforeCancelIds.has(object.id),
  ).id;
  const cancelHistory = (await call("history_get")).result;
  const artifactsBeforeCancel = (await call("session_get")).result.artifacts;
  const cancellation = await call("analysis_deviation", {
    entityId: cancelSource,
    fit,
    tolerance: 1,
  });
  await call("job_cancel", { jobId: cancellation.result.jobId });
  let cancelled;
  for (let i = 0; i < 100; i++) {
    cancelled = (await call("job_get", { jobId: cancellation.result.jobId }))
      .result;
    if (cancelled.status !== "running" && cancelled.status !== "queued") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual((await call("history_get")).result, cancelHistory);
  assert.deepEqual(
    (await call("session_get")).result.artifacts,
    artifactsBeforeCancel,
  );
  ledger.cancellation = {
    samples: 100000,
    status: cancelled.status,
    historyUnchanged: true,
    noResultArtifacts: true,
  };
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(stderr, "", stderr);
  ledger.steps = [
    "public MCP and GUI distance/angle/radius/diameter export equality",
    "rendered three-point measurement controls",
    "public MCP signed analytic deviation statistics",
    "read-only analysis preserves history",
    "reference comparison GUI/public-MCP report equality and shared show/clear heatmap",
    "saved inspection metadata preserves history and binary project save/reopen reproduces GUI report",
    "retained report tolerance controls legend and heatmap independently of GUI input",
    "indexed source corner mapping, hidden face filtering, stale rejection, alignment transform, edit and Undo/Redo",
  ];
  console.log("PASS: " + ledger.steps.join("; "));
} catch (error) {
  if (page)
    await page
      .screenshot({ path: fileURLToPath(new URL("failure.png", artifactDir)) })
      .catch(() => {});
  failed = error;
  throw error;
} finally {
  await cleanup();
}

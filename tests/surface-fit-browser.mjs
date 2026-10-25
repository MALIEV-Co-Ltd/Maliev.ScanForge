import assert from "node:assert/strict";
import { freemem } from "node:os";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import net from "node:net";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Reuses the live application server in an entirely disposable browser profile.
// No server at 5173 is created, stopped or reconfigured by this validation.
const root = new URL("../", import.meta.url);
const origin = process.env.SCANFORGE_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const targetOrigin = new URL(origin);
assert(
  targetOrigin.protocol === "http:" && targetOrigin.hostname === "127.0.0.1",
  "Browser validation requires an explicit loopback application origin",
);
const requiredMiB = 4608;
assert(
  freemem() >= requiredMiB * 1024 * 1024,
  `Browser admission requires ${requiredMiB} MiB free; wait for capacity.`,
);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit", timeout: 10000, windowsHide: true },
);
assert.equal(admission.status, 0, "Existing resource admission failed");
const out = new URL(`.resources/surface-fit/${randomUUID()}/`, root);
await mkdir(out, { recursive: true });
const ledger = {
  owner: "surface-fit-browser",
  applicationOrigin: origin,
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  persistentData: false,
  resources: [],
  cleanup: [],
  scenarios: [],
};
const evidence = new URL("ledger.json", out);
const save = () => writeFile(evidence, JSON.stringify(ledger, null, 2));
function identity(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$p=Get-Process -Id ${pid} -ErrorAction Stop; [pscustomobject]@{pid=$p.Id;startedAt=$p.StartTime.ToUniversalTime().ToString('o');executable=$p.Path}|ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
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
const runner = identity(process.pid);
ledger.runner = runner;
let reserve, transport, client, browserServer, browser, bridgePort, failure;
const lease = new AbortController();
const timer = setTimeout(() => {
  failure ??= Error(
    "Surface browser validation exceeded its three-minute lease",
  );
  lease.abort(failure);
  void browserServer?.close().catch(() => {});
  void transport?.close().catch(() => {});
}, 180000);
try {
  assert(
    await portOpen(Number(targetOrigin.port || 80)),
    "Existing application server is unavailable",
  );
  reserve = http.createServer();
  await new Promise((resolve, reject) => {
    reserve.once("error", reject);
    reserve.listen(0, "127.0.0.1", resolve);
  });
  bridgePort = reserve.address().port;
  ledger.resources.push({
    ...runner,
    kind: "port-reservation",
    port: bridgePort,
    bind: "127.0.0.1",
    persistentData: false,
  });
  await save();
  await new Promise((resolve) => reserve.close(resolve));
  const token = randomBytes(32).toString("hex");
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
  client = new Client({ name: "surface-fit-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    ...identity(transport.pid),
    kind: "mcp-server",
    port: bridgePort,
    bind: "127.0.0.1",
    persistentData: false,
  });
  await save();
  assert(
    freemem() >= requiredMiB * 1024 * 1024,
    "Browser admission changed; wait for capacity",
  );
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    timeout: 20000,
    args: ["--enable-unsafe-swiftshader"],
  });
  ledger.resources.push({
    ...identity(browserServer.process().pid),
    kind: "browser",
    persistentData: false,
  });
  await save();
  browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(20000);
  const errors = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
    if (message.type() === "warning") consoleWarnings.push(message.text());
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
    lease.signal.throwIfAborted();
    const response = await client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: 15000, signal: lease.signal },
    );
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
  const pause = () => new Promise((resolve) => setTimeout(resolve, 50));
  async function eventually(check) {
    for (let i = 0; i < 100; i++) {
      lease.signal.throwIfAborted();
      try {
        return await check();
      } catch (error) {
        if (i === 99) throw error;
        await pause();
      }
    }
  }
  async function job(receipt) {
    const jobId = receipt.result.jobId;
    const expires = Date.now() + 95000;
    while (Date.now() < expires) {
      const status = (await call("job_get", { jobId })).result;
      if (status.status !== "running") {
        assert.equal(status.status, "succeeded", JSON.stringify(status));
        return status.result;
      }
      await pause();
    }
    throw Error("Surface browser job did not settle");
  }
  async function artifactJson(artifact) {
    let offset = 0;
    const chunks = [];
    for (let i = 0; i < 32; i++) {
      const part = (
        await call("artifact_read", {
          artifactId: artifact.artifactId,
          offset,
          length: 65536,
        })
      ).result;
      chunks.push(Buffer.from(part.base64, "base64"));
      if (part.eof) return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert(part.nextOffset > offset);
      offset = part.nextOffset;
    }
    throw Error("Fixture artifact exceeded bounded read budget");
  }
  async function geometry(entityId) {
    const object = (
      await call("object_get", { entityId, includeGeometry: true })
    ).result;
    return { object, geometry: await artifactJson(object.geometry) };
  }
  async function geometryDigest(entityId) {
    const digest = await job(
      await call("object_geometry_digest", { entityId }),
    );
    return digest.buffers.map(
      ({ path, encoding, elements, rawBytes, sha256 }) => ({
        path,
        encoding,
        elements,
        rawBytes,
        sha256,
      }),
    );
  }
  async function artifactBytes(artifact) {
    const chunks = [];
    let offset = 0;
    while (offset < 16 * 1024 * 1024) {
      const part = (
        await call("artifact_read", {
          artifactId: artifact.artifactId,
          offset,
          length: 65536,
        })
      ).result;
      chunks.push(Buffer.from(part.base64, "base64"));
      if (part.eof) return Buffer.concat(chunks);
      assert(part.nextOffset > offset);
      offset = part.nextOffset;
    }
    throw Error("Native fixture export exceeds the 16 MiB read budget");
  }
  // Authored planar grid plus one deliberately unselected remote outlier.
  const triangles = [];
  const point = (x, y) => [x, y, 2 + x / 8 + y / 4];
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      triangles.push([point(x, y), point(x + 1, y), point(x, y + 1)]);
      triangles.push([point(x + 1, y), point(x + 1, y + 1), point(x, y + 1)]);
    }
  const planarFacets = triangles.length;
  triangles.push([
    [1000, 1000, 999],
    [1001, 1000, 999],
    [1000, 1001, 999],
  ]);
  const stl = Buffer.alloc(84 + triangles.length * 50);
  stl.write("ScanForge authored selected planar fit fixture", 0, "ascii");
  stl.writeUInt32LE(triangles.length, 80);
  for (let i = 0; i < triangles.length; i++) {
    const at = 84 + i * 50;
    stl.writeFloatLE(1, at + 8);
    triangles[i]
      .flat()
      .forEach((value, k) => stl.writeFloatLE(value, at + 12 + k * 4));
  }
  ledger.fixture = {
    provenance: "Authored planar binary STL, not native application output",
    planarFacets,
    outlierFacets: 1,
    bytes: stl.length,
  };
  const upload = await call("artifact_put", {
    name: "selected-fit.stl",
    offset: 0,
    base64: stl.toString("base64"),
  });
  await job(
    await mutate("project_import", {
      artifactId: upload.result.artifactId,
      unit: "mm",
    }),
  );
  const imported = (await call("project_get")).result;
  assert.equal(imported.objects.length, 1);
  const sourceId = imported.objects[0].id;
  assert.equal(imported.objects[0].triangles, triangles.length);
  await mutate("object_select", { entityId: sourceId });
  await mutate("ui_set", {
    workspace: "mesh",
    mode: "brush",
    toolPanelOpen: true,
  });
  await mutate("selection_set", { entityId: sourceId, triangles: [0] });
  // Locate the rendered public Edit Scan panel without assumptions about import naming.
  const hide = page.getByRole("button", { name: "Hide selected", exact: true });
  await hide.click();
  await page.getByText("Additional tools & display", { exact: true }).click();
  await page.getByText("1 hidden", { exact: false }).first().waitFor();
  const requestedSelection = Array.from({ length: planarFacets }, (_, i) => i);
  await mutate("selection_set", {
    entityId: sourceId,
    triangles: requestedSelection,
  });
  const selected = (await call("selection_get", { entityId: sourceId })).result;
  const selectedIds = await artifactJson(selected.artifact);
  // Shared selection admission excludes hidden slots even when explicitly requested.
  assert.equal(selected.count, planarFacets - 1);
  assert(!selectedIds.includes(0));
  assert(!selectedIds.includes(planarFacets));
  const original = await geometry(sourceId);
  const before = (await call("project_get")).result;
  const commands = (await call("command_get")).result;
  assert(
    commands.commands.some(
      (command) => command.name === "ribbon:fitSurface" && command.available,
    ),
    JSON.stringify(commands),
  );
  await mutate("command_run", { name: "ribbon:fitSurface" });
  const panel = page.getByRole("complementary", {
    name: "Fit Surface",
    exact: true,
  });
  await panel.waitFor();
  assert.match(
    await panel.innerText(),
    new RegExp(`${planarFacets - 1} selected\\s+triangles`),
  );
  await panel
    .getByRole("spinbutton", { name: "U count", exact: true })
    .fill("4");
  await panel
    .getByRole("spinbutton", { name: "V count", exact: true })
    .fill("4");
  // AppSelect exposes a visible button/listbox, not a native visible select.
  await panel
    .locator("label.field")
    .filter({ hasText: "Orientation" })
    .locator('button[aria-haspopup="listbox"]')
    .click();
  await page.getByRole("option", { name: "OXY", exact: true }).click();
  const approximate = process.env.SCANFORGE_SURFACE_METHOD === "approximate";
  if (approximate) {
    await panel
      .locator("label.field")
      .filter({ hasText: "Method" })
      .locator('button[aria-haspopup="listbox"]')
      .click();
    await page
      .getByRole("option", { name: "Approximate", exact: true })
      .click();
    await panel
      .getByRole("spinbutton", { name: "Smoothing weight", exact: true })
      .fill("0.0001");
  }
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  await eventually(async () =>
    assert(
      await panel.getByRole("button", { name: "OK", exact: true }).isEnabled(),
    ),
  );
  await panel.getByRole("checkbox", { name: "Analysis", exact: true }).check();
  await panel.getByRole("status").waitFor();
  const previewState = (await call("project_get")).result;
  assert.equal(
    previewState.undo,
    before.undo,
    "Apply preview must not commit history",
  );
  assert.equal(previewState.objects.length, 1);
  await mutate("viewport_control", {
    action: "camera",
    position: [25, -25, 30],
    target: [6, 6, 4],
  });
  await page.screenshot({
    path: fileURLToPath(new URL("surface-fit-preview.png", out)),
  });
  await panel.getByRole("button", { name: "OK", exact: true }).click();
  const guiState = await eventually(async () => {
    const current = (await call("project_get")).result;
    assert.equal(current.objects.length, 2);
    return current;
  });
  assert.equal(guiState.undo, before.undo + 1);
  const guiId = guiState.objects.find((object) => object.id !== sourceId).id;
  const guiPatch = (await call("surface_get", { entityId: guiId })).result;
  const gui = await geometry(guiId);
  assert.equal(guiPatch.scanId, sourceId);
  assert.equal(gui.object.surfaceScanId, sourceId);
  assert.deepEqual((await geometry(sourceId)).geometry, original.geometry);
  await mutate("history_undo", {});
  await eventually(async () =>
    assert.equal((await call("project_get")).result.objects.length, 1),
  );
  assert.deepEqual((await geometry(sourceId)).geometry, original.geometry);
  await mutate("object_select", { entityId: sourceId });
  await mutate("selection_set", {
    entityId: sourceId,
    triangles: requestedSelection,
  });
  const restoredSelection = (
    await call("selection_get", { entityId: sourceId })
  ).result;
  assert.deepEqual(await artifactJson(restoredSelection.artifact), selectedIds);
  const mcpBefore = (await call("project_get")).result;
  const fitOptions = {
    countU: 4,
    countV: 4,
    degree: 3,
    projection: "xy",
    sampleLimit: 10000,
    ...(approximate
      ? { method: "approximate", regularizationWeight: 0.0001 }
      : {}),
  };
  const mcpResult = await job(
    await mutate("surface_fit", {
      entityId: sourceId,
      selectionOnly: true,
      options: fitOptions,
    }),
  );
  const mcpState = (await call("project_get")).result;
  assert.equal(mcpResult.samples, (planarFacets - 1) * 3);
  assert.equal(mcpState.undo, mcpBefore.undo + 1);
  assert.equal(mcpState.objects.length, 2);
  const mcpPatch = (await call("surface_get", { entityId: mcpResult.entityId }))
    .result;
  const mcp = await geometry(mcpResult.entityId);
  assert.deepEqual(mcpPatch, guiPatch);
  assert.deepEqual(mcp.geometry, gui.geometry);
  assert.equal(mcp.object.surfaceScanId, sourceId);
  assert.deepEqual((await geometry(sourceId)).geometry, original.geometry);
  assert(mcpResult.maxError < 1e-5, JSON.stringify(mcpResult));
  ledger.scenarios.push({
    guiLaunch:
      "public command_run ribbon:fitSurface; actual Apply/Analysis/OK buttons",
    hiddenState:
      "one facet hidden through Edit Scan; public selection and both fitting paths exclude it",
    requestedTriangles: requestedSelection.length,
    fittedTriangles: mcpResult.samples / 3,
    selectedIds,
    sourceId,
    guiId,
    mcpId: mcpResult.entityId,
    options: fitOptions,
    previewNoCommit: true,
    guiOneHistoryStep: true,
    mcpOneHistoryStep: true,
    exactPatchEquality: true,
    exactRenderGeometryEquality: true,
    sourceGeometryPreserved: true,
    mcpResult,
    limitations: [
      "Hidden-selected filtering is checked by GUI region count and the MCP fit sample count; the planar fixture does not prove behavior on unrestricted surfaces.",
      "Authored planar fixture establishes GUI/MCP refactor equality, not native numerical parity, unrestricted input sizes or point-cloud browser behavior.",
    ],
  });
  await save();
  await mutate("object_select", { entityId: mcpResult.entityId });
  await mutate("command_run", { name: "ribbon:newFreeform" });
  const surfacePanel = page.locator(".surface-panels");
  const beforeControl = (await call("project_get")).result;
  const zControl = surfacePanel
    .locator("label.field")
    .filter({ hasText: /^Z \(mm\)$/ })
    .getByRole("spinbutton");
  await zControl.fill("2");
  await eventually(async () => {
    const changed = (
      await call("surface_get", { entityId: mcpResult.entityId })
    ).result;
    assert.equal(changed.patch.points[0][2], 2);
  });
  const afterControl = (await call("project_get")).result;
  assert.equal(afterControl.undo, beforeControl.undo + 1);
  const guiEdited = await geometry(mcpResult.entityId);
  await mutate("history_undo", {});
  await eventually(async () =>
    assert.deepEqual(
      (await call("surface_get", { entityId: mcpResult.entityId })).result
        .patch,
      mcpPatch.patch,
    ),
  );
  const editedPatch = structuredClone(mcpPatch.patch);
  editedPatch.points[0][2] = 2;
  await mutate("surface_set", {
    entityId: mcpResult.entityId,
    patch: editedPatch,
  });
  assert.deepEqual(
    (await geometry(mcpResult.entityId)).geometry,
    guiEdited.geometry,
  );
  ledger.scenarios.push({
    controlEdit: "GUI Z control and public surface_set",
    exactRenderGeometryEquality: true,
    guiOneHistoryStep: true,
  });
  const face = await job(
    await mutate("cad_create", {
      name: "Fitted exact surface",
      recipe: { kind: "surface", patch: editedPatch },
      selectCreated: true,
    }),
  );
  const faceId = face.entityIds[0];
  const faceBefore = (await call("project_get")).result;
  await zControl.fill("3");
  await eventually(async () =>
    assert.equal(
      (await call("surface_get", { entityId: faceId })).result.patch
        .points[0][2],
      3,
    ),
  );
  const faceAfter = (await call("project_get")).result;
  assert.equal(faceAfter.undo, faceBefore.undo + 1);
  const guiFace = await geometry(faceId);
  assert(guiFace.object.exactCad && guiFace.object.hasBrep);
  await mutate("history_undo", {});
  await eventually(async () =>
    assert.equal(
      (await call("surface_get", { entityId: faceId })).result.patch
        .points[0][2],
      2,
    ),
  );
  const rebuiltPatch = structuredClone(editedPatch);
  rebuiltPatch.points[0][2] = 3;
  await job(
    await mutate("cad_rebuild", {
      entityId: faceId,
      recipe: { kind: "surface", patch: rebuiltPatch },
    }),
  );
  assert.deepEqual((await geometry(faceId)).geometry, guiFace.geometry);
  await mutate("object_update", {
    entityId: sourceId,
    patch: { visible: false },
  });
  await mutate("object_update", {
    entityId: mcpResult.entityId,
    patch: { visible: false },
  });
  const step = await job(await call("project_export", { format: "step" }));
  const header = (
    await call("artifact_read", {
      artifactId: step.artifactId,
      offset: 0,
      length: 1024,
    })
  ).result;
  assert(
    Buffer.from(header.base64, "base64").toString().includes("ISO-10303-21"),
  );
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  const reopened = await geometry(faceId);
  assert(reopened.object.exactCad && reopened.object.hasBrep);
  assert.deepEqual(
    (await call("surface_get", { entityId: faceId })).result.patch,
    rebuiltPatch,
  );
  assert.deepEqual(reopened.object.parametric.feature.recipe, {
    kind: "surface",
    patch: rebuiltPatch,
  });
  ledger.scenarios.push({
    exactSurface: "GUI control edit and public cad_rebuild",
    exactRenderGeometryEquality: true,
    guiOneHistoryStep: true,
    stepExport: step.bytes,
    projectReopenExactCad: true,
  });
  await mutate("object_update", {
    entityId: sourceId,
    patch: { visible: false },
  });
  await mutate("viewport_control", { action: "fit", entityId: faceId });
  const faceReport = await job(await call("cad_inspect", { entityId: faceId }));
  assert(faceReport.valid && faceReport.solids === 0 && faceReport.faces === 1);
  await mutate("object_select", { entityId: faceId });
  await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
  const inspectionPanel = page.getByRole("region", {
    name: "Exact CAD inspection",
    exact: true,
  });
  const beforeInspection = await call("project_get");
  await inspectionPanel
    .getByRole("button", { name: "Inspect exact CAD", exact: true })
    .click();
  await inspectionPanel.getByText("Valid BREP", { exact: true }).waitFor();
  assert(
    await inspectionPanel
      .getByText(faceReport.areaMm2.toPrecision(10), { exact: true })
      .isVisible(),
  );
  const afterInspection = await call("project_get");
  assert.equal(afterInspection.revision, beforeInspection.revision);
  assert.equal(afterInspection.result.undo, beforeInspection.result.undo);
  await page.screenshot({
    path: fileURLToPath(new URL("cad-inspection.png", out)),
  });
  ledger.scenarios.push({
    exactInspectionGuiMcpEquality: true,
    unchangedRevision: true,
    report: faceReport,
  });
  if (process.env.SCANFORGE_TEST_REAL_SCAN) {
    const file = await readFile(process.env.SCANFORGE_TEST_REAL_SCAN);
    assert(
      file.length <= 16 * 1024 * 1024,
      "Real-input replay is bounded to 16 MiB",
    );
    const name = basename(process.env.SCANFORGE_TEST_REAL_SCAN);
    let artifactId;
    for (let offset = 0; offset < file.length; offset += 1048576) {
      artifactId = (
        await call("artifact_put", {
          name,
          offset,
          ...(artifactId ? { artifactId } : {}),
          base64: file.subarray(offset, offset + 1048576).toString("base64"),
        })
      ).result.artifactId;
    }
    const idsBefore = new Set(
      (await call("project_get")).result.objects.map((x) => x.id),
    );
    await job(await mutate("project_import", { artifactId, unit: "mm" }));
    const scan = (await call("project_get")).result.objects.find(
      (x) => !idsBefore.has(x.id),
    );
    assert(scan && scan.triangles >= 200);
    const sourceDigest = await geometryDigest(scan.id);
    await mutate("object_select", { entityId: scan.id });
    await mutate("selection_set", {
      entityId: scan.id,
      triangles: Array.from({ length: 200 }, (_, i) => i),
    });
    await mutate("command_run", { name: "ribbon:fitSurface" });
    const realPanel = page.getByRole("complementary", {
      name: "Fit Surface",
      exact: true,
    });
    await realPanel
      .getByRole("spinbutton", { name: "U count", exact: true })
      .fill("4");
    await realPanel
      .getByRole("spinbutton", { name: "V count", exact: true })
      .fill("4");
    await realPanel
      .locator("label.field")
      .filter({ hasText: "Orientation" })
      .locator('button[aria-haspopup="listbox"]')
      .click();
    await page.getByRole("option", { name: "OXY", exact: true }).click();
    await realPanel.getByRole("button", { name: "Apply", exact: true }).click();
    await eventually(async () =>
      assert(
        await realPanel
          .getByRole("button", { name: "OK", exact: true })
          .isEnabled(),
      ),
    );
    await realPanel.getByRole("button", { name: "OK", exact: true }).click();
    const guiRealId = await eventually(async () => {
      const objects = (await call("project_get")).result.objects;
      const fitted = objects.find(
        (x) => !idsBefore.has(x.id) && x.id !== scan.id,
      );
      assert(fitted);
      return fitted.id;
    });
    const realGuiPatch = (await call("surface_get", { entityId: guiRealId }))
      .result.patch;
    await mutate("history_undo", {});
    await mutate("object_select", { entityId: scan.id });
    await mutate("selection_set", {
      entityId: scan.id,
      triangles: Array.from({ length: 200 }, (_, i) => i),
    });
    const realFit = await job(
      await mutate("surface_fit", {
        entityId: scan.id,
        selectionOnly: true,
        options: {
          countU: 4,
          countV: 4,
          degree: 3,
          projection: "xy",
          sampleLimit: 10000,
        },
      }),
    );
    const realMcpPatch = (
      await call("surface_get", { entityId: realFit.entityId })
    ).result.patch;
    assert.deepEqual(realMcpPatch, realGuiPatch);
    const realCad = await job(
      await mutate("cad_create", {
        name: "Real scan fitted face",
        recipe: { kind: "surface", patch: realMcpPatch },
      }),
    );
    const exact = (await call("object_get", { entityId: realCad.entityIds[0] }))
      .result;
    assert(exact.exactCad && exact.hasBrep);
    await mutate("object_select", { entityId: realCad.entityIds[0] });
    await mutate("command_run", { name: "ribbon:surfaceThicken" });
    const thickenPanel = page.getByRole("region", {
      name: "Thicken surface",
      exact: true,
    });
    await thickenPanel
      .getByRole("spinbutton", {
        name: "Signed wall thickness (mm)",
        exact: true,
      })
      .fill("-0.1");
    const beforeThicken = (await call("project_get")).result;
    await thickenPanel
      .getByRole("button", { name: "Thicken surface", exact: true })
      .click();
    const guiSolidId = await eventually(async () => {
      const current = (await call("project_get")).result;
      assert.equal(current.objects.length, beforeThicken.objects.length + 1);
      return current.objects.find(
        (x) => !beforeThicken.objects.some((prior) => prior.id === x.id),
      ).id;
    });
    const guiSolid = (await call("object_get", { entityId: guiSolidId }))
      .result;
    const guiSolidDigest = await geometryDigest(guiSolidId);
    assert(guiSolid.exactCad && guiSolid.hasBrep);
    await mutate("history_undo", {});
    await mutate("history_redo", {});
    assert.deepEqual(await geometryDigest(guiSolidId), guiSolidDigest);
    await mutate("history_undo", {});
    const realSolid = await job(
      await mutate("cad_create", {
        name: "Real scan thickened part",
        recipe: {
          kind: "thicken",
          source: { featureId: realCad.featureId, output: 0 },
          thickness: -0.1,
        },
      }),
    );
    assert.deepEqual(
      await geometryDigest(realSolid.entityIds[0]),
      guiSolidDigest,
    );
    assert.deepEqual(await geometryDigest(scan.id), sourceDigest);
    const solidReport = await job(
      await call("cad_inspect", { entityId: realSolid.entityIds[0] }),
    );
    assert(
      solidReport.valid &&
        solidReport.solids === 1 &&
        solidReport.volumeMm3 > 0,
      JSON.stringify(solidReport),
    );
    const compareExact = (report) => {
      assert(report.valid);
      for (const key of ["solids", "shells", "faces", "edges", "vertices"])
        assert.equal(report[key], solidReport[key], key);
      for (const key of ["areaMm2", "signedVolumeMm3"])
        assert(
          Math.abs(report[key] - solidReport[key]) <=
            Math.max(1e-6, Math.abs(solidReport[key]) * 1e-8),
          `${key}: ${report[key]} versus ${solidReport[key]}`,
        );
    };
    const solidId = realSolid.entityIds[0];
    for (const item of (await call("project_get")).result.objects)
      if (item.id !== solidId && item.visible)
        await mutate("object_update", {
          entityId: item.id,
          patch: { visible: false },
        });
    const realStep = await job(
      await call("project_export", { format: "step" }),
    );
    const beforeStep = new Set(
      (await call("project_get")).result.objects.map((x) => x.id),
    );
    await job(
      await mutate("project_import", { artifactId: realStep.artifactId }),
    );
    const stepId = (await call("project_get")).result.objects.find(
      (x) => !beforeStep.has(x.id),
    ).id;
    const stepReport = await job(
      await call("cad_inspect", { entityId: stepId }),
    );
    compareExact(stepReport);
    const realProject = await job(
      await call("project_export", { format: "project" }),
    );
    await job(
      await mutate("project_import", {
        artifactId: realProject.artifactId,
        replace: true,
      }),
    );
    const reopenedSolid = await job(
      await call("cad_inspect", { entityId: solidId }),
    );
    compareExact(reopenedSolid);
    assert.deepEqual(await geometryDigest(scan.id), sourceDigest);
    assert.equal(
      (await call("object_get", { entityId: solidId })).result.parametric
        .feature.recipe.kind,
      "thicken",
    );
    await mutate("object_update", {
      entityId: scan.id,
      patch: { visible: true },
    });
    await mutate("object_select", { entityId: scan.id });
    await mutate("selection_set", {
      entityId: scan.id,
      triangles: Array.from({ length: 200 }, (_, i) => i),
    });
    const copiedRegion = (
      await mutate("selection_edit", { entityId: scan.id, operation: "copy" })
    ).result.entityId;
    const regionDigest = await geometryDigest(copiedRegion);
    for (const item of (await call("project_get")).result.objects)
      if (item.id !== copiedRegion && item.visible)
        await mutate("object_update", {
          entityId: item.id,
          patch: { visible: false },
        });
    const regionStl = await job(
      await call("project_export", { format: "stl" }),
    );
    const beforeCommonInput = new Set(
      (await call("project_get")).result.objects.map((x) => x.id),
    );
    await job(
      await mutate("project_import", {
        artifactId: regionStl.artifactId,
        unit: "mm",
        placeAtOrigin: false,
      }),
    );
    const commonInputId = (await call("project_get")).result.objects.find(
      (x) => !beforeCommonInput.has(x.id),
    ).id;
    const commonFit = await job(
      await mutate("surface_fit", {
        entityId: commonInputId,
        options: {
          countU: 4,
          countV: 4,
          degree: 3,
          projection: "xy",
          sampleLimit: 10000,
        },
      }),
    );
    assert.deepEqual(
      (await call("surface_get", { entityId: commonFit.entityId })).result
        .patch,
      realMcpPatch,
    );
    const nativeFiles = [];
    for (const [filename, artifact] of [
      ["real-region-input.stl", regionStl],
      ["real-region-solid.step", realStep],
    ]) {
      const bytes = await artifactBytes(artifact);
      await writeFile(new URL(filename, out), bytes);
      nativeFiles.push({
        filename,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    await writeFile(
      new URL("real-region-fit.json", out),
      JSON.stringify(
        {
          patch: realMcpPatch,
          options: {
            countU: 4,
            countV: 4,
            degree: 3,
            projection: "xy",
            sampleLimit: 10000,
          },
          thicknessMm: -0.1,
          report: solidReport,
          sourceDigest,
          regionDigest,
          files: nativeFiles,
        },
        null,
        2,
      ),
    );
    for (const item of (await call("project_get")).result.objects)
      if (item.id !== solidId && item.visible)
        await mutate("object_update", {
          entityId: item.id,
          patch: { visible: false },
        });
    await mutate("object_update", {
      entityId: solidId,
      patch: { visible: true },
    });
    assert.deepEqual(await geometryDigest(scan.id), sourceDigest);
    ledger.scenarios.push({
      realInput: {
        name,
        bytes: file.length,
        sha256: createHash("sha256").update(file).digest("hex"),
      },
      selectedFacets: 200,
      guiMcpPatchEquality: true,
      fit: realFit,
      exactFace: true,
      thickenedRegionGuiMcpEquality: true,
      solidReport,
      stepReport,
      projectReport: reopenedSolid,
      exchangeTolerance: { relative: 1e-8, absolute: 1e-6 },
      sourceDigestPreservedAfterReopen: true,
      sourceDigest,
      regionDigest,
      nativeFiles,
      commonNativeInputRefitEquality: true,
      limitation:
        "A selected real scan region with kernel validity and exchange checks; not whole-part reconstruction, a global self-intersection certificate or native application parity.",
    });
    await mutate("viewport_control", {
      action: "fit",
      entityId: solidId,
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  ledger.consoleErrors = consoleErrors;
  ledger.consoleWarnings = consoleWarnings;
  await page.screenshot({
    path: fileURLToPath(new URL("surface-fit-result.png", out)),
  });
  ledger.browserErrors = errors;
} catch (error) {
  failure ??= error;
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
  for (const resource of ledger.resources.filter(
    (r) => r.kind === "browser" || r.kind === "mcp-server",
  )) {
    let absent = false;
    for (let i = 0; i < 30; i++) {
      try {
        process.kill(resource.pid, 0);
      } catch {
        absent = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    ledger.cleanup.push({
      kind: resource.kind,
      pid: resource.pid,
      originalStart: resource.startedAt,
      absent,
    });
    if (!absent)
      failure ??= Error(
        `Owned ${resource.kind} ${resource.pid} remains; preserve for exact-identity investigation`,
      );
  }
  if (bridgePort) {
    const closed = !(await portOpen(bridgePort));
    ledger.cleanup.push({ port: bridgePort, closed });
    if (!closed) failure ??= Error("Owned bridge port remains open");
  }
  ledger.existingApplicationPreserved = await portOpen(5173);
  if (!ledger.existingApplicationPreserved)
    failure ??= Error(
      "Existing application server is unavailable after validation",
    );
  ledger.finishedAt = new Date().toISOString();
  ledger.passed = !failure;
  ledger.error = failure?.message;
  await save();
}
if (failure) throw failure;
console.log(
  `Surface fit browser regression passed: ${fileURLToPath(evidence)}`,
);

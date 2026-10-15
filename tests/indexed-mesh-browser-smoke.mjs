import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url),
  out = new URL("../.resources/indexed-mesh/", import.meta.url);
const admission = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("scripts/resource-check.mjs", root))],
  { stdio: "inherit" },
);
if (admission.status !== 0) process.exit(admission.status ?? 1);
await mkdir(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  browserLeaseMs = 240000,
  ledger = {
    owner: "indexed-mesh-browser",
    pid: process.pid,
    executable: process.execPath,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + browserLeaseMs).toISOString(),
    persistentData: false,
    resources: [],
  };
let server, reserve, browserServer, browser, client, transport, failed;
const deadline = setTimeout(() => {
  failed = Error("Browser validation lease expired");
  void browserServer?.close();
}, browserLeaseMs);
try {
  server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, "http://127.0.0.1").pathname;
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
  client = new Client({ name: "point-cloud-edit-validation", version: "1" });
  await client.connect(transport);
  ledger.resources.push({
    kind: "mcp-server",
    pid: transport.pid,
    port: bridgePort,
    bind: "127.0.0.1",
  });
  browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  ledger.resources.push({ kind: "browser", pid: browserServer.process().pid });
  await writeFile(
    new URL("indexed-mesh-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
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

  const ascii =
    "ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n99 99 99 1e18 0 0\n0 0 1 0 3 0\n2 0 1 0 0 4\n0 2 1 -1 -2 -3\n3 1 2 3\n";
  const geometry = async (entityId) => {
    const object = (
      await call("object_get", { entityId, includeGeometry: true })
    ).result;
    assert(object.indexedTopology);
    const artifact = (
      await call("artifact_read", { artifactId: object.geometry.artifactId })
    ).result;
    const value = JSON.parse(Buffer.from(artifact.base64, "base64").toString());
    assert.deepEqual(object.indexedTopology, {
      vertices: value.indexedMesh.vertices.length / 3,
      triangles: value.indexedMesh.triangles.length / 3,
    });
    return value;
  };
  const assertTopology = (value) => {
    assert.deepEqual(value.indexedMesh.triangles, [1, 2, 3]);
    for (let slot = 0; slot < 3; slot++)
      for (let axis = 0; axis < 3; axis++)
        assert.equal(
          value.positions[slot * 3 + axis],
          value.indexedMesh.vertices[
            value.indexedMesh.triangles[slot] * 3 + axis
          ],
        );
  };
  await page.locator('input[type="file"][accept*=".asc"]').setInputFiles({
    name: "gui-indexed.ply",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(ascii),
  });
  await page
    .getByRole("dialog", { name: "Import scan" })
    .getByRole("button", { name: "Import", exact: true })
    .click();
  let gui;
  for (let i = 0; i < 100; i++) {
    gui = (await call("project_get")).result.objects.find(
      (object) => object.name === "gui-indexed.ply",
    );
    if (gui) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(gui);
  const guiGeometry = await geometry(gui.id);
  const scannerNormals = [
    Math.fround(1e18),
    0,
    0,
    0,
    3,
    0,
    0,
    0,
    4,
    -1,
    -2,
    -3,
  ];
  assert.deepEqual(guiGeometry.indexedMesh.normals, scannerNormals);
  assertTopology(guiGeometry);
  assert.deepEqual(guiGeometry.positions, [-1, -1, 0, 1, -1, 0, -1, 1, 0]);
  const uploaded = (
    await call("artifact_put", {
      name: "mcp-indexed.ply",
      offset: 0,
      base64: Buffer.from(ascii).toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: uploaded.artifactId,
      unit: "cm",
    }),
  );
  const imported = (await call("project_get")).result.objects.find(
    (object) => object.name === "mcp-indexed.ply",
  );
  assert(imported);
  const importedGeometry = await geometry(imported.id);
  assert.deepEqual(importedGeometry.indexedMesh.normals, scannerNormals);
  assertTopology(importedGeometry);
  assert.deepEqual(
    importedGeometry.positions,
    [0, 0, 10, 20, 0, 10, 0, 20, 10],
  );
  await mutate("mesh_transform", {
    entityId: imported.id,
    translation: [1, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
  });
  assert.deepEqual(
    (await call("object_get", { entityId: imported.id })).result
      .indexedTopology,
    { vertices: 4, triangles: 1 },
  );
  assertTopology(await geometry(imported.id));
  await mutate("history_undo", {});
  assertTopology(await geometry(imported.id));
  const saved = (await job(await call("project_export", { format: "project" })))
    .result;
  const data = (await call("artifact_read", { artifactId: saved.artifactId }))
    .result;
  const restoredUpload = (
    await call("artifact_put", {
      name: "indexed.scanforge",
      offset: 0,
      base64: data.base64,
    })
  ).result;
  await job(
    await mutate("project_import", {
      artifactId: restoredUpload.artifactId,
      replace: true,
    }),
  );
  assertTopology(await geometry(imported.id));
  assertTopology(await geometry(gui.id));
  assert.deepEqual(
    (await geometry(gui.id)).indexedMesh.normals,
    scannerNormals,
  );
  assert.deepEqual(
    (await geometry(imported.id)).indexedMesh.normals,
    scannerNormals,
  );
  await page.screenshot({
    path: fileURLToPath(new URL("indexed-normals.png", out)),
  });
  const stlCapture = JSON.parse(
    await readFile(
      new URL("fixtures/stl-reader-native.json", import.meta.url),
      "utf8",
    ),
  ).samples.find((sample) => sample.name === "near-key");
  const stl = Buffer.alloc(84 + (stlCapture.coordinates.length / 9) * 50);
  stl.writeUInt32LE(stlCapture.coordinates.length / 9, 80);
  stlCapture.coordinates.forEach((value, i) =>
    stl.writeFloatLE(value, 84 + Math.floor(i / 9) * 50 + 12 + (i % 9) * 4),
  );
  await page.locator('input[type="file"][accept*=".asc"]').setInputFiles({
    name: "gui-native.stl",
    mimeType: "application/octet-stream",
    buffer: stl,
  });
  const importDialog = page.getByRole("dialog", { name: "Import scan" });
  await importDialog
    .getByRole("button", { name: "Import", exact: true })
    .click();
  let guiStl;
  for (let i = 0; i < 100; i++) {
    guiStl = (await call("project_get")).result.objects.find(
      (object) => object.name === "gui-native.stl",
    );
    if (guiStl) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(guiStl);
  const uploadStl = (
    await call("artifact_put", {
      name: "mcp-native.stl",
      offset: 0,
      base64: stl.toString("base64"),
    })
  ).result;
  await job(
    await mutate("project_import", { artifactId: uploadStl.artifactId }),
  );
  const mcpStl = (await call("project_get")).result.objects.find(
    (object) => object.name === "mcp-native.stl",
  );
  assert(mcpStl);
  const nativeGeometry = await geometry(guiStl.id);
  assert.deepEqual(nativeGeometry.indexedMesh.triangles, stlCapture.triangles);
  const rawStl = await geometry(mcpStl.id);
  assert.deepEqual(rawStl.indexedMesh.vertices, stlCapture.vertices);
  assert.deepEqual(rawStl.indexedMesh.triangles, stlCapture.triangles);
  const lower = [Infinity, Infinity, Infinity],
    upper = [-Infinity, -Infinity, -Infinity];
  rawStl.positions.forEach((value, i) => {
    lower[i % 3] = Math.min(lower[i % 3], value);
    upper[i % 3] = Math.max(upper[i % 3], value);
  });
  await mutate("mesh_transform", {
    entityId: mcpStl.id,
    translation: [
      -(lower[0] / 2 + upper[0] / 2),
      -(lower[1] / 2 + upper[1] / 2),
      -lower[2],
    ],
    rotation: [0, 0, 0],
    scale: 1,
  });
  assert.deepEqual(await geometry(mcpStl.id), nativeGeometry);
  const sourceLandmarks = [0, 0, 0, 10, 0, 0, 0, 10, 0];
  const targetLandmarks = [3, 4, 5, 13, 4, 5, 3, 14, 5];
  await job(
    await mutate("mesh_process", {
      entityId: gui.id,
      operation: { kind: "paired", sourceLandmarks, targetLandmarks },
    }),
  );
  const pairedGeometry = await geometry(gui.id);
  assertTopology(pairedGeometry);
  assert.equal(
    pairedGeometry.indexedMesh.vertices.length,
    guiGeometry.indexedMesh.vertices.length,
  );
  await mutate("history_undo", {});
  await mutate("selection_set", { entityId: gui.id, triangles: [] });
  await mutate("ui_set", {
    workspace: "landmarkAlignment",
    mode: "inspect",
    toolPanelOpen: true,
  });
  await page
    .getByRole("textbox", { name: "Source registration landmarks" })
    .fill("0,0,0\n10,0,0\n0,10,0");
  await page
    .getByRole("textbox", { name: "Target registration landmarks" })
    .fill("3,4,5\n13,4,5\n3,14,5");
  await page
    .getByRole("button", { name: "Align paired landmarks", exact: true })
    .click();
  await page
    .getByText(/Align paired landmarks complete/)
    .waitFor({ timeout: 30000 });
  assert.deepEqual(await geometry(gui.id), pairedGeometry);
  await mutate("history_undo", {});
  const native = JSON.parse(
    await readFile(
      new URL("fixtures/alignment-controller-thread.json", import.meta.url),
      "utf8",
    ),
  );
  const fixture = native.cases[0];
  async function importNative(name, vertices, triangles) {
    const ply =
      `ply\nformat ascii 1.0\nelement vertex ${vertices.length}\nproperty float x\nproperty float y\nproperty float z\nelement face ${triangles.length / 3}\nproperty list uchar int vertex_indices\nend_header\n` +
      vertices.map((v) => v.join(" ")).join("\n") +
      "\n" +
      Array.from(
        { length: triangles.length / 3 },
        (_, i) => `3 ${triangles.slice(i * 3, i * 3 + 3).join(" ")}`,
      ).join("\n") +
      "\n";
    const uploaded = (
      await call("artifact_put", {
        name,
        offset: 0,
        base64: Buffer.from(ply).toString("base64"),
      })
    ).result;
    await job(
      await mutate("project_import", {
        artifactId: uploaded.artifactId,
        unit: "mm",
      }),
    );
    return (await call("project_get")).result.objects.find(
      (o) => o.name === name,
    );
  }
  const moving = await importNative(
    "native-moving.ply",
    fixture.search.sourcePoints,
    fixture.search.sourceTriangles,
  );
  const fixed = await importNative(
    "native-fixed.ply",
    fixture.vertices,
    fixture.triangles,
  );
  const beforeMoving = await geometry(moving.id),
    beforeFixed = await geometry(fixed.id);
  const fixedExtra = await importNative(
    "native-fixed-extra.ply",
    fixture.vertices,
    fixture.triangles,
  );
  const beforeExtra = await geometry(fixedExtra.id);
  await mutate("selection_set", {
    entityId: moving.id,
    triangles: Array.from(
      { length: fixture.search.sourceTriangles.length / 3 },
      (_, i) => i,
    ),
  });
  const refined = await job(
    await mutate("mesh_process", {
      entityId: moving.id,
      targetIds: [fixed.id, fixedExtra.id],
      selectionOnly: true,
      operation: {
        kind: "nativeRefine",
        sampleBudget: 1,
        initialRadius: fixture.search.initialRadius,
      },
    }),
  );
  assert.deepEqual(refined.result.refinement.matrix, fixture.search.matrix);
  assert.deepEqual(
    refined.result.refinement.parameters,
    fixture.search.parameters,
  );
  assert.equal(refined.result.refinement.accepted, fixture.search.accepted);
  assert.deepEqual(await geometry(fixed.id), beforeFixed);
  const afterMoving = await geometry(moving.id);
  assert.equal(
    afterMoving.indexedMesh.triangles.length,
    beforeMoving.indexedMesh.triangles.length,
  );
  await mutate("history_undo", {});
  assert.deepEqual(await geometry(moving.id), beforeMoving);
  await mutate("selection_set", {
    entityId: moving.id,
    triangles: Array.from(
      { length: fixture.search.sourceTriangles.length / 3 },
      (_, i) => i,
    ),
  });
  await mutate("ui_set", {
    workspace: "fineAlign",
    mode: "inspect",
    toolPanelOpen: true,
  });
  const registrationTarget = page.getByRole("button", {
    name: "Registration target",
    exact: true,
  });
  await registrationTarget.scrollIntoViewIfNeeded();
  // Settle the inspector scroll before opening its scroll-dismissed menu.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await registrationTarget.click();
  await page
    .getByRole("option", { name: fixed.name, exact: true })
    .press("Enter");
  await page
    .getByRole("checkbox", { name: fixedExtra.name, exact: true })
    .check();
  await page
    .getByRole("spinbutton", {
      name: "Surface refinement samples",
      exact: true,
    })
    .fill("1");
  await page
    .getByRole("spinbutton", {
      name: "Alignment search distance (mm)",
      exact: true,
    })
    .fill(String(fixture.search.initialRadius));
  await page
    .getByRole("button", { name: "Refine indexed mesh surfaces", exact: true })
    .click();
  await page
    .getByText("Surface refinement complete", { exact: true })
    .waitFor({ timeout: 30000 });
  assert.deepEqual(await geometry(moving.id), afterMoving);
  assert.deepEqual(await geometry(fixed.id), beforeFixed);
  assert.deepEqual(await geometry(fixedExtra.id), beforeExtra);
  await mutate("history_undo", {});
  assert.deepEqual(await geometry(moving.id), beforeMoving);
  const seeded = await job(
    await mutate("mesh_process", {
      entityId: moving.id,
      targetIds: [fixed.id, fixedExtra.id],
      operation: {
        kind: "nativeRefine",
        sampleBudget: 1,
        initialRadius: fixture.search.initialRadius,
        seedVertices: [0],
        workerCount: 2,
        parallel: true,
      },
    }),
  );
  assert.equal(seeded.result.refinement.accepted, true);
  assert.equal(seeded.result.diagnostics.seededFaces, 2);
  assert.equal(seeded.result.diagnostics.seedGrowthPasses, 2);
  assert.equal(seeded.result.diagnostics.physicalWorkers, 2);
  const afterSeeded = await geometry(moving.id);
  await mutate("history_undo", {});
  assert.deepEqual(await geometry(moving.id), beforeMoving);
  await mutate("ui_set", {
    workspace: "fineAlign",
    mode: "inspect",
    toolPanelOpen: true,
  });
  await page.getByText("Landmark refinement region", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Source seed vertex IDs", exact: true })
    .fill("0");
  await page
    .getByRole("checkbox", { name: "Use multiple CPU cores", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Refine indexed mesh surfaces", exact: true })
    .click();
  await page
    .getByText("Surface refinement complete", { exact: true })
    .waitFor({ timeout: 30000 });
  assert.deepEqual(await geometry(moving.id), afterSeeded);
  assert.deepEqual(await geometry(fixed.id), beforeFixed);
  assert.deepEqual(await geometry(fixedExtra.id), beforeExtra);
  const beforeLandmarks = await geometry(gui.id);
  const pairedRefinement = await job(
    await mutate("mesh_process", {
      entityId: gui.id,
      targetId: moving.id,
      operation: {
        kind: "paired",
        sourceLandmarks,
        targetLandmarks,
        refineSurface: true,
        workerCount: 2,
        parallel: true,
      },
    }),
  );
  assert.equal(
    pairedRefinement.result.diagnostics.algorithm,
    "native-landmark-registration-and-refinement",
  );
  assert.equal(pairedRefinement.result.diagnostics.logicalLanes, 2);
  assert.equal(pairedRefinement.result.diagnostics.physicalWorkers, 2);
  const afterPairedRefinement = await geometry(gui.id);
  await mutate("history_undo", {});
  assert.deepEqual(await geometry(gui.id), beforeLandmarks);
  await mutate("landmark_edit", {
    action: "begin",
    movingId: gui.id,
    fixedId: moving.id,
  });
  for (let i = 0; i < 3; i++) {
    await mutate("landmark_edit", {
      action: "pick",
      entityId: gui.id,
      point: sourceLandmarks.slice(i * 3, i * 3 + 3),
    });
    await mutate("landmark_edit", {
      action: "pick",
      entityId: moving.id,
      point: targetLandmarks.slice(i * 3, i * 3 + 3),
    });
  }
  const landmarkDialog = page.getByRole("complementary", {
    name: "N-points alignment",
  });
  await landmarkDialog
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await landmarkDialog.getByText(/Preview RMS:/).waitFor();
  const locked = (await call("landmark_get")).result;
  assert.equal(locked.preview, true);
  assert.equal(locked.picks.length, 6);
  assert.equal(
    await landmarkDialog
      .getByRole("button", { name: "Remove last point", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    (await mutate("landmark_edit", { action: "clear" })).result.picks.length,
    6,
  );
  const reset = (await mutate("landmark_edit", { action: "reset" })).result;
  assert.equal(reset.preview, false);
  assert.deepEqual(reset.picks, locked.picks);
  await landmarkDialog
    .getByRole("button", { name: "Remove last point", exact: true })
    .click();
  assert.equal((await call("landmark_get")).result.picks.length, 5);
  assert.deepEqual(await geometry(gui.id), beforeLandmarks);
  assert.deepEqual(await geometry(moving.id), afterSeeded);
  await mutate("landmark_edit", {
    action: "pick",
    entityId: moving.id,
    point: targetLandmarks.slice(6, 9),
  });
  const historyCursor = (await call("history_get")).result.cursor;
  const agentPreview = await job(
    await mutate("landmark_preview", { workerCount: 2, parallel: true }),
  );
  assert.equal(agentPreview.result.preview, true);
  assert.equal(agentPreview.result.diagnostics.physicalWorkers, 2);
  assert.deepEqual(agentPreview.result.registration, locked.registration);
  assert.deepEqual(agentPreview.result.refinement, locked.refinement);
  assert.deepEqual(await geometry(gui.id), beforeLandmarks);
  assert.equal((await call("history_get")).result.cursor, historyCursor);
  const acceptRequest = {
    expectedRevision: (await call("project_get")).revision,
    requestId: randomUUID(),
  };
  const accepted = await call("landmark_accept", acceptRequest);
  assert.equal(accepted.result.accepted, true);
  assert.deepEqual(await call("landmark_accept", acceptRequest), accepted);
  assert.equal((await call("history_get")).result.cursor, historyCursor + 1);
  await landmarkDialog.waitFor({ state: "hidden" });
  assert.deepEqual(await geometry(gui.id), afterPairedRefinement);
  assert.deepEqual(await geometry(moving.id), afterSeeded);
  await mutate("history_undo", {});
  assert.deepEqual(await geometry(gui.id), beforeLandmarks);
  await mutate("landmark_edit", {
    action: "begin",
    movingId: gui.id,
    fixedId: moving.id,
  });
  await mutate("preview_discard", { target: "landmarks" });
  assert.equal((await call("landmark_get")).result.active, false);
  assert.deepEqual(errors, []);
  ledger.result = {
    passed: true,
    guiImport: true,
    mcpImport: true,
    guiMcpNativeStlImport: true,
    unitConversion: true,
    originPlacement: true,
    binaryPersistence: true,
    indexedScannerNormals: true,
    transformTopologyRetention: true,
    undoRestoration: true,
    nativeRefinement: true,
    guiNativeRefinement: true,
    guiMcpTargetGroupRefinement: true,
    guiMcpPairedTopologyRetention: true,
    guiMcpLandmarkEditing: true,
    guiMcpLandmarkRefinement: true,
    guiMcpMulticoreSeededRefinement: true,
    errors,
  };
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
  ledger.cleanedAt = new Date().toISOString();
  ledger.passed = !failed;
  ledger.error = failed?.message;
  await writeFile(
    new URL("indexed-mesh-browser-ledger.json", out),
    JSON.stringify(ledger, null, 2),
  );
}

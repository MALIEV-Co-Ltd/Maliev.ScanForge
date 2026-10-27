import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { completeSketchSurfaceAcceptance } from "./sketch-surface-acceptance.mjs";
import { assertSketchPlacement } from "./sketch-surface-placement.mjs";

export async function replaySketchSurface({
  page,
  call,
  mutate,
  job,
  eventually,
  geometryDigest,
  artifactBytes,
  ledger,
  out,
  sourceId,
}) {
  const center = [0.210029929876, 0.06886227428913];
  const radiusMm = 3;
  const sketch = {
    version: 1,
    frame: {
      origin: [0, 0, 5],
      u: [1, 0, 0],
      v: [0, 1, 0],
      normal: [0, 0, 1],
    },
    points: [
      { id: "circle-right", x: center[0] + radiusMm, y: center[1] },
      { id: "circle-left", x: center[0] - radiusMm, y: center[1] },
      { id: "circle-center", x: center[0], y: center[1] },
    ],
    segments: [
      {
        id: "radius-guide",
        a: "circle-center",
        b: "circle-right",
        construction: true,
      },
    ],
    arcs: [
      {
        id: "upper-semicircle",
        a: "circle-right",
        b: "circle-left",
        center: "circle-center",
        clockwise: false,
      },
      {
        id: "lower-semicircle",
        a: "circle-left",
        b: "circle-right",
        center: "circle-center",
        clockwise: false,
      },
    ],
    constraints: [
      {
        id: "fixed-center",
        kind: "fixed",
        point: "circle-center",
        x: center[0],
        y: center[1],
      },
    ],
  };
  const sourceDigest = await geometryDigest(sourceId);
  const savedName = "Sketch surface analytic circle";
  const saved = await mutate("sketch_manage", {
    action: "create",
    name: savedName,
    sketch,
  });
  const sketchId = saved.result.sketchId;
  assert.equal(typeof sketchId, "string");
  await mutate("sketch_manage", { action: "activate", sketchId });
  await mutate("object_select", {});
  const authored = (await call("sketch_get")).result;
  assert.equal(authored.activeSketchId, sketchId);
  assert.deepEqual(authored.sketch, sketch);
  assert.deepEqual(
    authored.sketches.find((item) => item.id === sketchId).sketch,
    sketch,
  );

  // Establish the actual public-MCP analytic face before the missing GUI action.
  const before = (await call("project_get")).result;
  const created = await job(
    await mutate("cad_create", {
      name: "MCP analytic sketch face",
      recipe: { kind: "sketchSurface", sketch: structuredClone(sketch) },
      selectCreated: false,
    }),
  );
  assert.equal(created.entityIds.length, 1);
  const faceId = created.entityIds[0];
  const face = (await call("object_get", { entityId: faceId })).result;
  assert(face.exactCad && face.hasBrep, JSON.stringify(face));
  assert.deepEqual(face.parametric.feature.recipe, {
    kind: "sketchSurface",
    sketch,
  });
  const after = (await call("project_get")).result;
  assert.equal(after.undo, before.undo + 1);
  assert.equal(after.selectedId, null);
  assert.equal(after.objects.length, before.objects.length + 1);
  assert.deepEqual((await call("sketch_get")).result, authored);
  assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
  const noSketchUndo = await mutate("history_undo", { scope: "sketch" });
  assert.equal(
    noSketchUndo.result.updated,
    false,
    "Shared CAD creation must not add even an equal-content authoring history edit",
  );
  const afterSketchUndo = (await call("project_get")).result;
  assert.equal(afterSketchUndo.undo, after.undo);
  assert.equal(afterSketchUndo.redo, after.redo);
  const stableObjects = (project) =>
    project.objects.map(({ meshPreparation, ...item }) => item);
  assert.deepEqual(stableObjects(afterSketchUndo), stableObjects(after));
  assert.deepEqual((await call("sketch_get")).result, authored);
  assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
  const report = await job(
    await call("cad_inspect", {
      entityId: faceId,
      edgeOffset: 0,
      edgeLimit: 8,
    }),
  );
  assert.equal(report.units, "mm");
  assert.equal(report.valid, true);
  assert.equal(report.faces, 1);
  assert.equal(report.solids, 0);
  assert.equal(report.edges, 2);
  assert.equal(report.volumeMm3, 0);
  assert(
    Math.abs(report.areaMm2 - 9 * Math.PI) <= 1e-7,
    JSON.stringify(report),
  );
  assert.deepEqual(
    report.edgeReferences.items.map((edge) => edge.kind).sort(),
    ["circle", "circle"],
  );
  assert.equal(report.edgeReferences.nextOffset, null);
  for (const edge of report.edgeReferences.items) {
    assert.equal(edge.degenerate, false);
    assert(Math.abs(edge.lengthMm - 3 * Math.PI) <= 1e-7);
    assert(edge.boundsMm, JSON.stringify(edge));
    for (const z of [edge.boundsMm.min[2], edge.boundsMm.max[2]])
      assert(Math.abs(z - 5) <= 1e-6, JSON.stringify(edge));
  }
  const placementProof = assertSketchPlacement(report, sketch);
  const analytic = {
    centerXYMm: center,
    radiusMm,
    frame: sketch.frame,
    expectedAreaMm2: 9 * Math.PI,
    areaToleranceMm2: 1e-7,
    report,
    placementProof,
    noSketchHistoryEdit: noSketchUndo.result.updated === false,
    unchangedAuthoring: true,
    sourceBuffersPreserved: true,
    oneModelHistoryStep: true,
    scope:
      "Synthetic analytic circle through public MCP and actual OpenCascade; no scan-fit or native-operation equivalence claim",
  };
  ledger.scenarios.push({ sketchSurfaceAnalyticMcp: analytic });
  await writeFile(
    new URL("sketch-surface-analytic-mcp.json", out),
    JSON.stringify(analytic, null, 2),
  );

  // Selecting the saved sketch through the GUI must clear object selection.
  await mutate("object_select", { entityId: sourceId });
  await page
    .getByRole("list", { name: "Sketch objects", exact: true })
    .getByRole("button", { name: savedName, exact: true })
    .click();
  await eventually(async () => {
    assert.equal((await call("project_get")).result.selectedId, null);
    assert.deepEqual((await call("sketch_get")).result, authored);
  });
  await page.getByRole("tab", { name: "Surfacing", exact: true }).click();
  await page.screenshot({
    path: fileURLToPath(new URL("sketch-surface-admission.png", out)),
  });
  const action = page.getByRole("button", {
    name: "From 2D sketch",
    exact: true,
  });
  // Intended initial RED: the ribbon action is still planned/disabled.
  assert(
    await action.isEnabled(),
    "From 2D sketch must accept the active saved sketch with no object selected",
  );
  await action.click();
  await page
    .getByRole("region", { name: "Surface from sketch", exact: true })
    .waitFor();
  ledger.scenarios.push({
    sketchSurfaceGuiAdmission: { activeSavedSketch: true, selectedId: null },
  });
  await completeSketchSurfaceAcceptance({
    page,
    call,
    mutate,
    job,
    eventually,
    geometryDigest,
    artifactBytes,
    ledger,
    out,
    sourceId,
    sourceDigest,
    sketch,
    sketchId,
    savedName,
    analyticFaceId: faceId,
  });
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { nativeStepPatch } from "./native-step-patch.mjs";

export async function replayNativeFit({
  page,
  call,
  mutate,
  job,
  eventually,
  geometryDigest,
  artifactBytes,
  ledger,
  sourceId,
  path,
}) {
  const bytes = await readFile(path),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    sha256,
    "1c7bf1331f1294b387f4b059cbd60ed66671abe9e629b3b16307f6d2c6bfdfd7",
  );
  const { patch } = nativeStepPatch(bytes.toString("utf8"));
  const sourceDigest = await geometryDigest(sourceId);
  await mutate("settings_set", { patch: { importPlaceAtOrigin: false } });
  const before = await call("project_get"),
    priorIds = new Set(before.result.objects.map((x) => x.id));
  await page.locator('input[type=file][accept*=".stp"]').setInputFiles(path);
  const guiId = await eventually(async () => {
    const current = (await call("project_get")).result;
    const added = current.objects.filter((x) => !priorIds.has(x.id));
    assert.equal(added.length, 1);
    return added[0].id;
  });
  await eventually(async () => {
    const session = (await call("session_get")).result;
    assert.equal(session.busy, false);
    assert.equal(session.activeJobId, null);
  });
  const guiDigest = await geometryDigest(guiId),
    guiReport = await job(await call("cad_inspect", { entityId: guiId }));
  assert(guiReport.valid && guiReport.faces === 1 && guiReport.solids === 0);
  assert.equal((await call("project_get")).result.undo, before.result.undo + 1);
  await mutate("history_undo", {});
  const uploaded = (
    await call("artifact_put", {
      name: basename(path),
      offset: 0,
      base64: bytes.toString("base64"),
    })
  ).result;
  const beforeMcpImport = (await call("project_get")).result.undo;
  await job(
    await mutate("project_import", {
      artifactId: uploaded.artifactId,
      unit: "mm",
      placeAtOrigin: false,
    }),
  );
  const entity = (await call("project_get")).result.objects.find(
    (x) => !priorIds.has(x.id),
  );
  assert(entity.exactCad && entity.hasBrep);
  assert.equal((await call("project_get")).result.undo, beforeMcpImport + 1);
  assert.deepEqual(await geometryDigest(entity.id), guiDigest);
  const report = await job(await call("cad_inspect", { entityId: entity.id }));
  for (const key of [
    "valid",
    "faces",
    "solids",
    "edges",
    "vertices",
    "areaMm2",
  ])
    assert.equal(report[key], guiReport[key]);
  await mutate("history_undo", {});
  await mutate("history_redo", {});
  assert.deepEqual(await geometryDigest(entity.id), guiDigest);
  await mutate("object_select", { entityId: entity.id });
  await page.getByRole("tab", { name: "Surfacing", exact: true }).click();
  await page.getByRole("button", { name: "Thicken", exact: true }).click();
  const panel = page.getByRole("region", {
    name: "Thicken surface",
    exact: true,
  });
  await panel
    .getByRole("spinbutton", {
      name: "Signed wall thickness (mm)",
      exact: true,
    })
    .fill("-0.1");
  const beforeSolid = await call("project_get"),
    oldIds = new Set(beforeSolid.result.objects.map((x) => x.id));
  await panel
    .getByRole("button", { name: "Thicken surface", exact: true })
    .click();
  const guiSolidId = await eventually(async () => {
    const objects = (await call("project_get")).result.objects,
      added = objects.filter((x) => !oldIds.has(x.id));
    assert.equal(added.length, 1);
    return added[0].id;
  });
  await eventually(async () => {
    const session = (await call("session_get")).result;
    assert.equal(session.busy, false);
    assert.equal(session.activeJobId, null);
  });
  const solidDigest = await geometryDigest(guiSolidId);
  assert.equal(
    (await call("project_get")).result.undo,
    beforeSolid.result.undo + 1,
  );
  await mutate("history_undo", {});
  const beforeMcpThicken = (await call("project_get")).result.undo;
  const solid = await job(
    await mutate("cad_create", {
      name: "Native fit thickened by ScanForge",
      recipe: {
        kind: "thicken",
        source: { featureId: entity.id, output: 0 },
        thickness: -0.1,
      },
    }),
  );
  const solidId = solid.entityIds[0];
  assert.equal((await call("project_get")).result.undo, beforeMcpThicken + 1);
  assert.deepEqual(await geometryDigest(solidId), solidDigest);
  const solidReport = await job(
    await call("cad_inspect", { entityId: solidId }),
  );
  assert(solidReport.valid && solidReport.solids === 1);
  await mutate("history_undo", {});
  await mutate("history_redo", {});
  assert.deepEqual(await geometryDigest(solidId), solidDigest);
  const saved = await job(await call("project_export", { format: "project" }));
  const beforeGuiReopen = (await call("session_get")).revision;
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[type=file][accept*=".scanforge"]').setInputFiles({
    name: "native-fit-reopen.scanforge",
    mimeType: "application/octet-stream",
    buffer: await artifactBytes(saved),
  });
  await eventually(async () => {
    const session = await call("session_get");
    assert(session.revision > beforeGuiReopen);
    assert.equal(session.result.busy, false);
    assert.equal(session.result.activeJobId, null);
  });
  assert.deepEqual(await geometryDigest(entity.id), guiDigest);
  assert.deepEqual(await geometryDigest(solidId), solidDigest);
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(await geometryDigest(entity.id), guiDigest);
  assert.deepEqual(await geometryDigest(solidId), solidDigest);
  for (const item of (await call("project_get")).result.objects)
    if (item.visible !== (item.id === solidId))
      await mutate("object_update", {
        entityId: item.id,
        patch: { visible: item.id === solidId },
      });
  const step = await job(await call("project_export", { format: "step" }));
  const old = new Set(
    (await call("project_get")).result.objects.map((x) => x.id),
  );
  await job(
    await mutate("project_import", {
      artifactId: step.artifactId,
      unit: "mm",
      placeAtOrigin: false,
    }),
  );
  const reopened = (await call("project_get")).result.objects.find(
    (x) => !old.has(x.id),
  );
  const stepReport = await job(
    await call("cad_inspect", { entityId: reopened.id }),
  );
  assert(
    stepReport.valid &&
      stepReport.solids === solidReport.solids &&
      stepReport.faces === solidReport.faces,
  );
  for (const key of ["areaMm2", "volumeMm3"])
    assert(
      Math.abs(stepReport[key] - solidReport[key]) <
        Math.max(1e-6, Math.abs(solidReport[key]) * 1e-8),
    );
  assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
  assert.equal(
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    sha256,
  );
  ledger.scenarios.push({
    capturedNativeFit: {
      sha256,
      provenance:
        "QuickSurface8.0.123 actual accepted Simple fitting on connected200-facet scan, native STEP AP214 export",
      nativeUi: {
        uLabel: 4,
        vLabel: 4,
        degree: 3,
        orientation: "OXY",
        expand: 0,
        smoothness: 0,
      },
      nativeControlNet: {
        countU: patch.countU,
        countV: patch.countV,
        degreeU: patch.degreeU,
        degreeV: patch.degreeV,
      },
      guiMcpImportGeometryEquality: true,
      guiMcpThickenGeometryEquality: true,
      oneHistoryStepPerOperation: true,
      undoRedo: true,
      exactGeometryProjectPreserved: true,
      guiMcpProjectReopenGeometryEquality: true,
      exactStepRoundTrip: true,
      sourcePreserved: true,
      report,
      scanforgeThickenedReport: solidReport,
      stepReport,
      scope:
        "Native-generated fit imported/inspected/modeled through ScanForge GUI/public MCP. Thickening is ScanForge's operation, not native QuickSurface thicken equivalence.",
    },
  });
}

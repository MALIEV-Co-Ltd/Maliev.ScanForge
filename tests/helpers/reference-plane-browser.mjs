import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

/** Authored plane extent/location parity through the public stdio SDK and GUI. */
export async function referencePlaneSources({
  page,
  call,
  mutate,
  job,
  ledger,
  artifactDir,
}) {
  await mutate("project_new", {
    discard: true,
    name: "Plane line source parity",
  });
  const object = async (entityId) =>
    (await call("object_get", { entityId })).result;
  const preview = async (args) =>
    (await mutate("reference_construct", { action: "preview", ...args }))
      .result;
  const cancel = async (p) =>
    mutate("reference_construct", {
      action: "cancel",
      sessionId: p.sessionId,
      version: p.version,
    });
  const apply = async (p) =>
    (
      await mutate("reference_construct", {
        action: "apply",
        sessionId: p.sessionId,
        version: p.version,
      })
    ).result.entityId;
  const planeId = (
    await mutate("datum_construct", {
      kind: "plane",
      name: "Authored plane",
      origin: [0, 0, 0],
      normal: [0, 0, 1],
      xDirection: [0, 1, 0],
      displaySize: 20,
    })
  ).result.entityId;
  const anchorId = await apply(
    await preview({
      kind: "point",
      name: "Projection point",
      position: [2, 3, 8],
    }),
  );
  await mutate("object_select", { entityId: planeId });
  await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
  await page
    .getByRole("button", { name: "Edit reference plane", exact: true })
    .click();
  const planeDialog = page.getByRole("dialog", {
    name: "Edit reference plane",
    exact: true,
  });
  assert.equal(
    await planeDialog
      .getByLabel("Datum display size", { exact: true })
      .inputValue(),
    "20",
  );
  await planeDialog
    .getByLabel("Datum display size", { exact: true })
    .fill("21");
  await planeDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await planeDialog.waitFor({ state: "detached" });
  assert.equal((await object(planeId)).planeFrame.displaySize, 20);
  const picks = [
    { entityId: anchorId },
    { entityId: planeId, planeUV: [1.25, -2.5] },
  ];
  const seed = await preview({
    kind: "line",
    start: [0, 0, 0],
    end: [0, 0, 3],
  });
  const independent = await preview({
    kind: "line",
    mode: "pair",
    sourcePicks: picks,
    sessionId: seed.sessionId,
    version: seed.version,
  });
  assert.deepEqual(
    independent.definition.records[1].coordinates,
    [2.5, 1.25, 0],
  );
  assert.deepEqual(independent.geometry, {
    kind: "line",
    start: [2, 3, 8],
    direction: [0, 0, -1],
    length: 8,
  });
  await cancel(independent);
  await page.getByRole("tab", { name: "Construct", exact: true }).click();
  await page
    .getByRole("group", { name: "Primitives", exact: true })
    .getByRole("button", { name: "Reference line", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Reference line",
    exact: true,
  });
  const ready = async () => {
    for (let i = 0; i < 100; i++) {
      if (
        await dialog
          .getByRole("button", { name: "Apply", exact: true })
          .isEnabled()
      )
        return;
      await page.waitForTimeout(25);
    }
    throw Error("Plane reference preview did not become applicable");
  };
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await ready();
  const choose = async (index, name) => {
    await dialog.locator(".app-select > button").nth(index).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  await choose(0, "Two primitives");
  await choose(1, "Projection point");
  await choose(2, "Authored plane");
  await dialog
    .getByLabel("Source 2 plane U", { exact: true })
    .pressSequentially("1.25");
  await dialog
    .getByLabel("Source 2 plane V", { exact: true })
    .pressSequentially("-2.5");
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await ready();
  const gui = (await call("reference_construction_get")).result;
  assert.deepEqual(gui.definitionEncoding, independent.definitionEncoding);
  assert.deepEqual(gui.geometryEncoding, independent.geometryEncoding);
  await mutate("viewport_control", { action: "fit" });
  await page.screenshot({
    path: fileURLToPath(new URL("plane-located-pair-preview.png", artifactDir)),
  });
  const before = new Set(
    (await call("project_get")).result.objects.map((row) => row.id),
  );
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const lineId = (await call("project_get")).result.objects.find(
    (row) => !before.has(row.id),
  ).id;
  const original = (await object(lineId)).reference.definitionEncoding;
  const secondPlaneId = (
    await mutate("datum_construct", {
      kind: "plane",
      name: "Orthogonal plane",
      origin: [0, 0, 0],
      normal: [0, 1, 0],
      displaySize: 12,
    })
  ).result.entityId;
  const intersectionSeed = await preview({
    kind: "line",
    start: [0, 0, 0],
    end: [0, 0, 3],
  });
  const intersection = await preview({
    kind: "line",
    mode: "pair",
    sessionId: intersectionSeed.sessionId,
    version: intersectionSeed.version,
    sourcePicks: [
      { entityId: planeId, planeUV: [0, 0] },
      { entityId: secondPlaneId, planeUV: [0, 0] },
    ],
  });
  assert.equal(intersection.geometry.length, 20);
  const intersectionId = await apply(intersection);
  await mutate("mesh_transform", {
    entityId: secondPlaneId,
    translation: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 3,
  });
  assert.equal((await object(secondPlaneId)).planeFrame.displaySize, 36);
  assert.equal((await object(intersectionId)).reference.geometry.length, 36);
  await mutate("mesh_transform", {
    entityId: planeId,
    translation: [0, 0, 2],
    rotation: [0, 0, 0],
    scale: 1,
  });
  assert.equal((await object(lineId)).reference.geometry.length, 6);
  assert.deepEqual(
    (await object(lineId)).reference.definitionEncoding,
    original,
  );
  await mutate("history_undo", {});
  assert.equal((await object(lineId)).reference.geometry.length, 8);
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  assert.equal((await object(planeId)).planeFrame.displaySize, 20);
  assert.equal((await object(secondPlaneId)).planeFrame.displaySize, 36);
  assert.equal((await object(intersectionId)).reference.geometry.length, 36);
  assert.deepEqual(
    (await object(lineId)).reference.definitionEncoding,
    original,
  );
  await mutate("history_redo", {});
  assert.equal((await object(lineId)).reference.geometry.length, 6);
  await mutate("viewport_control", { action: "fit" });
  await page.screenshot({
    path: fileURLToPath(
      new URL("plane-source-history-parity.png", artifactDir),
    ),
  });
  const prior = await object(lineId);
  await mutate("object_update", { entityId: lineId, patch: { locked: true } });
  const lockedBefore = (await call("project_get")).result;
  await assert.rejects(
    mutate("mesh_transform", {
      entityId: planeId,
      translation: [0, 0, 1],
      rotation: [0, 0, 0],
      scale: 1,
    }),
    /locked/i,
  );
  assert.deepEqual((await call("project_get")).result, lockedBefore);
  assert.deepEqual((await object(lineId)).reference, prior.reference);
  ledger.planeLineSources = {
    planeId,
    anchorId,
    lineId,
    secondPlaneId,
    intersectionId,
    guiMcpEqual: true,
    retainedF32Bits: true,
    sourceTransformRefresh: true,
    twoPlaneExtentRefresh: true,
    undoRedo: true,
    workerReopenWithFuture: true,
    nativeControllerAcceptance: false,
  };
}

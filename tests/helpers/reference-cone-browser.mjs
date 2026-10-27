import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PerspectiveCamera, Vector3 } from "three";

/** Real worker shapes, actual GUI selectors and independent public SDK intents. */
export async function referenceConeSources({
  page,
  call,
  mutate,
  job,
  ledger,
  artifactDir,
}) {
  await mutate("project_new", { discard: true, name: "Cone source parity" });
  const object = async (entityId) =>
    (await call("object_get", { entityId })).result;
  const measuredShape = async (entityId, input) => {
    const details = (
      await call("object_get", { entityId, includeGeometry: true })
    ).result;
    const chunks = [];
    let offset = 0;
    for (;;) {
      const part = (
        await call("artifact_read", {
          artifactId: details.geometry.artifactId,
          offset,
          length: 262144,
        })
      ).result;
      const chunk = Buffer.from(part.base64, "base64");
      assert.equal(part.nextOffset, offset + chunk.length);
      assert(
        part.nextOffset <= 8 * 1024 * 1024,
        "Cone fixture exceeds its8MiB geometry budget",
      );
      chunks.push(chunk);
      if (part.eof) break;
      assert(part.nextOffset > offset);
      offset = part.nextOffset;
    }
    const geometry = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const point = (index) =>
      geometry.indexedMesh
        ? geometry.indexedMesh.vertices.slice(
            geometry.indexedMesh.triangles[index] * 3,
            geometry.indexedMesh.triangles[index] * 3 + 3,
          )
        : geometry.positions.slice(index * 3, index * 3 + 3);
    const count = geometry.indexedMesh
      ? geometry.indexedMesh.triangles.length
      : geometry.positions.length / 3;
    assert(count > 0 && count % 3 === 0);
    let low = Infinity,
      high = -Infinity,
      baseRadius = 0,
      topRadius = 0,
      sixVolume = 0;
    for (let index = 0; index < count; index += 3) {
      const triangle = [point(index), point(index + 1), point(index + 2)].map(
        (p) => p.map((value, axis) => value - input.center[axis]),
      );
      for (const p of triangle) {
        assert(p.every(Number.isFinite));
        low = Math.min(low, p[2]);
        high = Math.max(high, p[2]);
        const radius = Math.hypot(p[0], p[1]);
        if (Math.abs(p[2] + input.height / 2) < 1e-4)
          baseRadius = Math.max(baseRadius, radius);
        if (Math.abs(p[2] - input.height / 2) < 1e-4)
          topRadius = Math.max(topRadius, radius);
      }
      const [a, b, c] = triangle;
      sixVolume +=
        a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    assert(
      Math.abs(low + input.height / 2) < 1e-4 &&
        Math.abs(high - input.height / 2) < 1e-4,
    );
    assert(
      Math.abs(baseRadius - input.radius) < 1e-4 &&
        Math.abs(topRadius - input.topRadius) < 1e-4,
      "Actual worker end radii must match the declared recipe",
    );
    const volume = Math.abs(sixVolume / 6),
      analytic =
        (Math.PI *
          input.height *
          (input.radius ** 2 +
            input.radius * input.topRadius +
            input.topRadius ** 2)) /
        3;
    assert(
      Math.abs(volume - analytic) / analytic < 0.03,
      "Tessellated cone volume must match the analytic fixture within3%; no exact kernel mass claim",
    );
    return {
      triangles: count / 3,
      axialBounds: [low, high],
      baseRadius,
      topRadius,
      tessellatedVolume: volume,
      analyticVolume: analytic,
      endpointToleranceMm: 1e-4,
      relativeVolumeTolerance: 0.03,
    };
  };
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
  const line = async (mode, sourcePicks, center) => {
    const seed = await preview({
      kind: "line",
      start: [center[0], center[1], center[2] - 3],
      end: [center[0], center[1], center[2] + 3],
    });
    return preview({
      kind: "line",
      mode,
      sessionId: seed.sessionId,
      version: seed.version,
      sourcePicks,
    });
  };
  const ready = async (dialog) => {
    await dialog.getByRole("button", { name: "Apply", exact: true }).waitFor();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await dialog
          .getByRole("button", { name: "Apply", exact: true })
          .isEnabled()
      )
        return;
      await page.waitForTimeout(25);
    }
    throw Error("Cone reference preview did not become applicable");
  };
  const open = async (kind) => {
    await page.getByRole("tab", { name: "Construct", exact: true }).click();
    await page
      .getByRole("group", { name: "Primitives", exact: true })
      .getByRole("button", { name: `Reference ${kind}`, exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: `Reference ${kind}`,
      exact: true,
    });
    await dialog.waitFor();
    return dialog;
  };
  const choose = async (dialog, index, name) => {
    await dialog.locator(".app-select > button").nth(index).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  const rows = [];
  for (const [index, topRadius] of [0, 2, 4, 6].entries()) {
    const center = [10 + 16 * index, 20, 30];
    const input = {
      kind: "cone",
      center,
      axis: [0, 0, 2],
      radius: 4,
      topRadius,
      height: 8,
    };
    const name = `Cone source top ${topRadius}`;
    const entityId = (
      await job(
        await mutate("cad_create", {
          name,
          recipe: { kind: "primitive", input },
        }),
      )
    ).entityIds[0];
    const source = await object(entityId);
    assert.equal(source.exactCad, true);
    assert.deepEqual(source.parametric.feature.recipe.input, input);
    const measured = await measuredShape(entityId, input);
    await mutate("viewport_control", { action: "fit" });
    const faces = await job(
      await call("alignment_references", { entityId, limit: 100 }),
    );
    const surfaceKind = topRadius === 4 ? "cylinder" : "cone";
    assert(
      faces.references.some(
        (face) => face.source === "cadFace" && face.surfaceKind === surfaceKind,
      ),
      `Actual worker must produce ${surfaceKind}`,
    );
    for (const [kind, mode] of [
      ["point", "center"],
      ["point", "pair"],
      ["line", "pair"],
      ["line", "average"],
    ]) {
      const sources = (
        await call("reference_construction_sources", { kind, mode, limit: 100 })
      ).result.sources;
      assert(
        sources.some(
          (row) =>
            row.entityId === entityId &&
            row.eligible &&
            row.primitiveKind === "axis",
        ),
      );
    }
    const independent = await preview({
      kind: "point",
      mode: "center",
      sourceEntityIds: [entityId],
    });
    assert.deepEqual(independent.geometry.position, center);
    await cancel(independent);
    const before = new Set(
      (await call("project_get")).result.objects.map((row) => row.id),
    );
    let dialog = await open("point");
    await choose(dialog, 0, "Primitive center");
    await choose(dialog, 1, name);
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await ready(dialog);
    assert.deepEqual(
      (await call("reference_construction_get")).result.geometryEncoding,
      independent.geometryEncoding,
    );
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const centerId = (await call("project_get")).result.objects.find(
      (row) => !before.has(row.id),
    ).id;
    const anchorName = `Cone anchor top ${topRadius}`;
    const anchorId = await apply(
      await preview({
        kind: "point",
        name: anchorName,
        position: [center[0] + 6, center[1], center[2]],
      }),
    );
    const picks = [{ entityId, parameter: 0.25 }, { entityId: anchorId }];
    const independentLine = await line("pair", picks, center);
    assert.deepEqual(independentLine.definition.records[0].coordinates, [
      center[0],
      center[1],
      topRadius < 4 ? 32 : 28,
    ]);
    await cancel(independentLine);
    const beforeLine = new Set(
      (await call("project_get")).result.objects.map((row) => row.id),
    );
    dialog = await open("line");
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await ready(dialog);
    await choose(dialog, 0, "Two primitives");
    await choose(dialog, 1, name);
    await dialog.getByLabel("Source 1 fraction", { exact: true }).fill("0.25");
    await choose(dialog, 2, anchorName);
    await dialog.getByRole("button", { name: "Preview", exact: true }).click();
    await ready(dialog);
    const guiLine = (await call("reference_construction_get")).result;
    assert.deepEqual(
      guiLine.geometryEncoding,
      independentLine.geometryEncoding,
    );
    assert.deepEqual(
      guiLine.definitionEncoding,
      independentLine.definitionEncoding,
    );
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const pairId = (await call("project_get")).result.objects.find(
      (row) => !beforeLine.has(row.id),
    ).id;
    rows.push({
      entityId,
      name,
      input,
      centerId,
      pairId,
      surfaceKind,
      measured,
      guiMcpEqual: true,
    });
  }
  const source = rows[0],
    second = rows[1];
  await mutate("viewport_control", { action: "fit" });
  const average = await line(
    "average",
    [
      { entityId: source.entityId, parameter: 0.25 },
      { entityId: second.entityId, parameter: 0.75 },
      { entityId: source.entityId, parameter: 0.5 },
    ],
    source.input.center,
  );
  assert.deepEqual(
    average.definition.records.map((row) => row.entityId),
    [source.entityId, second.entityId, source.entityId],
  );
  assert.equal(average.diagnostics.contributingRecords, 3);
  await cancel(average);
  const beforeAverage = new Set(
    (await call("project_get")).result.objects.map((row) => row.id),
  );
  const averageDialog = await open("line");
  for (const [field, value] of [
    ["Start X", source.input.center[0]],
    ["Start Y", source.input.center[1]],
    ["Start Z", source.input.center[2] - 3],
    ["End X", source.input.center[0]],
    ["End Y", source.input.center[1]],
    ["End Z", source.input.center[2] + 3],
  ])
    await averageDialog.getByLabel(field, { exact: true }).fill(String(value));
  await averageDialog
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await ready(averageDialog);
  await choose(averageDialog, 0, "Average lines");
  await averageDialog
    .getByRole("button", { name: "Add source", exact: true })
    .click();
  for (const [index, row, parameter] of [
    [0, source, 0.25],
    [1, second, 0.75],
    [2, source, 0.5],
  ]) {
    await choose(averageDialog, index + 1, row.name);
    await averageDialog
      .getByLabel(`Source ${index + 1} fraction`, { exact: true })
      .fill(String(parameter));
  }
  await averageDialog
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await ready(averageDialog);
  const guiAverage = (await call("reference_construction_get")).result;
  assert.deepEqual(guiAverage.geometryEncoding, average.geometryEncoding);
  assert.deepEqual(guiAverage.definitionEncoding, average.definitionEncoding);
  await page.screenshot({
    path: fileURLToPath(new URL("cone-average-preview.png", artifactDir)),
  });
  await averageDialog
    .getByRole("button", { name: "Apply", exact: true })
    .click();
  await averageDialog.waitFor({ state: "detached" });
  const averageId = (await call("project_get")).result.objects.find(
    (row) => !beforeAverage.has(row.id),
  ).id;
  const followerId = await apply(
    await preview({
      kind: "point",
      mode: "center",
      sourceEntityIds: [averageId],
    }),
  );
  const retained = (await object(averageId)).reference.definitionEncoding;
  const pairRetained = (await object(source.pairId)).reference
    .definitionEncoding;
  const sourceKey = average.definition.sources.find(
    (row) => row.id === source.entityId,
  ).constructionOrderKey;
  assert.equal(typeof sourceKey, "string");
  const rebuilt = [];
  for (const topRadius of [4, 6, 2]) {
    const before = (await call("project_get")).result;
    const result = await job(
      await mutate("cad_rebuild", {
        entityId: source.entityId,
        recipe: { kind: "primitive", input: { ...source.input, topRadius } },
      }),
    );
    assert(result.refreshedEntityIds.includes(averageId));
    assert(result.refreshedEntityIds.includes(followerId));
    const after = (await call("project_get")).result;
    assert.equal(after.undo, before.undo + 1);
    assert.deepEqual(
      (await object(averageId)).reference.definitionEncoding,
      retained,
    );
    assert.deepEqual(
      (await object(source.pairId)).reference.definitionEncoding,
      pairRetained,
    );
    assert.deepEqual(
      (await object(source.centerId)).reference.geometry.position,
      source.input.center,
    );
    const sourceRow = (
      await call("reference_construction_sources", {
        kind: "line",
        mode: "average",
        limit: 100,
      })
    ).result.sources.find((row) => row.entityId === source.entityId);
    assert.equal(sourceRow.identityStatus, "saved");
    assert.equal(sourceRow.constructionOrderKey, sourceKey);
    const actualInput = (await object(source.entityId)).parametric.feature
      .recipe.input;
    assert.deepEqual(actualInput, { ...source.input, topRadius });
    await mutate("history_undo", {});
    assert.equal((await call("project_get")).result.redo, 1);
    await mutate("history_redo", {});
    assert.deepEqual(
      (await object(averageId)).reference.definitionEncoding,
      retained,
    );
    rebuilt.push(topRadius);
  }
  await mutate("object_update", {
    entityId: followerId,
    patch: { locked: true },
  });
  const lockedBefore = (await call("project_get")).result;
  const failedReceipt = await mutate("cad_rebuild", {
    entityId: source.entityId,
    recipe: { kind: "primitive", input: { ...source.input, topRadius: 1 } },
  });
  let failed;
  for (let attempt = 0; attempt < 120; attempt++) {
    failed = (await call("job_get", { jobId: failedReceipt.result.jobId }))
      .result;
    if (failed.status !== "running") break;
    await page.waitForTimeout(25);
  }
  assert.equal(failed.status, "failed");
  assert.match(failed.error.message, /locked/i);
  assert.deepEqual((await call("project_get")).result, lockedBefore);
  await mutate("object_update", {
    entityId: followerId,
    patch: { locked: false },
  });
  await mutate("viewport_control", { action: "fit" });
  await mutate("viewport_control", {
    action: "camera",
    position: [100, -80, 80],
    target: [34, 20, 30],
    up: [0, 0, 1],
    projection: "perspective",
    zoom: 1,
  });
  const view = (await call("viewport_get")).result;
  const camera = new PerspectiveCamera();
  camera.projectionMatrix.fromArray(view.projectionMatrix);
  camera.matrixWorld.fromArray(view.cameraWorldMatrix);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  for (const row of rows) {
    const clip = new Vector3(...row.input.center).project(camera);
    assert(
      Math.abs(clip.x) < 0.95 &&
        Math.abs(clip.y) < 0.95 &&
        clip.z > -1 &&
        clip.z < 1,
      "Every actual cone source must be inside the rendered camera frame",
    );
  }
  await page.screenshot({
    path: fileURLToPath(new URL("cone-radius-source-parity.png", artifactDir)),
  });
  // Preserve a real redo state through the generated project worker as well.
  await mutate("history_undo", {});
  const beforeReopen = (await call("project_get")).result;
  const beforeObjects = await Promise.all(
    [...rows.map((row) => row.entityId), averageId, followerId].map(object),
  );
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  const reopened = (await call("project_get")).result;
  assert.equal(reopened.undo, beforeReopen.undo);
  assert.equal(reopened.redo, beforeReopen.redo);
  for (const prior of beforeObjects) {
    const current = await object(prior.id);
    assert.deepEqual(
      current.reference?.definitionEncoding,
      prior.reference?.definitionEncoding,
    );
    assert.deepEqual(
      current.reference?.geometryEncoding,
      prior.reference?.geometryEncoding,
    );
    assert.deepEqual(
      current.parametric?.feature.recipe,
      prior.parametric?.feature.recipe,
    );
  }
  await mutate("history_redo", {});
  assert.deepEqual(
    (await object(averageId)).reference.definitionEncoding,
    retained,
  );
  const edit = await preview({
    entityId: averageId,
    kind: "line",
    mode: "average",
  });
  assert.deepEqual(edit.definitionEncoding, retained);
  await cancel(edit);
  ledger.coneSources = {
    rows,
    radiusOrderRebuilds: rebuilt,
    nativeHelperContractUnchanged: true,
    actualWorkerClassification: true,
    guiMcpPointAndPair: true,
    guiMcpWeightedAverage: true,
    repeatedAverageRecords: true,
    retainedF32Bits: true,
    lockedRollback: true,
    undoRedo: true,
    workerReopenWithFuture: true,
    nativeWholeConstructionAcceptance: false,
  };
  console.log(
    "Real-worker positive/equal/inverted cone GUI/public MCP sources, radius-order rebuild and history/reopen passed",
  );
}

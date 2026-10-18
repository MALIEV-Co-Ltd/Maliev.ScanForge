import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Current public GUI/MCP operations only; no state injection or worker replies.
export async function sketchHistoryScope({
  page,
  call,
  raw,
  mutate,
  tools,
  ledger,
  save,
  signal,
}) {
  for (const name of ["history_undo", "history_redo"]) {
    const tool = tools.find((item) => item.name === name);
    assert(tool, `Missing ${name}`);
    assert.deepEqual(tool.inputSchema.properties.scope.enum, [
      "model",
      "sketch",
    ]);
    assert.equal(tool.inputSchema.properties.scope.default, "model");
    assert(!tool.inputSchema.required.includes("scope"));
    assert.equal(tool.annotations?.readOnlyHint, false);
  }
  const state = async () => (await call("project_get")).result;
  const read = async () => (await call("sketch_get")).result;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  const eventually = async (verify) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      signal.throwIfAborted();
      try {
        await verify();
        return;
      } catch (error) {
        if (attempt === 79) throw error;
      }
      await pause();
    }
  };
  const waitJob = async (receipt) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      signal.throwIfAborted();
      const job = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      if (job.status !== "running") {
        assert.equal(job.status, "succeeded", JSON.stringify(job));
        return job.result;
      }
      await pause();
    }
    throw Error("Sketch history CAD fixture job exceeded12seconds");
  };
  const sketch = {
    version: 1,
    points: [
      { id: "p1", x: 0, y: 0 },
      { id: "p2", x: 20, y: 0 },
      { id: "p3", x: 20, y: 10 },
      { id: "p4", x: 0, y: 10 },
    ],
    segments: [
      { id: "s1", a: "p1", b: "p2" },
      { id: "s2", a: "p2", b: "p3" },
      { id: "s3", a: "p3", b: "p4" },
      { id: "s4", a: "p4", b: "p1" },
    ],
    constraints: [],
  };
  const translated = (value, dx) => ({
    ...structuredClone(value),
    points: value.points.map((point) => ({ ...point, x: point.x + dx })),
  });
  await mutate("project_new", {
    discard: true,
    name: "Sketch history scope fixture",
  });
  await waitJob(
    await mutate("cad_create", {
      name: "History scope seed",
      recipe: {
        kind: "extrude",
        profile: {
          kind: "polygon",
          points: [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
          ],
        },
        height: 2,
      },
    }),
  );
  const modelBefore = await state();
  const modelUnchanged = async () => {
    const next = await state();
    assert.deepEqual(next.objects, modelBefore.objects);
    assert.equal(next.undo, modelBefore.undo);
    assert.equal(next.redo, modelBefore.redo);
  };
  const aId = (
    await mutate("sketch_manage", {
      action: "create",
      name: "History A",
      sketch,
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
  const guiStep = async (repeat, expected) => {
    await panel
      .getByRole("button", {
        name: repeat ? "Redo sketch edit" : "Undo sketch edit",
        exact: true,
      })
      .click();
    await eventually(async () =>
      assert.deepEqual((await read()).sketch, expected),
    );
    await eventually(async () =>
      assert.equal((await call("session_get")).result.busy, false),
    );
  };
  assert.deepEqual((await mutate("history_undo", { scope: "sketch" })).result, {
    updated: false,
    scope: "sketch",
  });
  const a1 = translated(sketch, 3);
  await mutate("sketch_set", { sketch: a1 });
  const undoArgs = {
    scope: "sketch",
    expectedRevision: (await call("project_get")).revision,
    requestId: randomUUID(),
  };
  const undone = await call("history_undo", undoArgs);
  assert.deepEqual(undone.result, { updated: true, scope: "sketch" });
  assert.deepEqual((await read()).sketch, sketch);
  const afterUndo = await call("project_get");
  assert.deepEqual(await call("history_undo", undoArgs), undone);
  assert.equal((await call("project_get")).revision, afterUndo.revision);
  await guiStep(true, a1);
  await guiStep(false, sketch);
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await read()).sketch, a1);
  await modelUnchanged();
  const bId = (
    await mutate("sketch_manage", {
      action: "create",
      name: "History B",
      sketch,
    })
  ).result.sketchId;
  const b1 = translated(sketch, 6);
  await mutate("sketch_set", { sketch: b1 });
  await mutate("sketch_manage", { action: "activate", sketchId: aId });
  await mutate("history_undo", { scope: "sketch" });
  let current = await read();
  assert.deepEqual(current.sketch, sketch);
  assert.deepEqual(current.sketches.find((item) => item.id === bId).sketch, b1);
  await mutate("sketch_manage", { action: "activate", sketchId: bId });
  await guiStep(false, sketch);
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await read()).sketch, b1);
  await mutate("sketch_manage", { action: "delete", sketchId: bId });
  const legacy = await read();
  assert(!legacy.activeSketchId);
  const legacy1 = translated(legacy.sketch, 9);
  const staleRevision = (await call("project_get")).revision;
  await mutate("sketch_set", { sketch: legacy1 });
  const beforeRejected = await call("project_get");
  const rejected = await raw("history_undo", {
    scope: "sketch",
    expectedRevision: staleRevision,
    requestId: randomUUID(),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "REVISION_CONFLICT");
  assert.equal((await call("project_get")).revision, beforeRejected.revision);
  assert.deepEqual((await read()).sketch, legacy1);
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual((await read()).sketch, legacy.sketch);
  await guiStep(true, legacy1);
  await mutate("sketch_manage", { action: "activate", sketchId: aId });
  await guiStep(true, a1);
  await modelUnchanged();
  ledger.scenarios.push({
    name: "current-public-sketch-history-scope",
    exactRetryOnce: true,
    staleRevisionRejected: true,
    guiAndMcpUndoRedo: true,
    savedAndLegacyIsolated: true,
    modelHistoryPreserved: true,
  });
  await save();
  // Finish the current profile using the existing public GUI extrusion, then leave
  // the sketch workspace through ui_set. Current UI has no separate Finish tool.
  const beforeExtrusion = await state();
  await panel
    .getByRole("button", { name: "Extrude solved profile", exact: true })
    .click();
  await eventually(async () => {
    assert.equal((await call("session_get")).result.busy, false);
    const next = await state();
    assert.equal(next.objects.length, beforeExtrusion.objects.length + 1);
    assert.equal(next.undo, beforeExtrusion.undo + 1);
  });
  await mutate("ui_set", {
    workspace: "properties",
    ribbonTab: "main",
    toolPanelOpen: false,
  });
  const finished = await state();
  const authoringBeforeUndo = structuredClone(finished.authoring);
  await mutate("history_undo", {});
  const modelUndone = await state();
  assert.equal(modelUndone.undo, finished.undo - 1);
  assert.equal(modelUndone.redo, finished.redo + 1);
  assert.deepEqual(modelUndone.objects, beforeExtrusion.objects);
  assert.deepEqual(modelUndone.authoring, authoringBeforeUndo);
  await mutate("history_redo", { scope: "model" });
  assert.deepEqual((await state()).objects, finished.objects);
  assert.deepEqual((await state()).authoring, authoringBeforeUndo);
  ledger.scenarios.push({
    name: "one-model-undo-after-sketch-profile-finish",
    actualGuiExtrusion: true,
    publicWorkspaceExit: true,
    omittedScopeRemovesOneModelRevision: true,
    explicitModelRedo: true,
    sketchAuthoringPreserved: true,
    nativeParityClaim: false,
  });
  await save();
}

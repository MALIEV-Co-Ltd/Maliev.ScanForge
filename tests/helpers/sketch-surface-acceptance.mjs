import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { replayRealSketchSurface } from "./sketch-surface-real-browser.mjs";
import { assertSketchPlacement } from "./sketch-surface-placement.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const model = (project) => ({
  objects: project.objects.map(({ meshPreparation, ...item }) => item),
  undo: project.undo,
  redo: project.redo,
});

// Compare exact BREP payload bytes as well as the public display-buffer digests.
function savedBreps(bytes, entityIds) {
  assert.equal(bytes.subarray(0, 8).toString(), "SCANFRG2");
  const length = bytes.readUInt32LE(8);
  const manifest = JSON.parse(bytes.subarray(16, 16 + length).toString("utf8"));
  const records = manifest.current.map((index) => manifest.records[index]);
  return entityIds.map((entityId) => {
    const record = records.find((item) => item.id === entityId);
    assert(record?.brep, `Saved exact BREP missing for ${entityId}`);
    assert.equal(record.brep.type, "text");
    const chunk = manifest.chunks[record.brep.chunk];
    const stored = bytes.subarray(
      16 + length + chunk.offset,
      16 + length + chunk.offset + chunk.bytes,
    );
    const raw = chunk.codec === "gzip" ? gunzipSync(stored) : stored;
    assert.equal(raw.length, chunk.rawBytes);
    assert.equal(sha256(raw), chunk.sha256);
    return { entityId, bytes: raw.length, sha256: sha256(raw) };
  });
}

export async function completeSketchSurfaceAcceptance(context) {
  const {
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
    analyticFaceId,
  } = context;
  assert(
    process.env.SCANFORGE_M5_SKETCH_SCAN,
    "Full sketch-surface acceptance requires SCANFORGE_M5_SKETCH_SCAN; analytic-only success is incomplete",
  );
  const nativePath = process.env.SCANFORGE_M5_NATIVE_CIRCLE_STEP;
  assert(
    nativePath,
    "Full sketch-surface acceptance requires SCANFORGE_M5_NATIVE_CIRCLE_STEP",
  );
  const state = async () => (await call("project_get")).result;
  const authoring = async () => (await call("sketch_get")).result;
  const idle = () =>
    eventually(async () => {
      const session = (await call("session_get")).result;
      assert.equal(session.busy, false);
      assert.equal(session.activeJobId, null);
    });
  const inspect = async (entityId, expected = {}) => {
    const report = await job(
      await call("cad_inspect", {
        entityId,
        edgeOffset: 0,
        edgeLimit: 128,
      }),
    );
    assert.equal(report.valid, true, JSON.stringify(report));
    for (const key of ["faces", "solids", "edges"])
      if (expected[key] !== undefined) assert.equal(report[key], expected[key]);
    for (const key of ["areaMm2", "volumeMm3"])
      if (expected[key] !== undefined)
        assert(
          Math.abs(report[key] - expected[key]) <= 1e-7,
          JSON.stringify(report),
        );
    if (expected.sketch)
      report.placementProof = assertSketchPlacement(
        report,
        expected.sketch,
        expected.thickness ?? 0,
      );
    return report;
  };
  const onlyVisible = async (ids) => {
    for (const item of (await state()).objects)
      if (item.visible !== ids.includes(item.id))
        await mutate("object_update", {
          entityId: item.id,
          patch: { visible: ids.includes(item.id) },
        });
  };
  const upload = async (bytes, name) => {
    assert(
      bytes.length > 0 && bytes.length <= 64 * 1024 * 1024,
      "Replay file must fit the explicit 64 MiB fixture budget",
    );
    let artifactId;
    for (let offset = 0; offset < bytes.length; offset += 1048576)
      artifactId = (
        await call("artifact_put", {
          name,
          offset,
          ...(artifactId ? { artifactId } : {}),
          base64: bytes.subarray(offset, offset + 1048576).toString("base64"),
        })
      ).result.artifactId;
    return artifactId;
  };
  const added = async (before) =>
    eventually(async () => {
      const next = await state();
      const ids = new Set(before.objects.map((item) => item.id));
      const objects = next.objects.filter((item) => !ids.has(item.id));
      assert.equal(objects.length, 1, JSON.stringify(next));
      await idle();
      assert.equal(next.undo, before.undo + 1);
      return objects[0].id;
    });
  const panel = () =>
    page.getByRole("region", { name: "Surface from sketch", exact: true });
  const open = async (name = savedName) => {
    await page
      .getByRole("list", { name: "Sketch objects", exact: true })
      .getByRole("button", { name, exact: true })
      .click();
    assert.equal((await state()).selectedId, null);
    await page.getByRole("tab", { name: "Surfacing", exact: true }).click();
    const action = page.getByRole("button", {
      name: "From 2D sketch",
      exact: true,
    });
    assert(await action.isEnabled());
    const commands = (await call("command_get")).result;
    assert.equal(
      commands.commands.find((item) => item.name === "ribbon:surface2dSketch")
        ?.available,
      true,
    );
    await action.click();
    await panel().waitFor();
    return panel();
  };
  const close = async () => {
    await page
      .getByRole("button", { name: "Close tool options", exact: true })
      .click();
    await panel().waitFor({ state: "hidden" });
  };
  const createGui = async (target = panel()) => {
    const authored = await authoring(),
      before = await state();
    const oldJobs = new Set(
      (await call("session_get")).result.jobs.map((item) => item.jobId),
    );
    await target
      .getByRole("button", { name: "Create surface", exact: true })
      .click();
    const entityId = await added(before);
    const next = await state();
    assert.equal(
      next.selectedId,
      entityId,
      "Publishing output selection must not abort the source-owned job",
    );
    assert.deepEqual(
      await authoring(),
      authored,
      "Creation must not publish a solved authoring edit",
    );
    const jobs = (await call("session_get")).result.jobs.filter(
      (item) => !oldJobs.has(item.jobId) && item.command === "cad_create",
    );
    assert.equal(jobs.length, 1);
    const terminal = (await call("job_get", { jobId: jobs[0].jobId })).result;
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal));
    assert.deepEqual(terminal.result.entityIds, [entityId]);
    const object = (await call("object_get", { entityId })).result;
    assert(object.exactCad && object.hasBrep);
    assert.equal(object.parametric.feature.recipe.kind, "sketchSurface");
    assert.deepEqual(object.parametric.feature.recipe.sketch, authored.sketch);
    assert.equal(
      object.surfacePatch,
      undefined,
      "Analytic sketch faces have no NURBS control grid",
    );
    assert(object.name.trim().length > 0 && object.name.length <= 200);
    assert.equal(object.parametric.feature.name, object.name);
    return { entityId, object, authored, before, terminal };
  };
  const thickenGui = async (entityId, thickness) => {
    await mutate("object_select", { entityId });
    await page.getByRole("tab", { name: "Surfacing", exact: true }).click();
    const thicken = page.locator('button[data-command="surfaceThicken"]');
    assert.equal(
      await thicken.count(),
      1,
      "The active ribbon must expose one surfaceThicken command",
    );
    assert(await thicken.isEnabled());
    await thicken.click();
    const target = page.getByRole("region", {
      name: "Thicken surface",
      exact: true,
    });
    await target
      .getByRole("spinbutton", {
        name: "Signed wall thickness (mm)",
        exact: true,
      })
      .fill(String(thickness));
    const before = await state();
    await target
      .getByRole("button", { name: "Thicken surface", exact: true })
      .click();
    return added(before);
  };
  const stepRoundTrip = async (entityId, expected, label, gui = false) => {
    await onlyVisible([entityId]);
    let bytes, artifactId;
    if (gui) {
      const pending = page.waitForEvent("download");
      await page
        .locator(".header-actions")
        .getByRole("button", {
          name: "Export STEP",
          exact: true,
        })
        .click();
      const download = await pending;
      const path = new URL(`${label}.step`, out);
      await download.saveAs(fileURLToPath(path));
      bytes = await readFile(path);
      await idle();
      artifactId = await upload(bytes, `${label}.step`);
    } else {
      const artifact = await job(
        await call("project_export", { format: "step", cadOnly: true }),
      );
      bytes = await artifactBytes(artifact);
      artifactId = artifact.artifactId;
      await writeFile(new URL(`${label}.step`, out), bytes);
    }
    const before = await state();
    await job(
      await mutate("project_import", {
        artifactId,
        unit: "mm",
        placeAtOrigin: false,
      }),
    );
    const reopenedId = await added(before);
    const report = await inspect(reopenedId, expected);
    return { sha256: sha256(bytes), bytes: bytes.length, report };
  };
  const persist = async (entityIds, label) => {
    const authored = await authoring();
    const before = await state();
    const digests = [];
    for (const id of entityIds) digests.push(await geometryDigest(id));
    const artifact = await job(
      await call("project_export", { format: "project" }),
    );
    const bytes = await artifactBytes(artifact),
      breps = savedBreps(bytes, entityIds);
    const verify = async () => {
      await idle();
      const next = await state();
      assert.equal(next.undo, before.undo);
      assert.equal(next.redo, before.redo);
      assert.deepEqual(await authoring(), authored);
      for (let i = 0; i < entityIds.length; i++)
        assert.deepEqual(await geometryDigest(entityIds[i]), digests[i]);
      const resaved = await job(
        await call("project_export", { format: "project" }),
      );
      assert.deepEqual(
        savedBreps(await artifactBytes(resaved), entityIds),
        breps,
      );
    };
    const revision = (await call("session_get")).revision;
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .locator('input[type=file][accept*=".scanforge"]')
      .first()
      .setInputFiles({
        name: `${label}.scanforge`,
        mimeType: "application/octet-stream",
        buffer: bytes,
      });
    await eventually(async () =>
      assert((await call("session_get")).revision > revision),
    );
    await verify();
    await job(
      await mutate("project_import", {
        artifactId: artifact.artifactId,
        replace: true,
      }),
    );
    await verify();
    return {
      displayBuffersBitExact: true,
      exactBreps: breps,
      guiAndMcpReopen: true,
    };
  };

  const gui = await createGui();
  const afterGui = await state();
  const noGuiSketchUndo = await mutate("history_undo", { scope: "sketch" });
  assert.equal(
    noGuiSketchUndo.result.updated,
    false,
    "GUI creation must not publish an equal-content solved sketch history edit",
  );
  assert.deepEqual(model(await state()), model(afterGui));
  assert.deepEqual(await authoring(), gui.authored);
  assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
  const guiDigest = await geometryDigest(gui.entityId);
  assert.deepEqual(guiDigest, await geometryDigest(analyticFaceId));
  const guiReport = await inspect(gui.entityId, {
    faces: 1,
    solids: 0,
    edges: 2,
    areaMm2: 9 * Math.PI,
    sketch,
  });
  const beforeClone = await state();
  const clone = await job(
    await mutate("cad_create", {
      name: gui.object.name,
      recipe: { kind: "sketchSurface", sketch: structuredClone(sketch) },
      selectCreated: true,
    }),
  );
  const cloneId = clone.entityIds[0];
  assert.equal((await state()).undo, beforeClone.undo + 1);
  assert.equal((await state()).selectedId, cloneId);
  assert.deepEqual(await geometryDigest(cloneId), guiDigest);
  await inspect(cloneId, {
    faces: 1,
    solids: 0,
    edges: 2,
    areaMm2: 9 * Math.PI,
    sketch,
  });
  assert.deepEqual(await authoring(), gui.authored);
  await mutate("history_undo", { scope: "model" });
  assert(!(await state()).objects.some((item) => item.id === cloneId));
  await mutate("history_redo", { scope: "model" });
  assert.deepEqual(await geometryDigest(cloneId), guiDigest);
  await mutate("history_undo", { scope: "model" });

  // Saved-sketch edits are independent of the already-created embedded snapshot.
  const authoredEdit = structuredClone(sketch);
  authoredEdit.frame.origin[2] = 7;
  await mutate("sketch_set", { sketch: authoredEdit });
  assert.deepEqual(
    (await call("object_get", { entityId: gui.entityId })).result.parametric
      .feature.recipe.sketch,
    sketch,
  );
  assert.deepEqual(await geometryDigest(gui.entityId), guiDigest);
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual(await authoring(), gui.authored);
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await authoring()).sketch, authoredEdit);
  assert.deepEqual(await geometryDigest(gui.entityId), guiDigest);
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual(await authoring(), gui.authored);

  const solidId = await thickenGui(gui.entityId, 1.8);
  const solidDigest = await geometryDigest(solidId);
  const solidReport = await inspect(solidId, {
    solids: 1,
    volumeMm3: 50.89380098815465,
    sketch,
    thickness: 1.8,
  });
  const solidObject = (await call("object_get", { entityId: solidId })).result;
  assert.equal(solidObject.parametric.feature.recipe.kind, "thicken");
  assert.equal(
    solidObject.parametric.feature.recipe.source.featureId,
    gui.object.parametric.feature.id,
  );
  await mutate("history_undo", { scope: "model" });
  const mcpSolid = await job(
    await mutate("cad_create", {
      name: solidObject.name,
      recipe: {
        kind: "thicken",
        source: {
          featureId: gui.object.parametric.feature.id,
          output: gui.object.parametric.output,
        },
        thickness: 1.8,
      },
      selectCreated: true,
    }),
  );
  assert.deepEqual(await geometryDigest(mcpSolid.entityIds[0]), solidDigest);
  await inspect(mcpSolid.entityIds[0], {
    solids: 1,
    volumeMm3: 50.89380098815465,
    sketch,
    thickness: 1.8,
  });
  await mutate("history_undo", { scope: "model" });
  await mutate("history_redo", { scope: "model" });
  const dependentId = mcpSolid.entityIds[0];

  const edited = structuredClone(sketch);
  edited.frame = {
    origin: [8, 0, 0],
    u: [0, 1, 0],
    v: [0, 0, 1],
    normal: [1, 0, 0],
  };
  const recipe = { kind: "sketchSurface", sketch: edited };
  await mutate("object_select", { entityId: gui.entityId });
  await mutate("ui_set", { workspace: "properties", toolPanelOpen: true });
  const rebuildPanel = page.getByRole("region", {
    name: "Parametric rebuild",
    exact: true,
  });
  await rebuildPanel
    .getByRole("textbox", { name: "Parametric feature recipe", exact: true })
    .fill(JSON.stringify(recipe));
  const rebuildBefore = await state(),
    authoredBeforeRebuild = await authoring();
  await rebuildPanel
    .getByRole("button", {
      name: "Rebuild feature and dependents",
      exact: true,
    })
    .click();
  await eventually(async () => {
    assert.equal((await state()).undo, rebuildBefore.undo + 1);
    assert.deepEqual(
      (await call("object_get", { entityId: gui.entityId })).result.parametric
        .feature.recipe,
      recipe,
    );
  });
  await idle();
  const rebuiltFaceDigest = await geometryDigest(gui.entityId);
  const rebuiltSolidDigest = await geometryDigest(dependentId);
  assert.notDeepEqual(rebuiltFaceDigest, guiDigest);
  assert.notDeepEqual(rebuiltSolidDigest, solidDigest);
  await inspect(gui.entityId, {
    faces: 1,
    solids: 0,
    areaMm2: 9 * Math.PI,
    sketch: edited,
  });
  await inspect(dependentId, {
    solids: 1,
    volumeMm3: 50.89380098815465,
    sketch: edited,
    thickness: 1.8,
  });
  assert.deepEqual(await authoring(), authoredBeforeRebuild);
  await mutate("history_undo", { scope: "model" });
  assert.deepEqual(await geometryDigest(gui.entityId), guiDigest);
  assert.deepEqual(await geometryDigest(dependentId), solidDigest);
  const rebuilt = await job(
    await mutate("cad_rebuild", { entityId: gui.entityId, recipe }),
  );
  assert.equal((await state()).undo, rebuildBefore.undo + 1);
  assert.deepEqual(await authoring(), authoredBeforeRebuild);
  assert(rebuilt.rebuiltFeatureIds.includes(gui.object.parametric.feature.id));
  assert(
    rebuilt.rebuiltFeatureIds.includes(
      (
        await call("object_get", {
          entityId: dependentId,
        })
      ).result.parametric.feature.id,
    ),
  );
  assert.deepEqual(await geometryDigest(gui.entityId), rebuiltFaceDigest);
  assert.deepEqual(await geometryDigest(dependentId), rebuiltSolidDigest);
  await inspect(gui.entityId, {
    faces: 1,
    solids: 0,
    areaMm2: 9 * Math.PI,
    sketch: edited,
  });
  await inspect(dependentId, {
    solids: 1,
    volumeMm3: 50.89380098815465,
    sketch: edited,
    thickness: 1.8,
  });
  await mutate("history_undo", { scope: "model" });
  await mutate("history_redo", { scope: "model" });
  assert.deepEqual(await geometryDigest(dependentId), rebuiltSolidDigest);
  await mutate("history_undo", { scope: "model" });

  const failures = [];
  for (const kind of ["constraint", "open-profile"]) {
    const invalid = structuredClone(sketch);
    if (kind === "constraint")
      invalid.constraints.push({
        id: "conflicting-center",
        kind: "fixed",
        point: "circle-center",
        x: sketch.points[2].x + 1,
        y: sketch.points[2].y,
      });
    else invalid.arcs.pop();
    await mutate("sketch_set", { sketch: invalid });
    const target = await open();
    const before = await call("project_get"),
      authoredBefore = await authoring();
    await target
      .getByRole("button", { name: "Create surface", exact: true })
      .click();
    const error = page.locator(".error-banner");
    await error.waitFor();
    const guiMessage = await error.textContent();
    await idle();
    const pending = await mutate("cad_create", {
      name: "Rejected sketch surface",
      recipe: { kind: "sketchSurface", sketch: invalid },
    });
    const failed = await eventually(async () => {
      const terminal = (await call("job_get", { jobId: pending.result.jobId }))
        .result;
      assert.equal(terminal.status, "failed", JSON.stringify(terminal));
      return terminal;
    });
    assert(guiMessage.includes(failed.error.message), guiMessage);
    const after = await call("project_get");
    assert.equal(after.revision, before.revision);
    assert.deepEqual(model(after.result), model(before.result));
    assert.deepEqual(await authoring(), authoredBefore);
    failures.push({ kind, message: failed.error.message });
    await close();
    await mutate("ui_set", { dismissError: true });
    await mutate("sketch_set", { sketch });
  }

  const cancelTarget = await open();
  const beforeCancel = await call("project_get"),
    authoredBeforeCancel = await authoring();
  const oldJobs = new Set(
    (await call("session_get")).result.jobs.map((item) => item.jobId),
  );
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    const hold = {
      send,
      holding: true,
      held: [],
      created: [],
      released: [],
      releaseAcknowledgements: [],
      listeners: [],
    };
    window.__m5SketchSurfaceHold = hold;
    Worker.prototype.postMessage = function (...args) {
      if (hold.holding && args[0]?.operation === "sketchSurface") {
        const id = args[0].id;
        const listener = (event) => {
          if (event.data?.id === id && event.data.result?.kernelId)
            hold.created.push(event.data.result.kernelId);
        };
        this.addEventListener("message", listener);
        hold.listeners.push([this, listener]);
        hold.held.push(() => send.apply(this, args));
        return;
      }
      if (args[0]?.operation === "release") {
        const requestId = args[0].id,
          kernelIds = [...args[0].payload];
        hold.released.push(...kernelIds);
        const listener = (event) => {
          if (
            event.data?.id === requestId &&
            event.data.result === true &&
            !event.data.error
          )
            hold.releaseAcknowledgements.push({
              requestId,
              kernelIds,
              result: true,
            });
        };
        this.addEventListener("message", listener);
        hold.listeners.push([this, listener]);
      }
      return send.apply(this, args);
    };
  });
  let cancellation;
  try {
    await cancelTarget
      .getByRole("button", { name: "Create surface", exact: true })
      .click();
    await eventually(async () =>
      assert.equal(
        await page.evaluate(() => window.__m5SketchSurfaceHold.held.length),
        1,
      ),
    );
    const cancel = page.getByRole("button", {
      name: "Cancel sketch surface",
      exact: true,
    });
    assert(
      await cancel.isEnabled(),
      "Owned cancel must remain reachable outside the busy inspector",
    );
    await cancel.click();
    await page.evaluate(() => {
      const hold = window.__m5SketchSurfaceHold;
      hold.holding = false;
      hold.held.splice(0).forEach((send) => send());
    });
    await eventually(async () => {
      const jobs = (await call("session_get")).result.jobs.filter(
        (item) => !oldJobs.has(item.jobId) && item.command === "cad_create",
      );
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].status, "cancelled", JSON.stringify(jobs));
    });
    await idle();
    cancellation = await eventually(async () => {
      const proof = await page.evaluate(() => ({
        created: window.__m5SketchSurfaceHold.created,
        released: window.__m5SketchSurfaceHold.released,
        releaseAcknowledgements:
          window.__m5SketchSurfaceHold.releaseAcknowledgements,
      }));
      assert.equal(proof.created.length, 1);
      assert(proof.released.includes(proof.created[0]), JSON.stringify(proof));
      assert(
        proof.releaseAcknowledgements.some(
          (ack) =>
            ack.result === true && ack.kernelIds.includes(proof.created[0]),
        ),
        `Late native handle requires a matching successful release response: ${JSON.stringify(proof)}`,
      );
      return proof;
    });
    assert.deepEqual(
      model((await call("project_get")).result),
      model(beforeCancel.result),
    );
    assert.equal((await call("project_get")).revision, beforeCancel.revision);
    assert.deepEqual(await authoring(), authoredBeforeCancel);
  } finally {
    await page.evaluate(() => {
      const hold = window.__m5SketchSurfaceHold;
      if (!hold) return;
      Worker.prototype.postMessage = hold.send;
      hold.held.splice(0).forEach((send) => send());
      for (const [worker, listener] of hold.listeners)
        worker.removeEventListener("message", listener);
      delete window.__m5SketchSurfaceHold;
    });
  }
  await mutate("ui_set", { dismissError: true });
  // Transform consumes the retained live source handle after cancellation.
  const retained = await job(
    await mutate("cad_create", {
      name: "Live sketch-face handle after cancellation",
      recipe: {
        kind: "transform",
        source: {
          featureId: gui.object.parametric.feature.id,
          output: gui.object.parametric.output,
        },
        translation: [0, 0, 1],
        rotation: [0, 0, 0],
        scale: 1,
      },
    }),
  );
  await inspect(retained.entityIds[0], {
    faces: 1,
    solids: 0,
    areaMm2: 9 * Math.PI,
    sketch: {
      ...sketch,
      frame: {
        ...sketch.frame,
        origin: sketch.frame.origin.map((n, axis) => n + [0, 0, 1][axis]),
      },
    },
  });
  await mutate("history_undo", { scope: "model" });
  assert.deepEqual(await geometryDigest(gui.entityId), guiDigest);
  assert.deepEqual(await geometryDigest(sourceId), sourceDigest);

  // Closing idle tools and switching a source in an open panel must not retain a stale snapshot.
  await open();
  const closeBefore = model(await state());
  await close();
  assert.deepEqual(model(await state()), closeBefore);
  const switchedSketch = structuredClone(sketch);
  switchedSketch.frame.origin[2] = 9;
  const switched = await mutate("sketch_manage", {
    action: "create",
    name: "Switched sketch surface source",
    sketch: switchedSketch,
  });
  await mutate("sketch_manage", { action: "activate", sketchId });
  await open();
  await panel().waitFor();
  assert.deepEqual((await authoring()).sketch, sketch);
  await page
    .getByRole("list", { name: "Sketch objects", exact: true })
    .getByRole("button", {
      name: "Switched sketch surface source",
      exact: true,
    })
    .click();
  await eventually(async () => {
    assert.equal((await authoring()).activeSketchId, switched.result.sketchId);
    assert.equal((await state()).selectedId, null);
    assert(
      await panel().isVisible(),
      "The open sketch-surface panel must follow the replacement saved source",
    );
  });
  const switchedGui = await createGui();
  assert.deepEqual(
    switchedGui.object.parametric.feature.recipe.sketch,
    switchedSketch,
  );
  assert.equal((await authoring()).activeSketchId, switched.result.sketchId);
  await inspect(switchedGui.entityId, {
    faces: 1,
    solids: 0,
    areaMm2: 9 * Math.PI,
    sketch: switchedSketch,
  });
  await mutate("history_undo", { scope: "model" });
  await mutate("sketch_manage", { action: "activate", sketchId });
  assert.deepEqual((await authoring()).sketch, sketch);

  await mutate("sketch_manage", {
    action: "create",
    name: "Empty sketch surface admission",
    sketch: {
      version: 1,
      points: [],
      segments: [],
      constraints: [],
      frame: sketch.frame,
    },
  });
  await page.getByRole("tab", { name: "Surfacing", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "From 2D sketch", exact: true })
      .isEnabled(),
    false,
  );
  assert.equal(
    (await call("command_get")).result.commands.find(
      (item) => item.name === "ribbon:surface2dSketch",
    )?.available,
    false,
  );
  await mutate("sketch_manage", { action: "activate", sketchId });

  // Repeat discovery uses the same saved-sketch admission and creates no model edit.
  await open();
  await close();
  const commands = (await call("command_get")).result;
  assert.equal(commands.lastCommand, "ribbon:surface2dSketch");
  assert.equal(commands.canRepeat, true);
  const repeatBefore = model(await state());
  await mutate("command_repeat", {});
  await panel().waitFor();
  assert.deepEqual(model(await state()), repeatBefore);
  await close();
  const persistence = await persist(
    [gui.entityId, dependentId],
    "sketch-surface-analytic",
  );
  const faceStep = await stepRoundTrip(
    gui.entityId,
    {
      faces: 1,
      solids: 0,
      edges: 2,
      areaMm2: 9 * Math.PI,
      sketch,
    },
    "sketch-surface-face-mcp",
  );
  assert(
    faceStep.report.edgeReferences.items.every(
      (edge) => edge.kind === "circle",
    ),
  );
  const solidStep = await stepRoundTrip(
    dependentId,
    {
      solids: 1,
      volumeMm3: 50.89380098815465,
      sketch,
      thickness: 1.8,
    },
    "sketch-surface-solid-gui",
    true,
  );

  let nativeCircle;
  {
    const bytes = await readFile(nativePath);
    assert.equal(bytes.length, 11714);
    assert.equal(
      sha256(bytes),
      "acc7522d082692299a49b6cb288bb94185349c6cf537610de5beac567c534cae",
    );
    const before = await state();
    await job(
      await mutate("project_import", {
        artifactId: await upload(bytes, basename(nativePath)),
        unit: "mm",
        placeAtOrigin: false,
      }),
    );
    const nativeId = await added(before);
    const report = await inspect(nativeId, {
      solids: 1,
      volumeMm3: 50.89380098815465,
    });
    const bounds = (report) => {
      assert.equal(report.edgeReferences.nextOffset, null);
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (const edge of report.edgeReferences.items) {
        assert(edge.boundsMm);
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], edge.boundsMm.min[axis]);
          max[axis] = Math.max(max[axis], edge.boundsMm.max[axis]);
        }
      }
      return { min, max };
    };
    const nativeBounds = bounds(report),
      applicationBounds = bounds(solidReport);
    for (const key of ["min", "max"])
      for (let axis = 0; axis < 3; axis++)
        assert(
          Math.abs(nativeBounds[key][axis] - applicationBounds[key][axis]) <=
            1e-6,
        );
    assert(Math.abs(nativeBounds.min[2] - 5) <= 1e-6);
    assert(Math.abs(nativeBounds.max[2] - 6.8) <= 1e-6);
    assert(Math.abs(report.volumeMm3 - solidReport.volumeMm3) <= 1e-7);
    assert.equal(sha256(await readFile(nativePath)), sha256(bytes));
    nativeCircle = {
      supplied: true,
      sha256: sha256(bytes),
      bytes: bytes.length,
      report,
      applicationReport: solidReport,
      nativeBounds,
      applicationBounds,
      volumeToleranceMm3: 1e-7,
      boundsToleranceMm: 1e-6,
      scope:
        "Geometric comparison to actual native extrusion; no BREP identity or native Thicken equivalence claim",
    };
  }
  ledger.scenarios.push({
    sketchSurfaceGuiMcp: {
      defaultName: gui.object.name,
      guiReport,
      solidReport,
      guiMcpRawGeometryEqual: true,
      oneModelEditAndNoAuthoringEdit: true,
      noEqualContentGuiSketchHistoryEdit:
        noGuiSketchUndo.result.updated === false,
      outputSelectionSurvivesPublication: true,
      savedSketchSnapshotIndependent: true,
      guiMcpDependentRebuildEqual: true,
      modelAndSketchUndoRedo: true,
      failures,
      ownedCancellationLateRelease: cancellation,
      retainedNativeSourceHandle: true,
      repeatUsesSavedSketchAdmission: true,
      idlePanelCloseAndSavedSourceSwitch: true,
      idleInPlaceSavedSourceSwitch: true,
      emptySketchGuiAndCommandAdmissionRejected: true,
      busySourceChangeScope:
        "Public edits and source tree are blocked while busy; no private state injection or claim of a forced busy-source-change race",
      persistence,
      faceStep,
      solidStep,
      nativeCircle,
    },
  });
  await writeFile(
    new URL("sketch-surface-gui-mcp.json", out),
    JSON.stringify(ledger.scenarios.at(-1), null, 2),
  );
  await replayRealSketchSurface({
    ...context,
    state,
    authoring,
    idle,
    inspect,
    onlyVisible,
    upload,
    added,
    open,
    createGui,
    thickenGui,
    stepRoundTrip,
    persist,
  });
  assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
}

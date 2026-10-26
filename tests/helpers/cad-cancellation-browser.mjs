import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { assertSketchPlacement } from "./sketch-surface-placement.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const core = (project) => ({
  objects: project.objects.map(({ meshPreparation, ...object }) => object),
  authoring: project.authoring,
  selectedId: project.selectedId,
  selectedIds: project.selectedIds,
  selectionAnchorId: project.selectionAnchorId,
  undo: project.undo,
  redo: project.redo,
});
function brepDigests(bytes, ids) {
  assert.equal(bytes.subarray(0, 8).toString(), "SCANFRG2");
  const length = bytes.readUInt32LE(8);
  const manifest = JSON.parse(bytes.subarray(16, 16 + length).toString("utf8"));
  const records = manifest.current.map((index) => manifest.records[index]);
  return ids.map((entityId) => {
    const record = records.find((item) => item.id === entityId);
    assert.equal(record?.brep?.type, "text");
    const chunk = manifest.chunks[record.brep.chunk];
    const stored = bytes.subarray(
      16 + length + chunk.offset,
      16 + length + chunk.offset + chunk.bytes,
    );
    const raw = chunk.codec === "gzip" ? gunzipSync(stored) : stored;
    assert.equal(raw.length, chunk.rawBytes);
    assert.equal(hash(raw), chunk.sha256);
    return { entityId, bytes: raw.length, sha256: chunk.sha256 };
  });
}

export async function replayCadCancellation({
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
  const points = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ];
  const recipe = (height) => ({
    kind: "loft",
    ruled: true,
    profiles: [
      { z: 2, points },
      { z: 2 + height, points },
    ],
  });
  const placedSketch = {
    version: 1,
    frame: { origin: [0, 0, 2], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
    points: points.map(([x, y], index) => ({ id: `p${index}`, x, y })),
    segments: points.map((_, index) => ({
      id: `s${index}`,
      a: `p${index}`,
      b: `p${(index + 1) % 4}`,
    })),
    constraints: [],
  };
  const state = async () => call("project_get");
  const idle = async () =>
    eventually(async () => {
      const session = (await call("session_get")).result;
      assert.equal(session.busy, false);
      assert.equal(session.activeJobId, null);
    });
  const terminal = async (jobId, status) =>
    eventually(async () => {
      const current = (await call("job_get", { jobId })).result;
      if (status) assert.equal(current.status, status, JSON.stringify(current));
      else assert.notEqual(current.status, "running", JSON.stringify(current));
      return current;
    });
  const savedBreps = async (ids) => {
    if (!ids.length) return [];
    return brepDigests(
      await artifactBytes(
        await job(
          await call("project_export", {
            format: "project",
          }),
        ),
      ),
      ids,
    );
  };
  const capture = async (sources) => {
    await idle();
    const project = await state(),
      digests = [];
    for (const id of sources) digests.push(await geometryDigest(id));
    const exactIds = project.result.objects
      .filter((item) => item.exactCad && item.hasBrep)
      .map((item) => item.id);
    const breps = await savedBreps(exactIds);
    assert.deepEqual(core((await state()).result), core(project.result));
    return { project, sources, digests, exactIds, breps };
  };
  const preserved = async (before) => {
    const after = await state();
    assert.equal(after.revision, before.project.revision);
    assert.deepEqual(core(after.result), core(before.project.result));
    for (let i = 0; i < before.sources.length; i++)
      assert.deepEqual(
        await geometryDigest(before.sources[i]),
        before.digests[i],
      );
    assert.deepEqual(await savedBreps(before.exactIds), before.breps);
  };
  const inspect = async (entityId, height, translation = [0, 0, 0]) => {
    const report = await job(
      await call("cad_inspect", {
        entityId,
        edgeOffset: 0,
        edgeLimit: 128,
      }),
    );
    assert(
      report.valid && report.solids === 1 && report.signedVolumeMm3 > 0,
      JSON.stringify(report),
    );
    assert(
      Math.abs(report.volumeMm3 - 12 * height) <= 1e-6,
      JSON.stringify(report),
    );
    const frame = {
      ...placedSketch.frame,
      origin: placedSketch.frame.origin.map((n, axis) => n + translation[axis]),
    };
    return {
      report,
      placement: assertSketchPlacement(
        report,
        { ...placedSketch, frame },
        height,
      ),
    };
  };
  const newGuiJob = async (oldJobs, command) =>
    eventually(async () => {
      const jobs = (await call("session_get")).result.jobs.filter(
        (item) => !oldJobs.has(item.jobId) && item.command === command,
      );
      assert.equal(jobs.length, 1, JSON.stringify(jobs));
      return jobs[0].jobId;
    });
  const added = async (before) =>
    eventually(async () => {
      const after = (await state()).result;
      const objects = after.objects.filter(
        (item) => !before.result.objects.some((old) => old.id === item.id),
      );
      assert.equal(objects.length, 1);
      assert.equal(after.undo, before.result.undo + 1);
      await idle();
      assert.equal(after.selectedId, objects[0].id);
      return objects[0].id;
    });
  const openLoft = async (nextRecipe) => {
    await page.getByRole("tab", { name: "Surfacing", exact: true }).click();
    const command = (await call("command_get")).result.commands.find(
      (item) => item.name === "ribbon:loft",
    );
    assert.equal(command?.available, true);
    const action = page.locator('button[data-command="loft"]');
    assert.equal(await action.count(), 1);
    assert(await action.isEnabled());
    await action.click();
    const panel = page.getByRole("region", { name: "Loft", exact: true });
    await panel
      .getByRole("textbox", { name: "Loft profiles", exact: true })
      .fill(JSON.stringify(nextRecipe.profiles));
    await panel
      .getByRole("checkbox", { name: "Ruled sides", exact: true })
      .setChecked(nextRecipe.ruled);
    return () =>
      panel
        .getByRole("button", { name: "Create exact loft", exact: true })
        .click();
  };
  const openRebuild = async (entityId, nextRecipe) => {
    await mutate("object_select", { entityId });
    await mutate("ui_set", {
      workspace: "properties",
      toolPanelOpen: true,
      dismissError: true,
    });
    const panel = page.getByRole("region", {
      name: "Parametric rebuild",
      exact: true,
    });
    await panel
      .getByRole("textbox", { name: "Parametric feature recipe", exact: true })
      .fill(JSON.stringify(nextRecipe));
    return () =>
      panel
        .getByRole("button", {
          name: "Rebuild feature and dependents",
          exact: true,
        })
        .click();
  };

  async function cancelHeld(command, start, label, sources) {
    const before = await capture(sources);
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
        releaseAcknowledgements: [],
        listeners: [],
      };
      window.__m5CadCancellationHold = hold;
      Worker.prototype.postMessage = function (...args) {
        const request = args[0];
        if (["loft", "transform"].includes(request?.operation)) {
          const listener = (event) => {
            if (event.data?.id === request.id && event.data.result?.kernelId)
              hold.created.push({
                requestId: request.id,
                operation: request.operation,
                kernelId: event.data.result.kernelId,
              });
          };
          this.addEventListener("message", listener);
          hold.listeners.push([this, listener]);
        }
        if (request?.operation === "release") {
          const kernelIds = [...request.payload];
          const listener = (event) => {
            if (
              event.data?.id === request.id &&
              event.data.result === true &&
              !event.data.error
            )
              hold.releaseAcknowledgements.push({
                requestId: request.id,
                kernelIds,
                result: true,
              });
          };
          this.addEventListener("message", listener);
          hold.listeners.push([this, listener]);
        }
        if (hold.holding && request?.operation === "loft") {
          hold.held.push(() => send.apply(this, args));
          return;
        }
        return send.apply(this, args);
      };
    });
    const flush = () =>
      page.evaluate(() => {
        const hold = window.__m5CadCancellationHold;
        hold.holding = false;
        hold.held.splice(0).forEach((send) => send());
      });
    const released = async () =>
      eventually(async () => {
        const result = await page.evaluate(() => ({
          created: window.__m5CadCancellationHold.created,
          releaseAcknowledgements:
            window.__m5CadCancellationHold.releaseAcknowledgements,
        }));
        assert.equal(
          result.created.filter((item) => item.operation === "loft").length,
          1,
        );
        for (const created of result.created)
          assert(
            result.releaseAcknowledgements.some(
              (ack) =>
                ack.result === true && ack.kernelIds.includes(created.kernelId),
            ),
            JSON.stringify(result),
          );
        return result;
      });
    let jobId, failure;
    try {
      await start();
      await eventually(async () =>
        assert.equal(
          await page.evaluate(() => window.__m5CadCancellationHold.held.length),
          1,
        ),
      );
      jobId = await newGuiJob(oldJobs, command);
      const session = (await call("session_get")).result;
      assert.equal(session.busy, true);
      assert.equal(session.activeJobId, jobId);
      const cancel = page.getByRole("button", {
        name: "Cancel CAD operation",
        exact: true,
      });
      const admission = {
        command,
        jobId,
        heldWorkerOperation: "loft",
        ownedCancelButtons: await cancel.count(),
        sourceEntityIds: sources,
        scope:
          "GUI job admission observation; cancellation and cleanup assertions follow",
      };
      ledger.scenarios.push({ genericCadCancellationAdmission: admission });
      await writeFile(
        new URL(`cad-${label}-cancellation-admission.json`, out),
        JSON.stringify(admission, null, 2),
      );
      await page.screenshot({
        path: fileURLToPath(new URL(`cad-${label}-cancellation-held.png`, out)),
      });
      // Intended initial RED: generic App CAD jobs have no owned cancel portal.
      assert.equal(
        admission.ownedCancelButtons,
        1,
        `GUI-started ${command} must expose one reachable owned Cancel CAD operation button`,
      );
      assert(
        await cancel.isEnabled(),
        "Owned CAD cancellation must remain outside the inert inspector",
      );
      await cancel.click();
      await flush();
      await terminal(jobId, "cancelled");
      await idle();
      const proof = await released();
      await preserved(before);
      return {
        command,
        jobId,
        proof,
        modelAndAuthoringUnchanged: true,
        sourceBuffersAndStoredBrepsUnchanged: true,
      };
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      const cleanupErrors = [];
      // RED cleanup uses existing public MCP cancellation; it is not a GUI recovery pass.
      try {
        jobId ??= await newGuiJob(oldJobs, command);
        if ((await call("job_get", { jobId })).result.status === "running") {
          await call("job_cancel", { jobId });
          ledger.cleanup.push({
            kind: "cad-cancellation-test-cleanup",
            jobId,
            scope: "Public MCP cancellation of this helper's held GUI job",
          });
        }
      } catch (error) {
        cleanupErrors.push(error.message);
      }
      try {
        await flush();
      } catch (error) {
        cleanupErrors.push(error.message);
      }
      try {
        if (jobId) await terminal(jobId);
        await idle();
        if (failure && jobId) {
          await terminal(jobId, "cancelled");
          const proof = await released();
          await preserved(before);
          ledger.cleanup.push({
            kind: "cad-cancellation-red-cleanup-proof",
            jobId,
            proof,
            sourcesAndHistoryPreserved: true,
            scope:
              "Test cleanup through existing MCP job_cancel, not a GUI owned-cancel pass",
          });
        }
      } catch (error) {
        cleanupErrors.push(error.message);
      }
      try {
        await page.evaluate(() => {
          const hold = window.__m5CadCancellationHold;
          if (!hold) return;
          Worker.prototype.postMessage = hold.send;
          hold.held.splice(0).forEach((send) => send());
          for (const [worker, listener] of hold.listeners)
            worker.removeEventListener("message", listener);
          delete window.__m5CadCancellationHold;
        });
      } catch (error) {
        cleanupErrors.push(error.message);
      }
      if (cleanupErrors.length) {
        ledger.cleanup.push({
          kind: "cad-cancellation-hook-cleanup",
          errors: cleanupErrors,
        });
        if (!failure) throw Error(cleanupErrors.join("; "));
      }
    }
  }

  const initialDigest = await geometryDigest(sourceId);
  const createRecipe = recipe(7);
  const startCreate = await openLoft(createRecipe);
  const creation = await cancelHeld("cad_create", startCreate, "create", [
    sourceId,
  ]);
  await mutate("ui_set", { dismissError: true });
  const retryCreate = await openLoft(createRecipe);
  const beforeCreate = await state();
  const oldCreateJobs = new Set(
    (await call("session_get")).result.jobs.map((item) => item.jobId),
  );
  await retryCreate();
  const entityId = await added(beforeCreate);
  const createJobId = await newGuiJob(oldCreateJobs, "cad_create");
  await terminal(createJobId, "succeeded");
  const object = (await call("object_get", { entityId })).result;
  assert.deepEqual(object.parametric.feature.recipe, createRecipe);
  const createRecovery = await inspect(entityId, 7);
  const dependent = await job(
    await mutate("cad_create", {
      name: "Cancellation retained loft dependent",
      recipe: {
        kind: "transform",
        source: { featureId: object.parametric.feature.id, output: 0 },
        translation: [10, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
      },
    }),
  );
  const dependentId = dependent.entityIds[0];
  await inspect(dependentId, 7, [10, 0, 0]);
  const rebuiltRecipe = recipe(9);
  const startRebuild = await openRebuild(entityId, rebuiltRecipe);
  const rebuild = await cancelHeld("cad_rebuild", startRebuild, "rebuild", [
    sourceId,
    entityId,
    dependentId,
  ]);
  await mutate("ui_set", { dismissError: true });
  // Consumes the retained native source handle, rather than rebuilding its original loft.
  const live = await job(
    await mutate("cad_create", {
      name: "Live original loft after rebuild cancellation",
      recipe: {
        kind: "transform",
        source: { featureId: object.parametric.feature.id, output: 0 },
        translation: [0, 0, 1],
        rotation: [0, 0, 0],
        scale: 1,
      },
    }),
  );
  await inspect(live.entityIds[0], 7, [0, 0, 1]);
  await mutate("history_undo", { scope: "model" });
  const retryRebuild = await openRebuild(entityId, rebuiltRecipe);
  const beforeRebuild = await state();
  const oldRebuildJobs = new Set(
    (await call("session_get")).result.jobs.map((item) => item.jobId),
  );
  await retryRebuild();
  const rebuildJobId = await newGuiJob(oldRebuildJobs, "cad_rebuild");
  await terminal(rebuildJobId, "succeeded");
  await idle();
  assert.equal((await state()).result.undo, beforeRebuild.result.undo + 1);
  assert.deepEqual(
    (await call("object_get", { entityId })).result.parametric.feature.recipe,
    rebuiltRecipe,
  );
  assert.deepEqual(
    (await state()).result.authoring,
    beforeRebuild.result.authoring,
  );
  const rebuildRecovery = await inspect(entityId, 9);
  const dependentRecovery = await inspect(dependentId, 9, [10, 0, 0]);
  assert.deepEqual(await geometryDigest(sourceId), initialDigest);
  const result = {
    creation,
    rebuild,
    createRecovery,
    rebuildRecovery,
    dependentRecovery,
    normalOutputSelectionSucceeded: true,
    retainedNativeHandleAfterCancellation: true,
    scope:
      "Actual GUI generic CAD create/rebuild cancellation and recovery via shared application jobs; no native application equivalence claim",
  };
  ledger.scenarios.push({ genericCadCancellation: result });
  await writeFile(
    new URL("cad-cancellation.json", out),
    JSON.stringify(result, null, 2),
  );
}

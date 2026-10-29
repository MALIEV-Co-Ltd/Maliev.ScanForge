import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function replaySurfaceBlend({
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
  realPatch,
}) {
  const patch = (offset = 0, rows = 4) => ({
    format: "scanforge-nurbs",
    version: 1,
    countU: 4,
    countV: rows,
    degreeU: 3,
    degreeV: 3,
    knotsU: [0, 0, 0, 0, 1, 1, 1, 1],
    knotsV:
      rows === 4 ? [0, 0, 0, 0, 1, 1, 1, 1] : [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
    weights: Array.from({ length: 4 * rows }, (_, i) =>
      rows === 4 ? [1, 2, 2, 1][Math.floor(i / 4)] : 1,
    ),
    points: Array.from({ length: 4 * rows }, (_, i) => [
      ((i % 4) * 10) / 3 + offset,
      (Math.floor(i / 4) * 10) / (rows - 1),
      0,
    ]),
  });
  const reference = patch(),
    target = patch(18),
    incompatible = patch(0, 5);
  const options = (continuity) => ({
    referenceEdge: "u1",
    targetEdge: "u0",
    continuity,
    reverse: false,
  });
  const goodFile = new URL("blend-reference.json", out),
    badFile = new URL("blend-incompatible.json", out);
  await writeFile(goodFile, JSON.stringify(reference));
  await writeFile(badFile, JSON.stringify(incompatible));
  const sourceDigest = await geometryDigest(sourceId);
  const referenceId = (
    await mutate("surface_set", {
      name: "Fixed blend reference",
      patch: reference,
    })
  ).result.entityId;
  await mutate("object_update", {
    entityId: referenceId,
    patch: { locked: true },
  });
  const referenceDigest = await geometryDigest(referenceId);
  const surface = async (entityId) =>
    (await call("surface_get", { entityId })).result.patch;
  const inspect = async (entityId, area) => {
    const report = await job(await call("cad_inspect", { entityId }));
    assert(
      report.valid && report.faces === 1 && report.solids === 0,
      JSON.stringify(report),
    );
    // OpenCascade's nonadaptive rational-surface area integration is approximate.
    if (area !== undefined)
      assert(
        Math.abs(report.areaMm2 - area) < Math.max(1e-6, area * 1e-5),
        JSON.stringify(report),
      );
    return report;
  };
  const settled = async (jobId, status) =>
    eventually(async () => {
      const result = (await call("job_get", { jobId })).result;
      assert.equal(result.status, status, JSON.stringify(result));
      return result;
    });
  const idle = async () =>
    eventually(async () => {
      const session = (await call("session_get")).result;
      assert.equal(session.busy, false);
      assert.equal(session.activeJobId, null);
    });
  const model = (project) => ({
    selectedId: project.selectedId,
    undo: project.undo,
    redo: project.redo,
    objects: project.objects.map(({ meshPreparation, ...item }) => item),
  });
  async function onlyVisible(ids) {
    for (const item of (await call("project_get")).result.objects) {
      const visible = ids.includes(item.id);
      if (visible !== item.visible)
        await mutate("object_update", {
          entityId: item.id,
          patch: { visible },
        });
    }
  }
  async function preserved(entityId, digest, original) {
    assert.deepEqual(await geometryDigest(entityId), digest);
    assert.deepEqual(await surface(entityId), original);
    assert.deepEqual(await geometryDigest(referenceId), referenceDigest);
    assert.deepEqual(await surface(referenceId), reference);
    assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
  }
  async function openPanel(entityId, file, continuity) {
    await mutate("object_select", { entityId });
    await page.getByRole("tab", { name: "Surfacing", exact: true }).click();
    await page
      .getByRole("button", { name: "NURBS surface", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Freeform surface tools",
      exact: true,
    });
    await panel
      .getByLabel("Import reference patch JSON", { exact: true })
      .setInputFiles(fileURLToPath(file));
    await panel
      .getByText("Reference patch loaded for seam joining.", { exact: true })
      .waitFor();
    await panel
      .getByRole("button", { name: "Join continuity", exact: true })
      .click();
    await page
      .getByRole("option", {
        name:
          continuity === "C1"
            ? "C1 · shared boundary and derivative"
            : "C0 · shared boundary",
        exact: true,
      })
      .click();
    return panel;
  }

  // This kernel receipt runs before the expected missing-GUI-control RED.
  const analyticTarget = (
    await mutate("surface_set", {
      name: "Analytic blend target",
      patch: target,
    })
  ).result.entityId;
  const analyticBefore = (await call("project_get")).result;
  const analytic = await job(
    await mutate("surface_operation", {
      operation: "blend",
      entityId: analyticTarget,
      referenceId,
      options: options("C0"),
    }),
  );
  assert.equal(analytic.representation, "exactCad");
  assert.notEqual(analytic.entityId, analyticTarget);
  assert.notEqual(analytic.entityId, referenceId);
  assert.equal(
    (await call("project_get")).result.undo,
    analyticBefore.undo + 1,
  );
  assert.deepEqual(await surface(analyticTarget), target);
  const analyticReport = await inspect(analytic.entityId, 80);
  assert.equal((await surface(analytic.entityId)).degreeU, 1);
  assert(
    (await surface(analytic.entityId)).weights.some((weight) => weight !== 1),
  );
  ledger.scenarios.push({
    compatibleBlendAnalytic: {
      dimensionsMm: [8, 10],
      expectedAreaMm2: 80,
      areaToleranceMm2: Math.max(1e-6, 80 * 1e-5),
      report: analyticReport,
      scope:
        "Actual OpenCascade planar face created through public MCP; no native-reference equivalence claim",
    },
  });

  const cases = [];
  for (const exact of [false, true]) {
    for (const continuity of ["C0", "C1"]) {
      const entityId = exact
        ? (
            await job(
              await mutate("cad_create", {
                name: "Exact blend target",
                recipe: { kind: "surface", patch: target },
              }),
            )
          ).entityIds[0]
        : (
            await mutate("surface_set", {
              name: "Mesh blend target",
              patch: target,
              scanId: sourceId,
            })
          ).result.entityId;
      const targetDigest = await geometryDigest(entityId);
      await onlyVisible([entityId, referenceId]);
      const panel = await openPanel(entityId, badFile, continuity);
      const create = panel.getByRole("button", {
        name: "Create transition surface",
        exact: true,
      });
      const beforeBad = await call("project_get");
      // Intended initial RED: the shared operation exists but this GUI button does not.
      await create.click();
      const error = page.locator(".error-banner");
      await error.waitFor();
      const guiError = await error.textContent();
      const rejected = await mutate("surface_operation", {
        operation: "blend",
        entityId,
        referencePatch: incompatible,
        options: options(continuity),
      });
      const failed = await settled(rejected.result.jobId, "failed");
      assert(guiError.includes(failed.error.message), guiError);
      const afterBad = await call("project_get");
      assert.equal(afterBad.revision, beforeBad.revision);
      assert.deepEqual(model(afterBad.result), model(beforeBad.result));
      await preserved(entityId, targetDigest, target);

      await panel
        .getByLabel("Import reference patch JSON", { exact: true })
        .setInputFiles(fileURLToPath(goodFile));
      await panel
        .getByText("Reference patch loaded for seam joining.", { exact: true })
        .waitFor();
      const before = (await call("project_get")).result;
      const priorIds = new Set(before.objects.map((item) => item.id));
      const priorJobs = new Set(
        (await call("session_get")).result.jobs.map((item) => item.jobId),
      );
      await create.click();
      const guiId = await eventually(async () => {
        const project = (await call("project_get")).result;
        const added = project.objects.filter((item) => !priorIds.has(item.id));
        assert.equal(added.length, 1);
        assert.equal(project.selectedId, entityId);
        assert.equal(project.undo, before.undo + 1);
        return added[0].id;
      });
      await idle();
      const guiJobs = (await call("session_get")).result.jobs.filter(
        (item) =>
          !priorJobs.has(item.jobId) && item.command === "surface_operation",
      );
      assert.equal(guiJobs.length, 1);
      const guiResult = (await settled(guiJobs[0].jobId, "succeeded")).result;
      assert.equal(guiResult.entityId, guiId);
      assert.equal(guiResult.representation, "exactCad");
      assert.deepEqual(guiResult.options, options(continuity));
      assert.deepEqual(guiResult.referenceSource, { kind: "patch" });
      assert.equal(await error.count(), 0);
      const guiPatch = await surface(guiId),
        guiDigest = await geometryDigest(guiId);
      assert.equal(guiPatch.countU, continuity === "C0" ? 2 : 4);
      assert.equal(guiPatch.degreeU, continuity === "C0" ? 1 : 3);
      for (let row = 0; row < 4; row++) {
        const first = row * guiPatch.countU,
          last = first + guiPatch.countU - 1;
        assert.deepEqual(guiPatch.points[first], reference.points[row * 4 + 3]);
        assert.deepEqual(guiPatch.points[last], target.points[row * 4]);
        assert.equal(guiPatch.weights[first], reference.weights[row * 4 + 3]);
        assert.equal(guiPatch.weights[last], target.weights[row * 4]);
      }
      const guiObject = (await call("object_get", { entityId: guiId })).result;
      assert.equal(guiObject.parametric.feature.id, guiResult.featureId);
      assert.deepEqual(guiObject.parametric.feature.recipe, {
        kind: "surface",
        patch: guiPatch,
      });
      assert.equal(
        (await call("surface_get", { entityId: guiId })).result.scanId,
        undefined,
      );
      const report = await inspect(guiId, 80);
      await preserved(entityId, targetDigest, target);
      await mutate("viewport_control", { action: "fit", entityId: guiId });
      await page.screenshot({
        path: fileURLToPath(
          new URL(`blend-${exact ? "exact" : "mesh"}-${continuity}.png`, out),
        ),
      });
      await mutate("history_undo", {});
      assert.deepEqual(await surface(entityId), target);
      await mutate("history_redo", {});
      assert.deepEqual(await geometryDigest(guiId), guiDigest);
      await mutate("history_undo", {});

      for (const ref of [{ referencePatch: reference }, { referenceId }]) {
        const beforeMcp = (await call("project_get")).result.undo;
        const result = await job(
          await mutate("surface_operation", {
            operation: "blend",
            entityId,
            ...ref,
            options: options(continuity),
          }),
        );
        assert.equal((await call("project_get")).result.undo, beforeMcp + 1);
        assert.deepEqual(
          result.referenceSource,
          ref.referenceId
            ? { kind: "entity", entityId: referenceId }
            : { kind: "patch" },
        );
        assert.deepEqual(await surface(result.entityId), guiPatch);
        assert.deepEqual(await geometryDigest(result.entityId), guiDigest);
        await preserved(entityId, targetDigest, target);
        await mutate("history_undo", {});
      }
      await mutate("history_redo", {});
      const persistedId = (await call("project_get")).result.objects.find(
        (item) => !priorIds.has(item.id),
      ).id;
      const saved = await job(
        await call("project_export", { format: "project" }),
      );
      const priorRevision = (await call("session_get")).revision;
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .locator('input[type=file][accept*=".scanforge"]')
        .setInputFiles({
          name: "blend-reopen.scanforge",
          mimeType: "application/octet-stream",
          buffer: await artifactBytes(saved),
        });
      await eventually(async () =>
        assert((await call("session_get")).revision > priorRevision),
      );
      await idle();
      assert.deepEqual(await surface(persistedId), guiPatch);
      assert.deepEqual(await geometryDigest(persistedId), guiDigest);
      await job(
        await mutate("project_import", {
          artifactId: saved.artifactId,
          replace: true,
        }),
      );
      assert.deepEqual(await surface(persistedId), guiPatch);
      assert.deepEqual(await geometryDigest(persistedId), guiDigest);
      await preserved(entityId, targetDigest, target);
      await onlyVisible([persistedId]);
      const step = await job(await call("project_export", { format: "step" }));
      const oldIds = new Set(
        (await call("project_get")).result.objects.map((item) => item.id),
      );
      await job(
        await mutate("project_import", {
          artifactId: step.artifactId,
          unit: "mm",
          placeAtOrigin: false,
        }),
      );
      const stepId = (await call("project_get")).result.objects.find(
        (item) => !oldIds.has(item.id),
      ).id;
      const stepReport = await inspect(stepId, 80);
      assert(
        Math.abs(stepReport.areaMm2 - report.areaMm2) <
          Math.max(1e-6, report.areaMm2 * 1e-8),
      );
      cases.push({
        sourceRepresentation: exact ? "exactCad" : "mesh",
        continuity,
        guiMcpRawAndIdGeometryEquality: true,
        oneHistoryStep: true,
        selectedTargetPreserved: true,
        inputsPreserved: true,
        undoRedo: true,
        guiMcpProjectBitExact: true,
        analyticStepRoundTrip: true,
        report,
        stepReport,
        rejectedMessage: failed.error.message,
      });
    }
  }

  // Hold only this phase's real native request so the owned cancel portal is reachable.
  const cancelId = (
    await job(
      await mutate("cad_create", {
        name: "Cancellation live exact target",
        recipe: { kind: "surface", patch: target },
      }),
    )
  ).entityIds[0];
  await onlyVisible([cancelId, referenceId]);
  const cancelPanel = await openPanel(cancelId, goodFile, "C1");
  const beforeCancel = await call("project_get"),
    cancelDigest = await geometryDigest(cancelId);
  const oldJobs = new Set(
    (await call("session_get")).result.jobs.map((item) => item.jobId),
  );
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    const state = {
      send,
      hold: true,
      held: [],
      created: [],
      released: [],
      listeners: [],
    };
    window.__m5BlendHold = state;
    Worker.prototype.postMessage = function (...args) {
      if (state.hold && args[0]?.operation === "surface") {
        const id = args[0].id;
        const listener = (event) => {
          if (event.data?.id === id && event.data.result?.kernelId)
            state.created.push(event.data.result.kernelId);
        };
        this.addEventListener("message", listener);
        state.listeners.push([this, listener]);
        state.held.push(() => send.apply(this, args));
        return;
      }
      if (args[0]?.operation === "release")
        state.released.push(...args[0].payload);
      return send.apply(this, args);
    };
  });
  let cancellation;
  try {
    await cancelPanel
      .getByRole("button", { name: "Create transition surface", exact: true })
      .click();
    await eventually(async () =>
      assert.equal(
        await page.evaluate(() => window.__m5BlendHold.held.length),
        1,
      ),
    );
    assert.equal((await call("project_get")).result.selectedId, cancelId);
    const cancel = page.getByRole("button", {
      name: "Cancel surface blend",
      exact: true,
    });
    assert(await cancel.isEnabled());
    await cancel.click();
    const pending = (await call("session_get")).result.jobs.filter(
      (item) =>
        !oldJobs.has(item.jobId) && item.command === "surface_operation",
    );
    assert.equal(pending.length, 1);
    await page.evaluate(() => {
      window.__m5BlendHold.hold = false;
      window.__m5BlendHold.held.splice(0).forEach((send) => send());
    });
    await settled(pending[0].jobId, "cancelled");
    await idle();
    cancellation = await eventually(async () => {
      const proof = await page.evaluate(() => ({
        created: window.__m5BlendHold.created,
        released: window.__m5BlendHold.released,
      }));
      assert.equal(proof.created.length, 1);
      assert(proof.released.includes(proof.created[0]), JSON.stringify(proof));
      return proof;
    });
    const afterCancel = await call("project_get");
    assert.equal(afterCancel.revision, beforeCancel.revision);
    assert.deepEqual(model(afterCancel.result), model(beforeCancel.result));
    await preserved(cancelId, cancelDigest, target);
    await inspect(cancelId, 100);
    const targetFeature = (await call("object_get", { entityId: cancelId }))
      .result.parametric;
    // Transform consumes the retained native input handle rather than rebuilding its patch.
    const live = await job(
      await mutate("cad_create", {
        name: "Retained target handle after blend cancellation",
        recipe: {
          kind: "transform",
          source: {
            featureId: targetFeature.feature.id,
            output: targetFeature.output,
          },
          translation: [0, 0, 1],
          rotation: [0, 0, 0],
          scale: 1,
        },
      }),
    );
    assert.equal(live.entityIds.length, 1);
    assert.notEqual(live.entityIds[0], cancelId);
    await inspect(live.entityIds[0], 100);
    await mutate("history_undo", {});
    await preserved(cancelId, cancelDigest, target);
  } finally {
    await page.evaluate(() => {
      const state = window.__m5BlendHold;
      if (!state) return;
      Worker.prototype.postMessage = state.send;
      state.held.splice(0).forEach((send) => send());
      for (const [worker, listener] of state.listeners)
        worker.removeEventListener("message", listener);
      delete window.__m5BlendHold;
    });
  }

  let real;
  if (realPatch) {
    const realReference = structuredClone(realPatch),
      realTarget = structuredClone(realPatch);
    const xs = realPatch.points.map((point) => point[0]);
    const offset = Math.max(...xs) - Math.min(...xs) + 8;
    realTarget.points = realTarget.points.map(([x, y, z]) => [
      x + offset,
      y,
      z,
    ]);
    const realId = (
      await mutate("surface_set", {
        name: "Scan fitted blend target",
        patch: realTarget,
        scanId: sourceId,
      })
    ).result.entityId;
    const original = await geometryDigest(realId);
    const result = await job(
      await mutate("surface_operation", {
        operation: "blend",
        entityId: realId,
        referencePatch: realReference,
        options: options("C1"),
      }),
    );
    real = {
      report: await inspect(result.entityId),
      sourcePatch: { countU: realPatch.countU, countV: realPatch.countV },
      scope:
        "Scan-derived fitted patch and translated copy, actual kernel C1 bridge; no native seam equivalence claim",
    };
    assert.deepEqual(await geometryDigest(realId), original);
    assert.deepEqual(await surface(realId), realTarget);
  }
  assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
  ledger.scenarios.push({
    compatibleSurfaceBlends: {
      scope:
        "Compatible materialized C0/C1 transition surfaces; general CAD-edge/G2/persistent constraints and native-reference seam equivalence remain open",
      cases,
      ownedCancellationLateRelease: cancellation,
      representativeScanDerived: real ?? "not supplied",
    },
  });
}

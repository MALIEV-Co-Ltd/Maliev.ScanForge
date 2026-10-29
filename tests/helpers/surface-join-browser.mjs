import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function replaySurfaceJoins({
  page,
  call,
  mutate,
  job,
  eventually,
  geometryDigest,
  ledger,
  out,
  sourceId,
}) {
  const patch = (offset = 0, rows = 4, sloped = false) => ({
    format: "scanforge-nurbs",
    version: 1,
    countU: 4,
    countV: rows,
    degreeU: 3,
    degreeV: 3,
    knotsU: [0, 0, 0, 0, 1, 1, 1, 1],
    knotsV:
      rows === 4 ? [0, 0, 0, 0, 1, 1, 1, 1] : [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
    weights: Array(4 * rows).fill(1),
    points: Array.from({ length: 4 * rows }, (_, i) => [
      ((i % 4) * 10) / 3 + offset,
      (Math.floor(i / 4) * 10) / (rows - 1),
      sloped ? (i % 4) / 3 : 0,
    ]),
  });
  const reference = patch(0, 4, true),
    target = patch(8),
    incompatible = patch(0, 5, true);
  const goodFile = new URL("join-reference.json", out),
    badFile = new URL("join-incompatible.json", out);
  await writeFile(goodFile, JSON.stringify(reference));
  await writeFile(badFile, JSON.stringify(incompatible));
  const referenceId = (
    await mutate("surface_set", {
      name: "Fixed join reference",
      patch: reference,
    })
  ).result.entityId;
  await mutate("object_update", {
    entityId: referenceId,
    patch: { locked: true },
  });
  const referenceDigest = await geometryDigest(referenceId),
    sourceDigest = await geometryDigest(sourceId);
  async function failed(receipt) {
    return eventually(async () => {
      const result = (await call("job_get", { jobId: receipt.result.jobId }))
        .result;
      assert.equal(result.status, "failed", JSON.stringify(result));
      return result;
    });
  }
  const cases = [];
  for (const exact of [false, true]) {
    for (const continuity of ["C0", "C1"]) {
      const options = {
        referenceEdge: "u1",
        targetEdge: "u0",
        continuity,
        reverse: false,
      };
      const entityId = exact
        ? (
            await job(
              await mutate("cad_create", {
                name: "Exact joined patch",
                recipe: { kind: "surface", patch: target },
              }),
            )
          ).entityIds[0]
        : (
            await mutate("surface_set", {
              name: "Mesh joined patch",
              patch: target,
              scanId: sourceId,
            })
          ).result.entityId;
      for (const item of (await call("project_get")).result.objects) {
        const visible = item.id === entityId || item.id === referenceId;
        if (item.visible !== visible)
          await mutate("object_update", {
            entityId: item.id,
            patch: { visible },
          });
      }
      await mutate("object_select", { entityId });
      assert(
        (await call("command_get")).result.commands.some(
          (command) =>
            command.name === "ribbon:nurbsSurface" && command.available,
        ),
      );
      await page.getByRole("tab", { name: "Surfacing", exact: true }).click();
      await page
        .getByRole("button", { name: "NURBS surface", exact: true })
        .click();
      const panel = page.getByRole("region", {
        name: "Freeform surface tools",
        exact: true,
      });
      const importer = panel.getByLabel("Import reference patch JSON", {
        exact: true,
      });
      await importer.setInputFiles(fileURLToPath(badFile));
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
      const beforeBadDigest = await geometryDigest(entityId);
      const beforeBad = await call("project_get");
      await panel
        .getByRole("button", { name: "Apply boundary join", exact: true })
        .click();
      const error = page.locator(".error-banner");
      await error.waitFor();
      const guiError = await error.textContent();
      const rejected = await failed(
        await mutate("surface_operation", {
          entityId,
          operation: "join",
          referencePatch: incompatible,
          options,
        }),
      );
      assert(guiError.includes(rejected.error.message));
      const afterBad = await call("project_get");
      assert.equal(afterBad.revision, beforeBad.revision);
      assert.equal(afterBad.result.undo, beforeBad.result.undo);
      // Background preparation readiness is observable but is not a model edit.
      const modelObjects = (objects) =>
        objects.map(({ meshPreparation, ...model }) => model);
      assert.deepEqual(
        modelObjects(afterBad.result.objects),
        modelObjects(beforeBad.result.objects),
      );
      assert.deepEqual(await geometryDigest(entityId), beforeBadDigest);
      assert.deepEqual(await geometryDigest(referenceId), referenceDigest);
      assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
      await importer.setInputFiles(fileURLToPath(goodFile));
      await panel
        .getByText("Reference patch loaded for seam joining.", { exact: true })
        .waitFor();
      const before = (await call("project_get")).result,
        oldJobs = new Set(
          (await call("session_get")).result.jobs.map((x) => x.jobId),
        );
      await panel
        .getByRole("button", { name: "Apply boundary join", exact: true })
        .click();
      const guiPatch = await eventually(async () => {
        const current = (await call("surface_get", { entityId })).result.patch;
        assert(Math.abs(current.points[0][0] - 10) < 1e-9);
        assert(
          Math.abs(current.points[1][2] - (continuity === "C1" ? 4 / 3 : 0)) <
            1e-9,
        );
        return current;
      });
      await panel
        .getByText(
          `${continuity} boundary applied to active patch. Reference remains fixed.`,
          { exact: true },
        )
        .waitFor();
      assert.equal(await error.count(), 0);
      assert.equal((await call("project_get")).result.undo, before.undo + 1);
      const guiJobs = (await call("session_get")).result.jobs.filter(
        (x) => !oldJobs.has(x.jobId) && x.command === "surface_operation",
      );
      assert.equal(guiJobs.length, 1);
      assert.equal(guiJobs[0].status, "succeeded");
      const guiResult = (await call("job_get", { jobId: guiJobs[0].jobId }))
        .result.result;
      assert.equal(guiResult.representation, exact ? "exactCad" : "mesh");
      assert.deepEqual(guiResult.options, options);
      assert.deepEqual(
        guiResult.changedControlIndices,
        continuity === "C1" ? [0, 1, 4, 5, 8, 9, 12, 13] : [0, 4, 8, 12],
      );
      const guiDigest = await geometryDigest(entityId);
      assert.deepEqual(await geometryDigest(referenceId), referenceDigest);
      await mutate("viewport_control", { action: "fit", entityId });
      await page.screenshot({
        path: fileURLToPath(
          new URL(
            exact ? "exact-surface-join.png" : "mesh-surface-join.png",
            out,
          ),
        ),
      });
      await mutate("history_undo", {});
      await job(
        await mutate("surface_operation", {
          entityId,
          operation: "join",
          referencePatch: reference,
          options,
        }),
      );
      assert.deepEqual(
        (await call("surface_get", { entityId })).result.patch,
        guiPatch,
      );
      assert.deepEqual(await geometryDigest(entityId), guiDigest);
      await mutate("history_undo", {});
      const byId = await job(
        await mutate("surface_operation", {
          entityId,
          operation: "join",
          referenceId,
          options,
        }),
      );
      assert.deepEqual(byId.referenceSource, {
        kind: "entity",
        entityId: referenceId,
      });
      assert.deepEqual(
        (await call("surface_get", { entityId })).result.patch,
        guiPatch,
      );
      assert.deepEqual(await geometryDigest(entityId), guiDigest);
      assert.deepEqual(await geometryDigest(referenceId), referenceDigest);
      assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
      if (!exact)
        assert.equal(
          (await call("surface_get", { entityId })).result.scanId,
          sourceId,
        );
      const saved = await job(
        await call("project_export", { format: "project" }),
      );
      await job(
        await mutate("project_import", {
          artifactId: saved.artifactId,
          replace: true,
        }),
      );
      assert.deepEqual(
        (await call("surface_get", { entityId })).result.patch,
        guiPatch,
      );
      assert.deepEqual(await geometryDigest(referenceId), referenceDigest);
      let report, stepReport;
      if (exact) {
        report = await job(await call("cad_inspect", { entityId }));
        assert(report.valid && report.faces === 1 && report.solids === 0);
        assert.equal(
          (await call("object_get", { entityId })).result.parametric.feature
            .recipe.kind,
          "surface",
        );
        await mutate("object_update", {
          entityId: referenceId,
          patch: { visible: false },
        });
        const step = await job(
          await call("project_export", { format: "step" }),
        );
        const oldIds = new Set(
          (await call("project_get")).result.objects.map((x) => x.id),
        );
        await job(
          await mutate("project_import", {
            artifactId: step.artifactId,
            unit: "mm",
            placeAtOrigin: false,
          }),
        );
        const stepId = (await call("project_get")).result.objects.find(
          (x) => !oldIds.has(x.id),
        ).id;
        stepReport = await job(await call("cad_inspect", { entityId: stepId }));
        assert(
          stepReport.valid && stepReport.faces === 1 && stepReport.solids === 0,
        );
        assert(
          Math.abs(stepReport.areaMm2 - report.areaMm2) <
            Math.max(1e-6, report.areaMm2 * 1e-8),
        );
      }
      cases.push({
        continuity,
        representation: exact ? "exactCad" : "mesh",
        entry: "actual NURBS surface ribbon",
        guiMcpRawAndIdEquality: true,
        oneGuiHistoryStep: true,
        referenceAndSourcePreserved: true,
        projectPatchPreserved: true,
        changedControlIndices: guiResult.changedControlIndices,
        rejectedMessage: rejected.error.message,
        report,
        stepReport,
      });
    }
  }
  await mutate("object_update", {
    entityId: referenceId,
    patch: { locked: false },
  });
  ledger.scenarios.push({
    compatibleJoins: {
      scope:
        "Authored compatible C0/C1 patch joins; not a persistent seam constraint, general blend or native-reference equivalence",
      cases,
    },
  });
}

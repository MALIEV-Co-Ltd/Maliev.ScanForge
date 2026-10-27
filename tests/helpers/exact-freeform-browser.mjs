import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export async function replayExactFreeform({
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
  const patch = {
    format: "scanforge-nurbs",
    version: 1,
    countU: 4,
    countV: 4,
    degreeU: 3,
    degreeV: 3,
    knotsU: [0, 0, 0, 0, 1, 1, 1, 1],
    knotsV: [0, 0, 0, 0, 1, 1, 1, 1],
    weights: Array(16).fill(1),
    points: Array.from({ length: 16 }, (_, i) => [
      ((i % 4) * 10) / 3,
      (Math.floor(i / 4) * 10) / 3,
      0,
    ]),
  };
  const target = (
    await job(
      await mutate("cad_create", {
        name: "Exact freeform controls",
        recipe: { kind: "surface", patch },
      }),
    )
  ).entityIds[0];
  for (const item of (await call("project_get")).result.objects)
    if (item.visible && item.id !== target)
      await mutate("object_update", {
        entityId: item.id,
        patch: { visible: false },
      });
  await mutate("object_select", { entityId: target });
  await page.getByRole("tab", { name: "Surfacing", exact: true }).click();
  await page.locator('[data-command="nurbsSurface"]').click();
  const panel = page.getByRole("region", {
    name: "Freeform surface tools",
    exact: true,
  });
  const sourceDigest = await geometryDigest(sourceId),
    cases = [];
  const surface = async () =>
    (await call("surface_get", { entityId: target })).result.patch;
  async function check(operation, args, apply) {
    const before = await call("project_get"),
      original = await surface();
    const oldJobs = (await call("session_get")).result.jobs.map((x) => x.jobId);
    await apply();
    await eventually(async () => {
      const jobs = (await call("session_get")).result.jobs.filter(
        (x) =>
          !oldJobs.includes(x.jobId) &&
          x.command ===
            (operation === "snap" ? "surface_operation" : "cad_rebuild"),
      );
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].status, "succeeded");
    });
    const gui = await surface(),
      guiDigest = await geometryDigest(target);
    assert.equal(
      (await call("project_get")).result.undo,
      before.result.undo + 1,
    );
    await mutate("history_undo", {});
    assert.deepEqual(await surface(), original);
    const result = await job(
      await mutate("surface_operation", {
        entityId: target,
        operation,
        ...args,
      }),
    );
    assert.deepEqual(await surface(), gui);
    assert.deepEqual(await geometryDigest(target), guiDigest);
    assert.equal(result.rebuiltFeatureIds.length, 1);
    assert.deepEqual(result.cleanupFailures, []);
    await mutate("history_undo", {});
    assert.deepEqual(await surface(), original);
    await mutate("history_redo", {});
    assert.deepEqual(await surface(), gui);
    const report = await job(await call("cad_inspect", { entityId: target }));
    assert(report.valid && report.faces === 1 && report.solids === 0);
    cases.push({
      operation,
      actualGuiControl: true,
      guiMcpPatchAndGeometryEquality: true,
      oneHistoryStep: true,
      undoRedo: true,
      report,
    });
  }
  await panel
    .getByRole("spinbutton", { name: "Width (mm)", exact: true })
    .fill("12");
  await panel
    .getByRole("spinbutton", { name: "Height (mm)", exact: true })
    .fill("15");
  await check(
    "grid",
    { countU: 4, countV: 4, degree: 3, width: 12, height: 15 },
    () =>
      panel.getByRole("button", { name: "Create grid", exact: true }).click(),
  );
  await check("knot", { axis: "u", parameter: 0.5, repetitions: 1 }, () =>
    panel.getByRole("button", { name: "Insert knot", exact: true }).click(),
  );
  await check("crease", { axis: "u", parameter: 0.5 }, () =>
    panel
      .getByRole("button", { name: "Prepare editable crease", exact: true })
      .click(),
  );
  await panel.getByRole("button", { name: /^Control point/ }).click();
  await page.getByRole("option", { name: "U 2, V 2", exact: true }).click();
  await check("snap", { index: (await surface()).countU + 1 }, () =>
    panel
      .getByRole("button", { name: "Snap control to scan", exact: true })
      .click(),
  );
  const obj = "v 0 0 0\nv 2 0 0\nv 0 3 0\nv 2 3 1\nf 1 2 4 3",
    objFile = new URL("exact-freeform-grid.obj", out);
  await writeFile(objFile, obj);
  const upload = (
    await call("artifact_put", {
      name: "grid.obj",
      offset: 0,
      base64: Buffer.from(obj).toString("base64"),
    })
  ).result;
  await panel
    .getByRole("spinbutton", { name: "U controls", exact: true })
    .fill("2");
  await panel
    .getByRole("spinbutton", { name: "V controls", exact: true })
    .fill("2");
  await panel
    .getByRole("spinbutton", { name: "Degree", exact: true })
    .fill("1");
  await check(
    "quadImport",
    { artifactId: upload.artifactId, countU: 2, countV: 2, degree: 1 },
    () =>
      panel
        .getByLabel(
          "Import patch JSON or ordered quad OBJ (current U/V dimensions)",
          { exact: true },
        )
        .setInputFiles(fileURLToPath(objFile)),
  );
  const before = await call("project_get"),
    original = await surface(),
    digest = await geometryDigest(target);
  await panel
    .getByRole("spinbutton", {
      name: "Normalized interior parameter",
      exact: true,
    })
    .fill("0");
  await panel.getByRole("button", { name: "Insert knot", exact: true }).click();
  await panel
    .getByText(
      "Refinement parameter must be strictly inside normalized domain (0, 1).",
      { exact: true },
    )
    .waitFor();
  // The public schema also rejects this invalid parameter before starting a job.
  const invalid = await call(
    "surface_operation",
    {
      entityId: target,
      operation: "knot",
      axis: "u",
      parameter: 0,
      expectedRevision: before.revision,
      requestId: randomUUID(),
    },
    true,
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "INVALID_ARGUMENT");
  assert.match(invalid.error.message, /parameter/);
  assert.deepEqual(await surface(), original);
  assert.deepEqual(await geometryDigest(target), digest);
  assert.equal((await call("project_get")).revision, before.revision);
  assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual(await surface(), original);
  assert.deepEqual(await geometryDigest(target), digest);
  ledger.scenarios.push({
    exactFreeform: {
      entry: "actual NURBS surface ribbon",
      cases,
      sourcePreserved: true,
      projectRecipeAndBrepPreserved: true,
      invalidGuiNoPublication: true,
    },
  });
}

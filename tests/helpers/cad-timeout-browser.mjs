import assert from "node:assert/strict";

export async function replayCadTimeout({
  page,
  call,
  mutate,
  job,
  eventually,
  geometryDigest,
  ledger,
}) {
  const before = await call("project_get");
  const digests = new Map();
  for (const entity of before.result.objects)
    digests.set(entity.id, await geometryDigest(entity.id));
  const terminations = await page.evaluate(
    () => window.__m5ExportWorkerTerminations,
  );
  await page.evaluate(() => {
    window.__m5HoldStepExport = true;
  });
  await page
    .getByRole("button", { name: "Export STEP", exact: true })
    .last()
    .click();
  await eventually(async () =>
    assert.equal(
      await page.evaluate(() => window.__m5HeldStepExports.length),
      1,
    ),
  );
  const jobId = (await call("session_get")).result.activeJobId,
    started = Date.now();
  let terminal;
  while (Date.now() - started < 95000) {
    terminal = (await call("job_get", { jobId })).result;
    if (terminal.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const elapsedMs = Date.now() - started;
  assert.equal(terminal.status, "failed");
  assert.match(terminal.error.message, /exceeded 90 seconds; kernel reset/);
  assert(elapsedMs >= 89000 && elapsedMs < 95000);
  assert.equal(
    await page.evaluate(() => window.__m5ExportWorkerTerminations),
    terminations + 1,
  );
  await page.evaluate(() => {
    window.__m5HoldStepExport = false;
    window.__m5HeldStepExports.length = 0;
  });
  const failed = await call("project_get");
  assert.equal(failed.revision, before.revision);
  assert.equal(failed.result.undo, before.result.undo);
  for (const [id, digest] of digests)
    assert.deepEqual(await geometryDigest(id), digest);
  assert.equal((await call("session_get")).result.activeJobId, null);
  const saved = await job(await call("project_export", { format: "project" }));
  await job(
    await mutate("project_import", {
      artifactId: saved.artifactId,
      replace: true,
    }),
  );
  for (const [id, digest] of digests)
    assert.deepEqual(await geometryDigest(id), digest);
  const exact = (await call("project_get")).result.objects.filter(
    (x) => x.kind === "cad",
  );
  const reports = [];
  for (const entity of exact) {
    const report = await job(
      await call("cad_inspect", { entityId: entity.id }),
    );
    assert(report.valid);
    reports.push(report);
  }
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export STEP", exact: true })
    .last()
    .click();
  await download;
  await eventually(async () =>
    assert.equal((await call("session_get")).result.activeJobId, null),
  );
  ledger.scenarios.push({
    cadTimeoutRecovery: {
      scope:
        "Injected hold of owned CAD export transport; real unchanged native lease and worker termination, not an algorithmic performance claim",
      elapsedMs,
      kernelWorkerTerminated: true,
      noLatePublication: true,
      sourceRevisionHistoryAndGeometryPreserved: true,
      projectExportAndReopenRestoresExactHandles: true,
      guiExportRecovered: true,
      reports,
    },
  });
}

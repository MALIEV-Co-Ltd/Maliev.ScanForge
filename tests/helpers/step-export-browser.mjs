import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function replayStepExport({
  page,
  call,
  mutate,
  job,
  eventually,
  artifactBytes,
  geometryDigest,
  ledger,
  out,
  sourceId,
}) {
  const original = (await call("project_get")).result.objects;
  for (const entity of original)
    if (entity.visible)
      await mutate("object_update", {
        entityId: entity.id,
        patch: { visible: false },
      });
  const box = await job(
    await mutate("cad_create", {
      name: "STEP parity box",
      recipe: {
        kind: "primitive",
        input: { kind: "box", center: [0, 0, 0], size: [10, 10, 10] },
      },
    }),
  );
  const boxId = box.entityIds[0];
  await mutate("object_update", {
    entityId: sourceId,
    patch: { visible: true },
  });
  const before = await call("project_get"),
    sourceDigest = await geometryDigest(sourceId),
    boxDigest = await geometryDigest(boxId);
  const strict = await call("project_export", { format: "step" });
  const failed = await eventually(async () => {
    const status = (await call("job_get", { jobId: strict.result.jobId }))
      .result;
    assert.equal(status.status, "failed");
    return status;
  });
  assert.match(failed.error.message, /every exported object/);
  const agent = await job(
    await call("project_export", { format: "step", cadOnly: true }),
  );
  assert.deepEqual(agent.excludedEntityIds, [sourceId]);
  const agentBytes = await artifactBytes(agent);
  await writeFile(new URL("mcp-exact-export.step", out), agentBytes);
  const beforeJobs = (await call("session_get")).result.jobs.map(
    (x) => x.jobId,
  );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export STEP", exact: true })
    .last()
    .click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), "scanforge.step");
  const downloadedPath = fileURLToPath(new URL("gui-exact-export.step", out));
  await download.saveAs(downloadedPath);
  const guiBytes = await readFile(downloadedPath);
  const normalize = (bytes) =>
    bytes
      .toString("utf8")
      .replace(/FILE_NAME\([\s\S]*?\);/, "FILE_NAME(<volatile export header>);")
      .replace(
        /(PRODUCT\('Open CASCADE STEP translator 7\.4 )\d+(',\s*'Open CASCADE STEP translator 7\.4 )\d+(')/g,
        "$1<export counter>$2<export counter>$3",
      );
  assert.equal(normalize(guiBytes), normalize(agentBytes));
  await eventually(async () =>
    assert.equal((await call("session_get")).result.activeJobId, null),
  );
  const guiJobs = (await call("session_get")).result.jobs.filter(
    (x) => !beforeJobs.includes(x.jobId) && x.command === "project_export",
  );
  assert.equal(guiJobs.length, 1);
  assert.equal(guiJobs[0].status, "succeeded");
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
  const held = (await call("session_get")).result.activeJobId;
  await page
    .getByRole("button", { name: "Cancel STEP export", exact: true })
    .click();
  await page.evaluate(() => {
    window.__m5HoldStepExport = false;
    for (const resume of window.__m5HeldStepExports.splice(0)) resume();
  });
  await eventually(async () => {
    const status = (await call("job_get", { jobId: held })).result;
    assert.equal(status.status, "cancelled");
    assert.equal(status.result, undefined);
  });
  const recovered = await job(
    await call("project_export", { format: "step", cadOnly: true }),
  );
  assert.equal(
    normalize(await artifactBytes(recovered)),
    normalize(agentBytes),
  );
  const after = await call("project_get");
  assert.equal(after.revision, before.revision);
  assert.equal(after.result.undo, before.result.undo);
  assert.deepEqual(await geometryDigest(sourceId), sourceDigest);
  assert.deepEqual(await geometryDigest(boxId), boxDigest);
  const uploaded = (
    await call("artifact_put", {
      name: "gui-exact-export.step",
      offset: 0,
      base64: guiBytes.toString("base64"),
    })
  ).result;
  const roundTrips = [];
  for (const artifact of [agent, uploaded]) {
    const ids = new Set(
      (await call("project_get")).result.objects.map((x) => x.id),
    );
    await job(
      await mutate("project_import", {
        artifactId: artifact.artifactId,
        unit: "mm",
        placeAtOrigin: false,
      }),
    );
    const reopened = (await call("project_get")).result.objects.find(
      (x) => !ids.has(x.id),
    );
    const report = await job(
      await call("cad_inspect", { entityId: reopened.id }),
    );
    assert(report.valid && report.solids === 1 && report.faces === 6);
    assert(
      Math.abs(report.areaMm2 - 600) < 1e-6 &&
        Math.abs(report.volumeMm3 - 1000) < 1e-6,
    );
    roundTrips.push(report);
    await mutate("object_update", {
      entityId: reopened.id,
      patch: { visible: false },
    });
  }
  await mutate("object_update", { entityId: boxId, patch: { visible: false } });
  await page
    .getByRole("button", { name: "Export STEP", exact: true })
    .last()
    .click();
  await page
    .getByText("STEP export requires at least one exact CAD object.", {
      exact: true,
    })
    .first()
    .waitFor();
  const empty = await call("project_export", { format: "step", cadOnly: true });
  await eventually(async () => {
    const status = (await call("job_get", { jobId: empty.result.jobId }))
      .result;
    assert.equal(status.status, "failed");
    assert.equal(
      status.error.message,
      "STEP export requires at least one exact CAD object.",
    );
  });
  for (const entity of original)
    await mutate("object_update", {
      entityId: entity.id,
      patch: { visible: entity.visible },
    });
  ledger.scenarios.push({
    stepExport: {
      actualGuiDownload: true,
      sharedGuiJob: true,
      exactOnlyGuiMcpNormalizedStepEquality: true,
      excludedEntityIds: agent.excludedEntityIds,
      strictDefaultRetained: true,
      emptyGuiMcpErrorEquality: true,
      cancellation:
        "Held owned export transport, cancelled through reachable GUI control, released late response; no publication and subsequent export succeeded",
      unchangedRevisionHistoryGeometry: true,
      normalizedFields: [
        "FILE_NAME header",
        "Open CASCADE translator product export counter",
      ],
      roundTrips,
      bytes: guiBytes.length,
    },
  });
}

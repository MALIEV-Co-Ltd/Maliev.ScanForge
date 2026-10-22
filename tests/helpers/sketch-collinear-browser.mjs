import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Public stdio MCP and rendered controls exercise the same sketch_set operation.
export async function sketchCollinear({
  page,
  call,
  raw,
  mutate,
  tools,
  ledger,
  save,
  signal,
}) {
  assert.match(
    tools.find((tool) => tool.name === "sketch_set").description,
    /collinear/,
  );
  const panel = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  const pause = () => new Promise((resolve) => setTimeout(resolve, 75));
  async function eventually(check) {
    for (let i = 0; i < 120; i++) {
      signal.throwIfAborted();
      if (await check()) return;
      await pause();
    }
    throw Error("Collinear GUI workflow did not settle");
  }
  async function settled(wire) {
    assert.equal(wire.ok, true, JSON.stringify(wire));
    if (!wire.result.jobId) return wire.result;
    for (let i = 0; i < 200; i++) {
      signal.throwIfAborted();
      const job = (await call("job_get", { jobId: wire.result.jobId })).result;
      if (job.status !== "running") {
        assert.equal(job.status, "succeeded", JSON.stringify(job));
        return job.result;
      }
      await pause();
    }
    throw Error("Project round-trip job exceeded bounded polling");
  }
  const frames = [
    {
      plane: "OXY",
      frame: {
        origin: [0, 0, 12],
        u: [1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, 1],
      },
    },
    {
      plane: "OYZ",
      frame: {
        origin: [13, 0, 0],
        u: [0, 1, 0],
        v: [0, 0, 1],
        normal: [1, 0, 0],
      },
    },
    {
      plane: "OXZ",
      frame: {
        origin: [0, -7, 0],
        u: [0, 0, 1],
        v: [1, 0, 0],
        normal: [0, 1, 0],
      },
    },
  ];
  ledger.sketchCollinear = { nativeAcceptance: false, planes: [] };
  const nativeRelation = {
    id: "mcp-collinear",
    kind: "collinear",
    first: "first",
    second: "second",
  };
  for (const { plane, frame } of frames) {
    const source = {
      version: 1,
      frame,
      points: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 10, y: 0 },
        { id: "c", x: 20, y: 2 },
        { id: "d", x: 30, y: 4 },
      ],
      segments: [
        { id: "first", a: "a", b: "b", construction: true },
        { id: "second", a: "c", b: "d" },
      ],
      constraints: [
        { id: "fix-a", kind: "fixed", point: "a", x: 0, y: 0 },
        { id: "fix-b", kind: "fixed", point: "b", x: 10, y: 0 },
      ],
    };
    await mutate("sketch_manage", {
      action: "create",
      name: `Collinear ${plane}`,
      sketch: source,
    });
    const revision = (await call("project_get")).revision;
    const request = {
      sketch: {
        ...source,
        constraints: [...source.constraints, nativeRelation],
      },
      solve: true,
      expectedRevision: revision,
      requestId: randomUUID(),
    };
    const reply = await call("sketch_set", request);
    assert.equal(reply.result.solution.converged, true);
    assert.equal(reply.result.solution.degreesOfFreedom, 2);
    const expected = reply.result.solution.sketch;
    assert(expected.points.slice(2).every((p) => Math.abs(p.y) < 2e-6));
    assert.deepEqual(await raw("sketch_set", request), reply);
    await mutate("history_undo", { scope: "sketch" });
    assert.deepEqual((await call("sketch_get")).result.sketch, source);
    await mutate("ui_set", {
      workspace: "sketch",
      ribbonTab: "sketch",
      toolPanelOpen: true,
    });
    await panel
      .getByRole("button", { name: "Constraint", exact: true })
      .click();
    await page.getByRole("option", { name: "collinear", exact: true }).click();
    await panel
      .getByRole("button", { name: "First reference", exact: true })
      .click();
    await page.getByRole("option", { name: "first", exact: true }).click();
    await panel
      .getByRole("button", { name: "Second reference", exact: true })
      .click();
    assert.equal(
      await page.getByRole("option", { name: "first", exact: true }).count(),
      0,
      "Same segment cannot be selected twice",
    );
    await page.getByRole("option", { name: "second", exact: true }).click();
    await panel
      .getByRole("button", { name: "Add constraint", exact: true })
      .click();
    let gui;
    await eventually(async () => {
      const current = (await call("sketch_get")).result.sketch;
      if (!current.constraints.some((c) => c.kind === "collinear"))
        return false;
      gui = current;
      return true;
    });
    assert.deepEqual(
      gui.points,
      expected.points,
      "GUI/MCP solved coordinates agree exactly",
    );
    assert.deepEqual(gui.segments, source.segments);
    assert.deepEqual(gui.frame, frame);
    assert.equal(gui.points.length, 4, "Collinear does not weld endpoints");
    assert.deepEqual(
      { ...gui.constraints.at(-1), id: nativeRelation.id },
      nativeRelation,
    );
    await panel
      .getByRole("button", { name: "Undo sketch edit", exact: true })
      .click();
    await eventually(
      async () =>
        JSON.stringify((await call("sketch_get")).result.sketch) ===
        JSON.stringify(source),
    );
    await mutate("history_redo", { scope: "sketch" });
    assert.deepEqual((await call("sketch_get")).result.sketch, gui);
    assert.equal(
      (await call("project_get")).result.undo,
      0,
      "Sketch edits leave model history separate",
    );
    if (plane === "OXY") {
      const conflict = {
        ...source,
        constraints: [
          ...source.constraints,
          ...source.points.slice(2).map((p) => ({
            id: `fix-${p.id}`,
            kind: "fixed",
            point: p.id,
            x: p.x,
            y: p.y,
          })),
        ],
      };
      await mutate("sketch_set", { sketch: conflict });
      const beforeFailure = (await call("project_get")).revision;
      await panel
        .getByRole("button", { name: "Add constraint", exact: true })
        .click();
      await panel.getByText(/Conflicting or unsolved constraints:/).waitFor();
      assert.deepEqual((await call("sketch_get")).result.sketch, conflict);
      assert.equal((await call("project_get")).revision, beforeFailure);
      const rejected = await raw("sketch_set", {
        sketch: {
          ...conflict,
          constraints: [...conflict.constraints, nativeRelation],
        },
        solve: true,
        expectedRevision: beforeFailure,
        requestId: randomUUID(),
      });
      assert.equal(rejected.ok, false);
      assert.match(
        rejected.error.message,
        /Conflicting or unsolved constraints:/,
      );
      assert.deepEqual((await call("sketch_get")).result.sketch, conflict);
      await mutate("sketch_set", { sketch: gui });
      ledger.sketchCollinear.guiMcpConflictAtomicity = true;
    }
    ledger.sketchCollinear.planes.push({
      plane,
      frame,
      guiMcpExactCoordinates: true,
      sourceIdsPreserved: true,
      oneSketchUndoRedo: true,
      modelHistoryUnchanged: true,
      exactRetry: true,
      points: gui.points,
    });
    save();
  }
  const before = (await call("sketch_get")).result;
  const exported = await settled(
    await call("project_export", { format: "project" }),
  );
  await settled(
    await mutate("project_import", {
      artifactId: exported.artifactId,
      replace: true,
    }),
  );
  assert.deepEqual((await call("sketch_get")).result, before);
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
  });
  await panel.waitFor();
  await panel
    .getByRole("button", { name: "Constraint", exact: true })
    .scrollIntoViewIfNeeded();
  ledger.sketchCollinear.saveReopenPreservesAllSketches = true;
  ledger.sketchCollinear.exportArtifactId = exported.artifactId;
  ledger.sketchCollinear.completedWorkflowPassed = true;
  save();
}

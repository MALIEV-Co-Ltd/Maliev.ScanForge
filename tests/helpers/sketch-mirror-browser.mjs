import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Public GUI/MCP only. Caller owns browser/resource admission and its absolute lease.
export async function sketchMirror({
  page,
  call,
  raw,
  mutate,
  tools,
  ledger,
  save,
  signal,
}) {
  const tool = tools.find((item) => item.name === "sketch_mirror");
  assert(tool, "Missing sketch_mirror discovery");
  assert.equal(tool.annotations?.readOnlyHint, false);
  assert.equal(tool.inputSchema.properties.axis.type, "string");
  assert.equal(tool.inputSchema.properties.curveIds.type, "array");
  for (const key of ["axis", "curveIds", "expectedRevision", "requestId"])
    assert(tool.inputSchema.required.includes(key));
  const request = { axis: "axis", curveIds: ["line", "upper", "lower"] };
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
  const fixture = (frame) => ({
    version: 1,
    frame: structuredClone(frame),
    points: [
      { id: "axis-a", x: 0, y: -10 },
      { id: "axis-b", x: 0, y: 10 },
      { id: "a", x: 2, y: 1 },
      { id: "b", x: 4, y: 3 },
      { id: "center", x: 3, y: 0 },
      { id: "left", x: 1, y: 0 },
      { id: "right", x: 5, y: 0 },
    ],
    segments: [
      { id: "axis", a: "axis-a", b: "axis-b", construction: true },
      { id: "line", a: "a", b: "b", construction: false },
    ],
    arcs: [
      {
        id: "upper",
        a: "right",
        b: "left",
        center: "center",
        clockwise: false,
        construction: true,
      },
      {
        id: "lower",
        a: "left",
        b: "right",
        center: "center",
        clockwise: false,
      },
    ],
    constraints: [
      { id: "fixed-original", kind: "fixed", point: "a", x: 2, y: 1 },
    ],
  });
  const read = async () => (await call("sketch_get")).result;
  const state = async () => (await call("project_get")).result;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 75));
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
  const operationResult = async (wire) => {
    assert.equal(wire.ok, true, JSON.stringify(wire));
    if (!wire.result?.jobId) return wire.result;
    for (let attempt = 0; attempt < 120; attempt++) {
      signal.throwIfAborted();
      const job = (await call("job_get", { jobId: wire.result.jobId })).result;
      if (job.status !== "running") {
        assert.equal(job.status, "succeeded", JSON.stringify(job));
        return job.result;
      }
      await pause();
    }
    throw Error(
      "Small mirror fixture job did not settle within bounded polling",
    );
  };
  const modelBefore = await state();
  const modelUnchanged = async () => {
    const next = await state();
    assert.deepEqual(next.objects, modelBefore.objects);
    assert.equal(next.undo, modelBefore.undo);
    assert.equal(next.redo, modelBefore.redo);
  };
  const assertLiteralReflection = (before, after, result) => {
    assert.equal(result.changed, true);
    assert.deepEqual(after.frame, before.frame);
    assert.deepEqual(
      after.constraints,
      before.constraints,
      "Original fixed constraint preserved; none copied",
    );
    assert.deepEqual(
      after.points.slice(0, before.points.length),
      before.points,
    );
    assert.deepEqual(
      after.segments.slice(0, before.segments.length),
      before.segments,
    );
    assert.deepEqual(after.arcs.slice(0, before.arcs.length), before.arcs);
    assert.equal(after.points.length, before.points.length + 5);
    assert.equal(after.segments.length, before.segments.length + 1);
    assert.equal(after.arcs.length, before.arcs.length + 2);
    assert.deepEqual(Object.keys(result.pointMap).sort(), [
      "a",
      "b",
      "center",
      "left",
      "right",
    ]);
    assert.deepEqual(Object.keys(result.curveMap).sort(), [
      "line",
      "lower",
      "upper",
    ]);
    assert.equal(new Set(result.createdPointIds).size, 5);
    assert.equal(new Set(result.createdCurveIds).size, 3);
    assert.deepEqual(
      new Set(result.createdPointIds),
      new Set(Object.values(result.pointMap)),
    );
    assert.deepEqual(
      result.createdCurveIds,
      request.curveIds.map((id) => result.curveMap[id]),
    );
    const expected = {
      a: [-2, 1],
      b: [-4, 3],
      center: [-3, 0],
      left: [-1, 0],
      right: [-5, 0],
    };
    for (const [id, xy] of Object.entries(expected)) {
      const point = after.points.find((p) => p.id === result.pointMap[id]);
      assert(point);
      assert.deepEqual([point.x, point.y], xy);
    }
    const line = after.segments.find((c) => c.id === result.curveMap.line);
    assert.deepEqual(line, {
      id: result.curveMap.line,
      a: result.pointMap.a,
      b: result.pointMap.b,
      construction: false,
    });
    const upper = after.arcs.find((c) => c.id === result.curveMap.upper);
    const lower = after.arcs.find((c) => c.id === result.curveMap.lower);
    assert.deepEqual(upper, {
      id: result.curveMap.upper,
      a: result.pointMap.right,
      b: result.pointMap.left,
      center: result.pointMap.center,
      clockwise: true,
      construction: true,
    });
    assert.deepEqual(lower, {
      id: result.curveMap.lower,
      a: result.pointMap.left,
      b: result.pointMap.right,
      center: result.pointMap.center,
      clockwise: true,
    });
    assert.equal(upper.center, lower.center);
    assert.equal(upper.a, lower.b);
    assert.equal(upper.b, lower.a);
    const allIds = [
      ...after.points,
      ...after.segments,
      ...after.arcs,
      ...after.constraints,
    ].map((v) => v.id);
    assert.equal(new Set(allIds).size, allIds.length);
    for (const id of result.createdPointIds)
      assert(!before.points.some((p) => p.id === id));
  };
  ledger.sketchMirror = {
    scope: "PUBLIC_ANALYTIC_MIRROR_COPY_GUI_MCP_HISTORY",
    nativeAcceptance: false,
    planes: [],
    failures: [],
  };
  const panel = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  const saved = [];
  for (const { plane, frame } of frames) {
    signal.throwIfAborted();
    const before = fixture(frame);
    const created = await mutate("sketch_manage", {
      action: "create",
      name: `Mirror ${plane}`,
      sketch: before,
    });
    const sketchId = created.result.sketchId;
    assert.equal(typeof sketchId, "string");
    await mutate("ui_set", {
      workspace: "sketch",
      ribbonTab: "sketch",
      toolPanelOpen: true,
    });
    await panel.waitFor();
    assert.deepEqual((await read()).sketch, before);
    const args = {
      ...request,
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    };
    const receipt = await raw("sketch_mirror", args);
    const result = await operationResult(receipt),
      after = (await read()).sketch;
    assertLiteralReflection(before, after, result);
    const revisionAfter = (await call("project_get")).revision;
    assert.deepEqual(
      await raw("sketch_mirror", args),
      receipt,
      "Exact retry retains original receipt",
    );
    assert.equal((await call("project_get")).revision, revisionAfter);
    assert.deepEqual((await read()).sketch, after);
    await modelUnchanged();
    await mutate("history_undo", { scope: "sketch" });
    assert.deepEqual(
      (await read()).sketch,
      before,
      "Single sketch undo removes full mirror copy",
    );
    const mirror = panel.getByRole("group", {
      name: "Mirror geometry",
      exact: true,
    });
    await mirror
      .getByRole("button", { name: "Mirror axis", exact: true })
      .click();
    await page.getByRole("option", { name: "axis", exact: true }).click();
    assert.equal(
      await mirror
        .getByRole("checkbox", { name: "Mirror axis · line", exact: true })
        .count(),
      0,
    );
    for (const id of ["line", "upper", "lower"])
      await mirror
        .getByRole("checkbox", {
          name: `Mirror ${id} · ${id === "line" ? "line" : "arc"}`,
          exact: true,
        })
        .check();
    await mirror
      .getByRole("button", { name: "Mirror selected", exact: true })
      .click();
    await eventually(async () =>
      assert.deepEqual((await read()).sketch, after),
    );
    await eventually(async () =>
      assert.equal((await call("session_get")).result.busy, false),
    );
    await panel
      .getByRole("button", { name: "Undo sketch edit", exact: true })
      .click();
    await eventually(async () =>
      assert.deepEqual((await read()).sketch, before),
    );
    await mutate("history_redo", { scope: "sketch" });
    assert.deepEqual((await read()).sketch, after);
    await modelUnchanged();
    saved.push({ sketchId, before, after });
    ledger.sketchMirror.planes.push({
      plane,
      frame,
      sketchId,
      literalUVAndArcOrientation: true,
      originalConstraintsPreserved: true,
      deterministicGuiMcpEquality: true,
      oneSketchUndoRedo: true,
      modelHistoryUnchanged: true,
      exactRetry: true,
    });
    await save();
  }
  const rejectAtomic = async (name, args, expectedCode) => {
    const prior = await read(),
      project = await call("project_get");
    const reply = await raw("sketch_mirror", {
      ...args,
      expectedRevision: project.revision,
      requestId: randomUUID(),
    });
    assert.equal(reply.ok, false, name);
    if (expectedCode) assert.equal(reply.error.code, expectedCode);
    assert.equal((await call("project_get")).revision, project.revision);
    assert.deepEqual(await read(), prior);
    await modelUnchanged();
    ledger.sketchMirror.failures.push({
      name,
      atomic: true,
      code: reply.error.code,
    });
  };
  await rejectAtomic("unknown-axis", { ...request, axis: "missing-axis" });
  await rejectAtomic("axis-must-be-construction", {
    ...request,
    axis: "line",
    curveIds: ["upper"],
  });
  await rejectAtomic("empty-selection", { axis: "axis", curveIds: [] });
  const stale = (await call("project_get")).revision;
  await mutate("sketch_manage", {
    action: "activate",
    sketchId: saved[0].sketchId,
  });
  const prior = await read(),
    project = await call("project_get");
  const rejected = await raw("sketch_mirror", {
    ...request,
    expectedRevision: stale,
    requestId: randomUUID(),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "REVISION_CONFLICT");
  assert.equal((await call("project_get")).revision, project.revision);
  assert.deepEqual(await read(), prior);
  // Undo A must not affect B's independent authoring session.
  await mutate("history_undo", { scope: "sketch" });
  let current = await read();
  assert.deepEqual(current.sketch, saved[0].before);
  assert.deepEqual(
    current.sketches.find((s) => s.id === saved[1].sketchId).sketch,
    saved[1].after,
  );
  await mutate("sketch_manage", {
    action: "activate",
    sketchId: saved[1].sketchId,
  });
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual((await read()).sketch, saved[1].before);
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await read()).sketch, saved[1].after);
  // Deleting the active saved sketch selects the existing legacy draft by shared contract.
  await mutate("sketch_manage", {
    action: "delete",
    sketchId: saved[1].sketchId,
  });
  assert(!(await read()).activeSketchId);
  const legacy = fixture(frames[0].frame);
  await mutate("sketch_set", { sketch: legacy });
  const legacyResult = await operationResult(
    await mutate("sketch_mirror", request),
  );
  const legacyAfter = (await read()).sketch;
  assertLiteralReflection(legacy, legacyAfter, legacyResult);
  await mutate("history_undo", { scope: "sketch" });
  assert.deepEqual((await read()).sketch, legacy);
  await mutate("history_redo", { scope: "sketch" });
  assert.deepEqual((await read()).sketch, legacyAfter);
  await modelUnchanged();
  Object.assign(ledger.sketchMirror, {
    savedAndLegacyHistoryIsolated: true,
    staleRevisionAtomic: true,
    nativeAcceptance: false,
    meaning:
      "Three offset-plane analytic mirror-copy fixtures through real GUI and public MCP; no native numerical or visual fidelity claim",
  });
  await save();
}

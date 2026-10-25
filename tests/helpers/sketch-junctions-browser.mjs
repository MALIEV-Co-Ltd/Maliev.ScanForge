import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Runs through rendered controls and the public stdio MCP bridge only.
export async function sketchJunctions({
  page,
  call,
  raw,
  mutate,
  tools,
  ledger,
  save,
  signal,
}) {
  for (const name of [
    "sketch_mirror",
    "cad_create",
    "alignment_references",
    "mesh_analyze",
    "object_get",
  ])
    assert(
      tools.some((tool) => tool.name === name),
      `Missing ${name}`,
    );
  const pause = () => new Promise((resolve) => setTimeout(resolve, 75));
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
    throw Error("Synthetic CAD job exceeded bounded polling");
  }
  async function eventually(check) {
    for (let i = 0; i < 120; i++) {
      signal.throwIfAborted();
      if (await check()) return;
      await pause();
    }
    throw Error("Rendered CAD workflow did not settle");
  }
  const panel = page.getByRole("region", {
    name: "Parametric sketch",
    exact: true,
  });
  const frames = [
    {
      plane: "OXY",
      frame: {
        origin: [0, 0, 12],
        u: [1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, 1],
      },
      min: [0, -30, 12],
      max: [40, 30, 32],
    },
    {
      plane: "OYZ",
      frame: {
        origin: [13, 0, 0],
        u: [0, 1, 0],
        v: [0, 0, 1],
        normal: [1, 0, 0],
      },
      min: [13, 0, -30],
      max: [33, 40, 30],
    },
    {
      plane: "OXZ",
      frame: {
        origin: [0, -7, 0],
        u: [0, 0, 1],
        v: [1, 0, 0],
        normal: [0, 1, 0],
      },
      min: [-30, -7, 0],
      max: [30, 13, 40],
    },
  ];
  const base = (frame) => ({
    version: 1,
    frame,
    points: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 40, y: 0 },
      { id: "c", x: 40, y: 30 },
      { id: "d", x: 0, y: 30 },
    ],
    segments: [
      { id: "axis", a: "a", b: "b", construction: true },
      { id: "right", a: "b", b: "c" },
      { id: "top", a: "c", b: "d" },
      { id: "left", a: "d", b: "a" },
    ],
    constraints: [],
  });
  ledger.sketchJunctions = {
    scope: "EXACT_ENDPOINT_PROFILE_GUI_MCP_CAD",
    nativeAcceptance: false,
    planes: [],
  };
  for (const entry of frames) {
    const { plane, frame } = entry;
    await mutate("sketch_manage", {
      action: "create",
      name: `Junction ${plane}`,
      sketch: base(frame),
    });
    await mutate("ui_set", {
      workspace: "sketch",
      ribbonTab: "sketch",
      toolPanelOpen: true,
    });
    await panel.waitFor();
    await settled(
      await mutate("sketch_mirror", {
        axis: "axis",
        curveIds: ["right", "top", "left"],
      }),
    );
    const original = (await call("sketch_get")).result.sketch;
    assert.equal(original.points.length, 8);
    assert.equal(original.segments.length, 7);
    assert.equal(new Set(original.points.map((point) => point.id)).size, 8);
    const recipe = (kind) => ({
      kind: "extrude",
      height: 20,
      profile: { kind, sketch: original },
    });
    const request = {
      name: `MCP ${plane}`,
      recipe: recipe("sketch-curves"),
      expectedRevision: (await call("project_get")).revision,
      requestId: randomUUID(),
    };
    const receipt = await raw("cad_create", request);
    const exact = await settled(receipt);
    assert.deepEqual(
      await raw("cad_create", request),
      receipt,
      "CAD retry must not duplicate the body",
    );
    const legacy = await settled(
      await mutate("cad_create", {
        name: `Legacy ${plane}`,
        recipe: recipe("sketch"),
      }),
    );
    const beforeGui = (await call("project_get")).result;
    await panel.getByLabel("Extrusion height", { exact: true }).fill("20");
    await panel
      .getByRole("button", { name: "Extrude solved profile", exact: true })
      .click();
    let afterGui;
    await eventually(async () => {
      const project = (await call("project_get")).result;
      if (
        project.objects.length !== beforeGui.objects.length + 1 ||
        (await call("session_get")).result.busy
      )
        return false;
      afterGui = project;
      return true;
    });
    assert.equal(afterGui.undo, beforeGui.undo + 1);
    const guiId = afterGui.objects.find(
      (object) => !beforeGui.objects.some((old) => old.id === object.id),
    ).id;
    const ids = [exact.entityIds[0], legacy.entityIds[0], guiId];
    const descriptions = [];
    for (const id of ids) {
      const object = (await call("object_get", { entityId: id })).result;
      assert.equal(object.exactCad, true);
      assert.equal(object.hasBrep, true);
      const refs = await settled(
        await call("alignment_references", { entityId: id }),
      );
      assert.equal(refs.nextOffset, null);
      assert(
        refs.references.length >= 6 &&
          refs.references.every(
            (ref) => ref.source === "cadFace" && ref.surfaceKind === "plane",
          ),
      );
      const planes = refs.references
        .map((ref) => {
          const axis = ref.direction.findIndex((v) => Math.abs(v) > 1 - 1e-8);
          assert(axis >= 0);
          return [axis, ref.point[axis]];
        })
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const stats = (
        await settled(await call("mesh_analyze", { entityId: id }))
      ).stats;
      for (let axis = 0; axis < 3; axis++) {
        assert(Math.abs(stats.min[axis] - entry.min[axis]) < 1e-5);
        assert(Math.abs(stats.max[axis] - entry.max[axis]) < 1e-5);
      }
      assert(
        Math.abs(stats.volume - 48000) < 0.01,
        "Tessellated box volume must match literal 48000 mm³ within 0.01 mm³",
      );
      descriptions.push({
        id,
        planes,
        meshVolume: stats.volume,
        min: stats.min,
        max: stats.max,
      });
    }
    assert.deepEqual(descriptions[0].planes, descriptions[1].planes);
    assert.deepEqual(descriptions[0].planes, descriptions[2].planes);
    assert.deepEqual(
      (await call("sketch_get")).result.sketch,
      original,
      "Extrusion must preserve authored endpoint IDs",
    );
    await mutate("history_undo", { scope: "model" });
    assert.equal(
      (await call("project_get")).result.objects.length,
      beforeGui.objects.length,
    );
    await mutate("history_redo", { scope: "model" });
    assert.equal(
      (await call("project_get")).result.objects.length,
      afterGui.objects.length,
    );
    ledger.sketchJunctions.planes.push({
      plane,
      frame,
      guiMcpLegacyFaceEquality: true,
      sourceGraphPreserved: true,
      oneModelUndoRedo: true,
      exactRetry: true,
      expectedVolumeMm3: 48000,
      volumeObservation: "Tessellation-derived; exact CAD mass is not exposed",
      meshVolumeToleranceMm3: 0.01,
      descriptions,
    });
    save();
  }
  const savedSketch = (await call("sketch_get")).result;
  const savedCount = (await call("project_get")).result.objects.length;
  const exported = await settled(
    await call("project_export", { format: "project" }),
  );
  await settled(
    await mutate("project_import", {
      artifactId: exported.artifactId,
      replace: true,
    }),
  );
  assert.equal((await call("project_get")).result.objects.length, savedCount);
  assert.deepEqual((await call("sketch_get")).result, savedSketch);
  await mutate("ui_set", {
    workspace: "sketch",
    ribbonTab: "sketch",
    toolPanelOpen: true,
  });
  await panel.waitFor();
  ledger.sketchJunctions.saveReopenPreservesGraph = true;
  ledger.sketchJunctions.completedWorkflowPassed = true;
  save();
}

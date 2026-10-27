import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { SketchUndo } from "../src/sketch-undo";
import { coordinateSketchFrame } from "../src/sketch-frame";
import { parseProject, serializeProject } from "../src/io";
import { rectangleSketch, type Sketch } from "../src/sketch";

const apis: ApplicationApi[] = [];
afterEach(() => apis.splice(0).forEach((api) => api.dispose()));
function sketch(): Sketch {
  return {
    version: 1,
    points: [
      { id: "a", x: 10, y: 0 },
      { id: "b", x: -10, y: 0 },
      { id: "c", x: 0, y: 0 },
    ],
    segments: [{ id: "s", a: "a", b: "b" }],
    arcs: [],
    constraints: [],
    frame: coordinateSketchFrame("OYZ", 12),
    reference: {
      kind: "section",
      sourceId: "scan",
      axis: "x",
      offset: 12,
      onSlicingPlane: true,
      selectedOnly: false,
      sampled: false,
      segments: [0, 0, 20, 0],
    },
  };
}
function setup() {
  const draft = sketch(),
    other = rectangleSketch(12, 9),
    legacy = rectangleSketch(7, 6);
  const state: WorkspaceSnapshot = {
    name: "Semantic edits",
    entities: [],
    history: [],
    future: [],
    selectedId: null,
    selection: null,
    settings: { snapGrid: true, gridSpacing: 10 },
    sketchDraft: draft,
    authoring: {
      sketch: legacy,
      activeSketchId: "a",
      sketches: [
        { id: "a", name: "A", sketch: draft },
        { id: "b", name: "B", sketch: other },
      ],
    },
  };
  const histories = new Map<string, SketchUndo>();
  const key = () =>
    state.authoring.activeSketchId
      ? `saved:${state.authoring.activeSketchId}`
      : "legacy";
  const publish = (next: Sketch) => {
    state.sketchDraft = next;
    if (state.authoring.activeSketchId)
      state.authoring.sketches = state.authoring.sketches!.map((item) =>
        item.id === state.authoring.activeSketchId
          ? { ...item, sketch: next }
          : item,
      );
    else state.authoring.sketch = next;
  };
  const setSketch = vi.fn((next: Sketch) => {
    let history = histories.get(key());
    if (!history) {
      history = new SketchUndo();
      histories.set(key(), history);
    }
    history.record(state.sketchDraft ?? state.authoring.sketch!, next);
    publish(next);
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    busy: () => false,
    activity: vi.fn(),
    setSketch,
    cad: () => {
      throw Error("Semantic sketch edits need no CAD");
    },
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
    showReferenceConstructionPreview: vi.fn(),
    stepSketchHistory: (repeat) => {
      const history = histories.get(key());
      const next = repeat
        ? history?.redo(state.sketchDraft!)
        : history?.undo(state.sketchDraft!);
      if (!next) return false;
      publish(next);
      return true;
    },
  };
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  const edit = (intent: Record<string, unknown>) =>
    api.invoke("sketch_edit", {
      ...intent,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  const history = (repeat = false) =>
    api.invoke(repeat ? "history_redo" : "history_undo", {
      scope: "sketch",
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { api, state, host, setSketch, edit, history, other, legacy };
}
async function value(
  promise: ReturnType<ApplicationApi["invoke"]>,
): Promise<any> {
  const reply = await promise;
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  if (!reply.ok) throw Error(reply.error.message);
  return reply.result;
}

it("discovers one strict semantic edit command instead of requiring a replacement graph", async () => {
  const h = setup(),
    result = await value(
      h.api.invoke("tools_search", {
        query: "sketch_edit",
        includeSchemas: true,
      }),
    );
  const tool = result.tools.find((row: any) => row.name === "sketch_edit");
  expect(tool).toBeDefined();
  const schema = JSON.stringify(tool.inputSchema);
  for (const arm of [
    "preset",
    "planeOffset",
    "pointSet",
    "arcSet",
    "construction",
    "dimension",
    "constraintAdd",
    "solve",
  ])
    expect(schema).toContain(arm);
  expect(schema).not.toContain('"sketch"');
});

it.each(["rectangle", "circle"])(
  "creates the %s preset through the current saved draft while retaining placement/reference",
  async (profile) => {
    const h = setup(),
      frame = h.state.sketchDraft!.frame,
      reference = h.state.sketchDraft!.reference;
    const result = await value(h.edit({ kind: "preset", profile }));
    expect(result).toMatchObject({
      changed: true,
      units: "mm",
      coordinateSystem: "sketch-local-UV",
    });
    expect(h.state.sketchDraft!.frame).toEqual(frame);
    expect(h.state.sketchDraft!.reference).toBe(reference);
    expect(h.state.authoring.sketches![0].sketch).toBe(h.state.sketchDraft);
    expect(h.state.authoring.sketches![1].sketch).toBe(h.other);
    expect(h.state.authoring.sketch).toBe(h.legacy);
    expect(h.state.entities).toEqual([]);
    expect(h.state.history).toEqual([]);
    expect(h.host.commit).not.toHaveBeenCalled();
    expect(h.setSketch).toHaveBeenCalledOnce();
  },
);

it("keeps numeric coordinate edits unsnapped and unsolved while returning server-created IDs", async () => {
  const h = setup();
  const added = await value(
    h.edit({ kind: "pointAdd", position: [0.125, -0.25] }),
  );
  expect(added.createdPointIds).toHaveLength(1);
  const id = added.createdPointIds[0];
  expect(
    h.state.sketchDraft!.points.find((point) => point.id === id),
  ).toMatchObject({ x: 0.125, y: -0.25 });
  await value(h.edit({ kind: "pointSet", pointId: id, x: 0.333333333 }));
  expect(
    h.state.sketchDraft!.points.find((point) => point.id === id),
  ).toMatchObject({ x: 0.333333333, y: -0.25 });
  expect(h.state.settings).toEqual({ snapGrid: true, gridSpacing: 10 });
});

it("shares numeric segment/arc topology, direction and construction edits through MCP", async () => {
  const h = setup();
  const segment = await value(h.edit({ kind: "segmentAdd", a: "b", b: "c" }));
  const segmentId = segment.createdCurveIds[0];
  await value(h.edit({ kind: "segmentSet", segmentId, a: "a" }));
  await value(
    h.edit({ kind: "construction", curveId: segmentId, enabled: true }),
  );
  expect(
    h.state.sketchDraft!.segments.find((curve) => curve.id === segmentId),
  ).toMatchObject({ a: "a", b: "c", construction: true });
  const arc = await value(
    h.edit({ kind: "arcAdd", a: "a", b: "b", center: "c" }),
  );
  const arcId = arc.createdCurveIds[0];
  await value(h.edit({ kind: "arcSet", arcId, clockwise: true }));
  await value(h.edit({ kind: "construction", curveId: arcId, enabled: true }));
  expect(
    h.state.sketchDraft!.arcs!.find((curve) => curve.id === arcId),
  ).toMatchObject({
    a: "a",
    b: "b",
    center: "c",
    clockwise: true,
    construction: true,
  });
  const removed = await value(
    h.edit({ kind: "remove", target: "point", id: "a" }),
  );
  expect(removed.removedCurveIds).toEqual(
    expect.arrayContaining(["s", segmentId, arcId]),
  );
  expect(h.state.sketchDraft!.segments).toEqual([]);
  expect(h.state.sketchDraft!.arcs).toEqual([]);
});

it("preserves custom orientation and reference ownership when changing offset then origin plane", async () => {
  const h = setup(),
    source = h.state.sketchDraft!;
  source.frame = {
    origin: [11, -23, 17],
    u: [0.6, 0.8, 0],
    v: [-0.8, 0.6, 0],
    normal: [0, 0, 1],
  };
  await value(h.edit({ kind: "planeOffset", offsetMm: 27 }));
  expect(h.state.sketchDraft!.frame).toEqual({
    ...source.frame,
    origin: [11, -23, 27],
  });
  await value(h.edit({ kind: "plane", plane: "OXZ" }));
  expect(h.state.sketchDraft!.frame).toEqual(coordinateSketchFrame("OXZ", 27));
  expect(h.state.sketchDraft!.reference).toBe(source.reference);
});

it("constructs constraints server-side, changes dimensions without auto-solve, and solves only on request", async () => {
  const h = setup();
  await value(h.edit({ kind: "preset", profile: "rectangle" }));
  const before = structuredClone(h.state.sketchDraft!.points);
  await value(h.edit({ kind: "dimension", constraintId: "c6", value: 17 }));
  expect(h.state.sketchDraft!.points).toEqual(before);
  const solved = await value(h.edit({ kind: "solve" }));
  expect(solved.solution.converged).toBe(true);
  const [a, b] = h.state.sketchDraft!.points;
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(17, 5);
  const relation = await value(
    h.edit({
      kind: "constraintAdd",
      constraint: { kind: "fixed", point: "p2" },
    }),
  );
  expect(relation.createdConstraintIds).toHaveLength(1);
  expect(h.state.sketchDraft!.constraints.at(-1)).toMatchObject({
    kind: "fixed",
    point: "p2",
    x: b.x,
    y: b.y,
  });
});

it("keeps failed constraint addition atomic and leaves the prior scoped undo available", async () => {
  const h = setup();
  await value(h.edit({ kind: "preset", profile: "rectangle" }));
  const before = h.state.sketchDraft,
    revision = h.api.currentRevision();
  const rejected = await h.edit({
    kind: "constraintAdd",
    constraint: { kind: "distance", a: "p1", b: "p2", value: 10 },
  });
  expect(rejected).toMatchObject({
    ok: false,
    error: { code: "OPERATION_FAILED" },
  });
  expect(h.state.sketchDraft).toBe(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.setSketch).toHaveBeenCalledOnce();
  await value(h.history());
  expect(h.state.sketchDraft!.points.map((point) => point.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
});

it("returns a server-built closed solved profile after one successful shared preparation", async () => {
  const h = setup();
  await value(h.edit({ kind: "preset", profile: "rectangle" }));
  await value(h.edit({ kind: "dimension", constraintId: "c6", value: 17 }));
  h.setSketch.mockClear();
  const prepared = await value(h.edit({ kind: "solve", forProfile: true }));
  expect(prepared.solution.converged).toBe(true);
  expect(prepared.profile).toEqual({
    kind: "sketch-curves",
    sketch: h.state.sketchDraft,
  });
  expect(h.setSketch).toHaveBeenCalledOnce();
});

it("does not publish a solved candidate when profile preparation fails on an open boundary", async () => {
  const h = setup();
  await value(h.edit({ kind: "preset", profile: "rectangle" }));
  await value(h.edit({ kind: "dimension", constraintId: "c6", value: 17 }));
  await value(h.edit({ kind: "remove", target: "segment", id: "s4" }));
  const before = h.state.sketchDraft,
    revision = h.api.currentRevision();
  h.setSketch.mockClear();
  expect(await h.edit({ kind: "solve", forProfile: true })).toMatchObject({
    ok: false,
  });
  expect(h.state.sketchDraft).toBe(before);
  expect(h.state.sketchDraft!.points[1].x).toBe(40);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.setSketch).not.toHaveBeenCalled();
});

it("does not publish semantic noops or replace another sketch's scoped history", async () => {
  const h = setup();
  await value(h.edit({ kind: "pointSet", pointId: "a", x: 11 }));
  const revision = h.api.currentRevision();
  expect(
    await value(h.edit({ kind: "pointSet", pointId: "a", x: 11 })),
  ).toMatchObject({ changed: false });
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.setSketch).toHaveBeenCalledOnce();
  h.state.authoring.activeSketchId = "b";
  h.state.sketchDraft = h.other;
  await value(h.edit({ kind: "pointSet", pointId: "p2", x: 13 }));
  await value(h.history());
  expect(
    h.state.sketchDraft!.points.find((point) => point.id === "p2")!.x,
  ).toBe(12);
  h.state.authoring.activeSketchId = "a";
  h.state.sketchDraft = h.state.authoring.sketches![0].sketch;
  await value(h.history());
  expect(h.state.sketchDraft!.points.find((point) => point.id === "a")!.x).toBe(
    10,
  );
  expect(h.state.history).toEqual([]);
});

it("retains retry/revision guards and publishes one edit on repeated requests", async () => {
  const h = setup();
  const request = {
    kind: "pointAdd",
    expectedRevision: h.api.currentRevision(),
    requestId: "add-once",
  };
  const first = await h.api.invoke("sketch_edit", request);
  expect(first.ok, JSON.stringify(first)).toBe(true);
  expect(await h.api.invoke("sketch_edit", request)).toEqual(first);
  expect(h.setSketch).toHaveBeenCalledOnce();
  expect(
    await h.api.invoke("sketch_edit", { ...request, position: [1, 2] }),
  ).toMatchObject({ ok: false, error: { code: "REQUEST_CONFLICT" } });
  expect(
    await h.api.invoke("sketch_edit", {
      ...request,
      requestId: "stale",
      expectedRevision: h.api.currentRevision() + 1,
    }),
  ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
});

it.each([
  { kind: "pointSet", pointId: "a", x: 1, sketch: {} },
  { kind: "preset", profile: "circle", points: [] },
  { kind: "pointAdd", id: "caller-id" },
  { kind: "pointSet", pointId: "a" },
  { kind: "segmentAdd", a: "a" },
])(
  "rejects invalid/ambiguous semantic request $kind without modifying the draft",
  async (intent) => {
    const h = setup(),
      before = h.state.sketchDraft;
    expect(await h.edit(intent)).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(h.state.sketchDraft).toBe(before);
    expect(h.setSketch).not.toHaveBeenCalled();
  },
);

it("requires normal mutation revision/request guards before semantic editing", async () => {
  const h = setup();
  expect(await h.api.invoke("sketch_edit", { kind: "pointAdd" })).toMatchObject(
    { ok: false, error: { code: "INVALID_ARGUMENT" } },
  );
  expect(h.setSketch).not.toHaveBeenCalled();
});

it("reports bounded Solve resource failure without replacing the accepted large draft", async () => {
  const h = setup();
  const large: Sketch = {
    version: 1,
    points: Array.from({ length: 1024 }, (_, index) => ({
      id: `large-${index}`,
      x: index,
      y: 0,
    })),
    segments: [],
    constraints: [],
  };
  h.state.sketchDraft = large;
  expect(await h.edit({ kind: "solve" })).toMatchObject({
    ok: false,
    error: { code: "RESOURCE_LIMIT" },
  });
  expect(h.state.sketchDraft).toBe(large);
  expect(h.setSketch).not.toHaveBeenCalled();
});

it("rejects missing active draft without creating an implicit replacement sketch", async () => {
  const h = setup();
  h.state.sketchDraft = undefined;
  h.state.authoring = {};
  expect(await h.edit({ kind: "preset", profile: "circle" })).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/active sketch/i) },
  });
  expect(h.setSketch).not.toHaveBeenCalled();
});

it("preserves an owned reference preview when semantic sketch edits reject BUSY", async () => {
  const h = setup();
  const preview = await value(
    h.api.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      position: [1, 2, 3],
      expectedRevision: h.api.currentRevision(),
      requestId: "reference-preview",
    }),
  );
  expect(await h.edit({ kind: "pointAdd" })).toMatchObject({
    ok: false,
    error: { code: "BUSY" },
  });
  expect(await value(h.api.invoke("reference_construction_get"))).toMatchObject(
    { active: true, sessionId: preview.sessionId },
  );
  expect(h.setSketch).not.toHaveBeenCalled();
});

it("retains edited saved geometry, placement/reference and legacy state through JSON project roundtrip", async () => {
  const h = setup();
  await value(h.edit({ kind: "pointSet", pointId: "a", x: 10 + 2 ** -40 }));
  await value(h.edit({ kind: "construction", curveId: "s", enabled: true }));
  const restored = parseProject(
    serializeProject(h.state.name, [], h.state.authoring),
  );
  expect(restored.authoring).toEqual(h.state.authoring);
  expect(h.state.authoring.sketch).toBe(h.legacy);
  expect(h.state.authoring.sketches![1].sketch).toBe(h.other);
});

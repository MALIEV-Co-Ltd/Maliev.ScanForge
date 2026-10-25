import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { SketchUndo } from "../src/sketch-undo";
import type { Sketch } from "../src/sketch";
import { coordinateSketchFrame } from "../src/sketch-frame";
import { parseProject, serializeProject } from "../src/io";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
});
const blank = (): Sketch => ({
  version: 1,
  points: [],
  segments: [],
  arcs: [],
  constraints: [],
  frame: coordinateSketchFrame("OYZ", 12),
});
function setup() {
  const initial = blank();
  const state: WorkspaceSnapshot = {
    name: "Draw",
    entities: [],
    history: [],
    future: [],
    selectedId: null,
    selection: null,
    settings: { snapGrid: true, gridSpacing: 1 },
    sketchDraft: initial,
    authoring: {
      activeSketchId: "a",
      sketches: [{ id: "a", name: "A", sketch: initial }],
    },
  };
  const history = new SketchUndo();
  const publish = (sketch: Sketch) => {
    state.sketchDraft = sketch;
    state.authoring.sketches = state.authoring.sketches!.map((item) =>
      item.id === state.authoring.activeSketchId ? { ...item, sketch } : item,
    );
  };
  const setSketch = vi.fn((next: Sketch) => {
    history.record(state.sketchDraft!, next);
    publish(next);
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("No CAD required");
    },
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch,
    view: vi.fn(),
    settings: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
    stepSketchHistory: (repeat) => {
      const next = repeat
        ? history.redo(state.sketchDraft!)
        : history.undo(state.sketchDraft!);
      if (!next) return false;
      publish(next);
      return true;
    },
    showReferenceConstructionPreview: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
  };
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  const draw = (args: Record<string, unknown>) =>
    api.invoke("sketch_draw", {
      ...args,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { state, api, host, setSketch, draw };
}
async function value(p: ReturnType<ApplicationApi["invoke"]>): Promise<any> {
  const reply = await p;
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  if (!reply.ok) throw Error(reply.error.message);
  return reply.result;
}
const line = {
  kind: "line",
  points: [
    [0.2, 0.2],
    [15.2, 0.2],
  ],
  autoConstraints: true,
  snapToleranceMm: 0.5,
};
it("discovers semantic draw inputs and appends snapped lines with shared endpoints and auto constraints", async () => {
  const h = setup();
  const discovered = await value(
    h.api.invoke("tools_search", {
      query: "sketch_draw",
      includeSchemas: true,
    }),
  );
  expect(
    discovered.tools.some((tool: any) => tool.name === "sketch_draw"),
  ).toBe(true);
  const first = await value(h.draw(line));
  expect(first).toMatchObject({
    changed: true,
    usedPoints: [
      [0, 0],
      [15, 0],
    ],
  });
  expect(first.createdCurveIds).toHaveLength(1);
  expect(first.createdPointIds).toHaveLength(2);
  const before = h.state.sketchDraft!,
    end = before.segments[0].b;
  expect(before.constraints.map((c) => c.kind).sort()).toEqual([
    "fixed",
    "horizontal",
  ]);
  const second = await value(
    h.draw({
      ...line,
      points: [
        [15.2, 0.2],
        [15.2, 10.2],
      ],
    }),
  );
  expect(second.createdPointIds).toHaveLength(1);
  expect(h.state.sketchDraft!.points).toHaveLength(3);
  expect(h.state.sketchDraft!.segments[1].a).toBe(end);
  expect(h.state.sketchDraft!.constraints.at(-1)!.kind).toBe("vertical");
  expect(before.points).toHaveLength(2);
  expect(h.setSketch).toHaveBeenCalledTimes(2);
  expect(h.host.commit).not.toHaveBeenCalled();
});
it.each(["circle", "circle3", "arc3"])(
  "constructs %s directly from numeric intent without agent curve math",
  async (kind) => {
    const h = setup();
    const result = await value(
      h.draw({
        kind,
        points:
          kind === "circle"
            ? [
                [10.2, 0.2],
                [15.2, 0.2],
              ]
            : [
                [5.2, 0.2],
                [10.2, 5.2],
                [15.2, 0.2],
              ],
      }),
    );
    const sketch = h.state.sketchDraft!,
      arcs = sketch.arcs!;
    expect(arcs).toHaveLength(kind === "arc3" ? 1 : 2);
    expect(result.createdCurveIds).toEqual(arcs.map((a) => a.id));
    const center = sketch.points.find((p) => p.id === arcs[0].center)!;
    expect([center.x, center.y]).toEqual([10, 0]);
    const start = sketch.points.find((p) => p.id === arcs[0].a)!;
    expect(Math.hypot(start.x - center.x, start.y - center.y)).toBe(5);
    if (kind === "arc3") expect(arcs[0].clockwise).toBe(true);
    else {
      expect(arcs[0].a).toBe(arcs[1].b);
      expect(arcs[0].b).toBe(arcs[1].a);
    }
    expect(sketch.constraints).toEqual([]);
    expect(sketch.frame).toEqual(blank().frame);
    expect(h.setSketch).toHaveBeenCalledOnce();
  },
);
it("uses explicit line choices with grid disabled and exposes endpoint movement atomically", async () => {
  const h = setup();
  h.state.settings.snapGrid = false;
  await value(
    h.draw({
      ...line,
      points: [
        [0.2, 0.2],
        [15.2, 0.2],
      ],
      autoConstraints: false,
      snapToleranceMm: 0,
    }),
  );
  const source = h.state.sketchDraft!;
  expect(source.points.map((p) => [p.x, p.y])).toEqual([
    [0.2, 0.2],
    [15.2, 0.2],
  ]);
  expect(source.constraints).toEqual([]);
  await value(
    h.draw({
      kind: "move",
      pointId: source.segments[0].b,
      position: [20.25, 4.5],
    }),
  );
  expect(
    h.state.sketchDraft!.points.find((p) => p.id === source.segments[0].b),
  ).toMatchObject({ x: 20.25, y: 4.5 });
  expect(h.state.sketchDraft!.constraints).toEqual([]);
  expect(source.points[1]).toMatchObject({ x: 15.2, y: 0.2 });
});
it("uses one scoped history edit, exact retry receipts and stale revision/active-owner guards", async () => {
  const h = setup(),
    before = h.state.sketchDraft;
  const args = {
    ...line,
    expectedRevision: h.api.currentRevision(),
    requestId: "draw-once",
  };
  const first = await value(h.api.invoke("sketch_draw", args)),
    after = h.state.sketchDraft;
  expect(await value(h.api.invoke("sketch_draw", args))).toEqual(first);
  expect(h.setSketch).toHaveBeenCalledOnce();
  expect(
    await h.api.invoke("sketch_draw", { ...args, requestId: "stale" }),
  ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  expect(
    await h.api.invoke("sketch_draw", {
      ...args,
      points: [
        [0, 0],
        [10, 0],
      ],
    }),
  ).toMatchObject({ ok: false, error: { code: "REQUEST_CONFLICT" } });
  await value(
    h.api.invoke("history_undo", {
      scope: "sketch",
      expectedRevision: h.api.currentRevision(),
      requestId: "undo-draw",
    }),
  );
  expect(h.state.sketchDraft).toEqual(before);
  await value(
    h.api.invoke("history_redo", {
      scope: "sketch",
      expectedRevision: h.api.currentRevision(),
      requestId: "redo-draw",
    }),
  );
  expect(h.state.sketchDraft).toEqual(after);
  const stale = h.api.currentRevision();
  h.state.authoring.sketches = [
    ...h.state.authoring.sketches!,
    { id: "b", name: "B", sketch: blank() },
  ];
  h.state.authoring.activeSketchId = "b";
  h.state.sketchDraft = blank();
  expect(
    await h.api.invoke("sketch_draw", {
      ...line,
      expectedRevision: stale,
      requestId: "changed-owner",
    }),
  ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  expect(h.state.sketchDraft).toEqual(blank());
  expect(h.state.history).toEqual([]);
  const restored = parseProject(
    serializeProject("Draw", [], h.state.authoring),
  );
  expect(restored.authoring!.sketches![0].sketch).toEqual(after);
});
it.each([
  {
    kind: "line",
    points: [
      [0, 0],
      [1, 0],
    ],
    snapToleranceMm: 1,
  },
  {
    kind: "line",
    points: [
      [0, 0],
      [1, 0],
    ],
    autoConstraints: true,
  },
  { ...line, snapToleranceMm: -1 },
  {
    ...line,
    points: [
      [0, 0],
      [NaN, 0],
    ],
  },
  {
    kind: "circle",
    points: [
      [0, 0],
      [0, 0],
    ],
  },
  {
    kind: "arc3",
    points: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  },
  { kind: "move", pointId: "missing", position: [0, 0] },
  {
    kind: "circle",
    points: [
      [1e9 - 1, 0],
      [1e9 - 10, 0],
    ],
  },
])(
  "rejects invalid intent without draft/history publication: %j",
  async (args) => {
    const h = setup(),
      before = h.state.sketchDraft,
      revision = h.api.currentRevision();
    const reply = await h.draw(args);
    expect(reply).toMatchObject({ ok: false });
    if (!reply.ok)
      expect(["INVALID_ARGUMENT", "OPERATION_FAILED"]).toContain(
        reply.error.code,
      );
    expect(h.state.sketchDraft).toBe(before);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.setSketch).not.toHaveBeenCalled();
  },
);
it("rejects a constrained endpoint target and excessive prospective solver work atomically", async () => {
  const h = setup();
  await value(h.draw(line));
  const before = h.state.sketchDraft,
    revision = h.api.currentRevision();
  expect(
    await h.draw({
      kind: "move",
      pointId: before!.segments[0].b,
      position: [15, 5],
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/conflict/i) },
  });
  expect(h.state.sketchDraft).toBe(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.setSketch).toHaveBeenCalledOnce();
  h.state.sketchDraft = {
    ...blank(),
    points: Array.from({ length: 10000 }, (_, i) => ({
      id: `p${i}`,
      x: i,
      y: 0,
    })),
  };
  const large = h.state.sketchDraft;
  expect(
    await h.draw({
      kind: "circle",
      points: [
        [0, 0],
        [1, 0],
      ],
    }),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/limit|budget|work/i) },
  });
  expect(h.state.sketchDraft).toBe(large);
  expect(h.setSketch).toHaveBeenCalledOnce();
});
it("keeps owned reference previews and source entities intact when drawing is rejected BUSY", async () => {
  const h = setup();
  const preview = await value(
    h.api.invoke("reference_construct", {
      action: "preview",
      kind: "point",
      position: [1, 2, 3],
      expectedRevision: h.api.currentRevision(),
      requestId: "reference-owner",
    }),
  );
  expect(await h.draw(line)).toMatchObject({
    ok: false,
    error: { code: "BUSY" },
  });
  expect(
    await value(h.api.invoke("reference_construction_get", {})),
  ).toMatchObject({ active: true, sessionId: preview.sessionId });
  expect(h.setSketch).not.toHaveBeenCalled();
  expect(h.host.commit).not.toHaveBeenCalled();
});

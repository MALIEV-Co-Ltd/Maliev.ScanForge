import { expect, it } from "vitest";
import { rectangleSketch, type Sketch } from "../src/sketch";
import { coordinateSketchFrame } from "../src/sketch-frame";
import {
  applySketchEditIntent,
  SKETCH_EDIT_LIMITS,
  SketchEditResourceLimit,
  type SketchEditIntent,
} from "../src/sketch-edit-intent";

function fixture(): Sketch {
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
function edit(sketch: Sketch, intent: SketchEditIntent) {
  let sequence = 0;
  return applySketchEditIntent(sketch, intent, {
    createId: () => `new-${++sequence}`,
  });
}

it.each<SketchEditIntent>([
  { kind: "pointSet", pointId: "a", x: 1 },
  { kind: "remove", target: "point", id: "a" },
  { kind: "preset", profile: "rectangle" },
])(
  "repairs an admitted legacy coordinate outside editor bounds through $kind",
  (intent) => {
    const source = fixture();
    source.points[0] = { ...source.points[0], x: 1e9 + 1 };
    const before = structuredClone(source);
    const result = edit(source, intent);
    expect(result.changed).toBe(true);
    expect(
      result.sketch.points.every(
        (point) => Math.abs(point.x) <= 1e9 && Math.abs(point.y) <= 1e9,
      ),
    ).toBe(true);
    expect(source).toEqual(before);
  },
);

it("rejects a prospective edit that leaves another legacy coordinate outside bounds", () => {
  const source = fixture();
  source.points[0] = { ...source.points[0], x: 1e9 + 1 };
  const before = structuredClone(source);
  expect(() => edit(source, { kind: "pointSet", pointId: "b", x: 1 })).toThrow(
    /1e9|bounds/i,
  );
  expect(source).toEqual(before);
});

it.each(["rectangle", "circle"] as const)(
  "constructs the existing %s preset while preserving frame and immutable section ownership",
  (profile) => {
    const source = fixture(),
      before = structuredClone(source);
    const result = edit(source, { kind: "preset", profile });
    expect(result.changed).toBe(true);
    expect(result.sketch.frame).toEqual(source.frame);
    expect(result.sketch.reference).toBe(source.reference);
    if (profile === "rectangle") {
      expect(result.sketch.points).toEqual(rectangleSketch().points);
      expect(result.sketch.segments).toEqual(rectangleSketch().segments);
      expect(result.sketch.constraints).toEqual(rectangleSketch().constraints);
      expect(result.sketch.arcs).toBeUndefined();
    } else {
      expect(result.sketch.points).toEqual([
        { id: "center", x: 0, y: 0 },
        { id: "east", x: 10, y: 0 },
        { id: "west", x: -10, y: 0 },
      ]);
      expect(result.sketch.segments).toEqual([]);
      expect(result.sketch.arcs).toEqual([
        {
          id: "upper",
          a: "east",
          b: "west",
          center: "center",
          clockwise: false,
        },
        {
          id: "lower",
          a: "west",
          b: "east",
          center: "center",
          clockwise: false,
        },
      ]);
      expect(
        result.sketch.constraints.map((constraint) => constraint.id),
      ).toEqual(["origin", "anchor", "radius-upper", "radius-lower"]);
    }
    expect(source).toEqual(before);
  },
);

it("switches origin-plane convention using the current signed normal offset", () => {
  const source = fixture(),
    result = edit(source, { kind: "plane", plane: "OXZ" });
  expect(result.sketch.frame).toEqual(coordinateSketchFrame("OXZ", 12));
  expect(result.sketch.points).toEqual(source.points);
  expect(result.sketch.reference).toBe(source.reference);
});

it("changes a custom-plane normal offset without replacing tangent axes or extracted references", () => {
  const source = fixture();
  source.frame = {
    origin: [11, -23, 17],
    u: [0.6, 0.8, 0],
    v: [-0.8, 0.6, 0],
    normal: [0, 0, 1],
  };
  const result = edit(source, { kind: "planeOffset", offsetMm: 27 });
  expect(result.sketch.frame).toEqual({
    ...source.frame,
    origin: [11, -23, 27],
  });
  expect(source.frame.origin).toEqual([11, -23, 17]);
  expect(result.sketch.reference).toBe(source.reference);
});

it("adds default and explicit numeric points with server IDs and no grid snapping", () => {
  const source = fixture();
  const origin = edit(source, { kind: "pointAdd" });
  expect(origin.createdPointIds).toEqual(["new-1"]);
  expect(origin.sketch.points.at(-1)).toEqual({ id: "new-1", x: 0, y: 0 });
  const exact = edit(source, {
    kind: "pointAdd",
    position: [0.123456789, -0.25],
  });
  expect(exact.sketch.points.at(-1)).toEqual({
    id: "new-1",
    x: 0.123456789,
    y: -0.25,
  });
  expect(source.points).toHaveLength(3);
});

it("edits numeric point axes without moving other points or implicitly solving constraints", () => {
  const source = rectangleSketch(),
    before = structuredClone(source);
  const result = edit(source, { kind: "pointSet", pointId: "p2", x: 51.125 });
  expect(result.sketch.points.find((point) => point.id === "p2")).toMatchObject(
    { x: 51.125, y: 0 },
  );
  expect(result.sketch.constraints).toEqual(source.constraints);
  expect(result.solution).toBeUndefined();
  expect(source).toEqual(before);
});

it("adds a segment using default or explicit endpoints and updates only its requested topology", () => {
  const source = fixture();
  expect(edit(source, { kind: "segmentAdd" }).sketch.segments.at(-1)).toEqual({
    id: "new-1",
    a: "a",
    b: "b",
  });
  const added = edit(source, { kind: "segmentAdd", a: "b", b: "c" });
  expect(added.createdCurveIds).toEqual(["new-1"]);
  expect(added.sketch.segments.at(-1)).toEqual({ id: "new-1", a: "b", b: "c" });
  expect(
    edit(source, { kind: "segmentSet", segmentId: "s", b: "c" }).sketch
      .segments,
  ).toEqual([{ id: "s", a: "a", b: "c" }]);
});

it("adds and edits analytic arc references and direction without tessellating them", () => {
  const source = fixture();
  const added = edit(source, { kind: "arcAdd" });
  expect(added.createdCurveIds).toEqual(["new-1"]);
  expect(added.sketch.arcs).toEqual([
    { id: "new-1", a: "a", b: "b", center: "c", clockwise: false },
  ]);
  const updated = edit(added.sketch, {
    kind: "arcSet",
    arcId: "new-1",
    a: "b",
    b: "a",
    clockwise: true,
  });
  expect(updated.sketch.arcs).toEqual([
    { id: "new-1", a: "b", b: "a", center: "c", clockwise: true },
  ]);
  expect(updated.sketch.points).toEqual(source.points);
});

it.each(["s", "arc"])(
  "sets the %s construction flag without changing its geometry",
  (curveId) => {
    const source = fixture();
    source.arcs = [
      { id: "arc", a: "a", b: "b", center: "c", clockwise: false },
    ];
    const result = edit(source, {
      kind: "construction",
      curveId,
      enabled: true,
    });
    const curve = [...result.sketch.segments, ...result.sketch.arcs!].find(
      (item) => item.id === curveId,
    );
    expect(curve?.construction).toBe(true);
    expect(result.sketch.points).toEqual(source.points);
    expect(
      [...source.segments, ...source.arcs].find((item) => item.id === curveId)
        ?.construction,
    ).toBeUndefined();
  },
);

it("removes point-dependent geometry and only invalidated relations using the existing cascade", () => {
  const source = fixture();
  source.arcs = [{ id: "arc", a: "a", b: "b", center: "c", clockwise: false }];
  source.constraints = [
    { id: "fixed", kind: "fixed", point: "c", x: 0, y: 0 },
    { id: "horizontal", kind: "horizontal", segment: "s" },
    { id: "radius", kind: "radius", arc: "arc", value: 10 },
  ];
  const result = edit(source, { kind: "remove", target: "point", id: "a" });
  expect(result.removedPointIds).toEqual(["a"]);
  expect(new Set(result.removedCurveIds)).toEqual(new Set(["s", "arc"]));
  expect(new Set(result.removedConstraintIds)).toEqual(
    new Set(["horizontal", "radius"]),
  );
  expect(result.sketch.constraints).toEqual([source.constraints[0]]);
  expect(source.points).toHaveLength(3);
});

it("edits dimensional values without solving and removes a constraint without geometry changes", () => {
  const source = rectangleSketch();
  const result = edit(source, {
    kind: "dimension",
    constraintId: "c6",
    value: 17,
  });
  expect(result.sketch.points).toEqual(source.points);
  expect(
    result.sketch.constraints.find((constraint) => constraint.id === "c6"),
  ).toMatchObject({ value: 17 });
  expect(result.solution).toBeUndefined();
  const removed = edit(source, {
    kind: "remove",
    target: "constraint",
    id: "c6",
  });
  expect(removed.removedConstraintIds).toEqual(["c6"]);
  expect(removed.sketch.points).toEqual(source.points);
});

it("constructs fixed relations from current point coordinates server-side", () => {
  const source = fixture(),
    result = edit(source, {
      kind: "constraintAdd",
      constraint: { kind: "fixed", point: "a" },
    });
  expect(result.createdConstraintIds).toEqual(["new-1"]);
  expect(result.sketch.constraints).toEqual([
    { id: "new-1", kind: "fixed", point: "a", x: 10, y: 0 },
  ]);
  expect(result.solution?.converged).toBe(true);
});

it("rejects an incompatible added relation without altering the input graph", () => {
  const source = rectangleSketch(),
    before = structuredClone(source);
  expect(() =>
    edit(source, {
      kind: "constraintAdd",
      constraint: { kind: "distance", a: "p1", b: "p2", value: 10 },
    }),
  ).toThrow(/constraint|converg|solv/i);
  expect(source).toEqual(before);
});

it("explicitly solves a numeric dimension edit while keeping its frame/reference ownership", () => {
  const source: Sketch = {
    ...rectangleSketch(),
    frame: fixture().frame,
    reference: fixture().reference,
  };
  const changed = edit(source, {
    kind: "dimension",
    constraintId: "c6",
    value: 17,
  }).sketch;
  const result = edit(changed, { kind: "solve" });
  expect(result.solution?.converged).toBe(true);
  const a = result.sketch.points[0],
    b = result.sketch.points[1];
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(17, 5);
  expect(result.sketch.reference).toBe(source.reference);
});

it("retains explicit Solve's best candidate and nonconvergence diagnostics", () => {
  const source: Sketch = {
    version: 1,
    points: [{ id: "p", x: 0, y: 0 }],
    segments: [],
    constraints: [
      { id: "a", kind: "fixed", point: "p", x: 0, y: 0 },
      { id: "b", kind: "fixed", point: "p", x: 1, y: 0 },
    ],
  };
  const result = edit(source, { kind: "solve" });
  expect(result.solution?.converged).toBe(false);
  expect(result.solution?.conflictingConstraintIds).toEqual(
    expect.arrayContaining(["a", "b"]),
  );
  expect(result.sketch.points[0].x).toBeCloseTo(0.5, 4);
  expect(source.points[0].x).toBe(0);
});

it("rejects nonconverged profile preparation while ordinary Solve may return its best candidate", () => {
  const source: Sketch = {
    version: 1,
    points: [{ id: "p", x: 0, y: 0 }],
    segments: [],
    constraints: [
      { id: "a", kind: "fixed", point: "p", x: 0, y: 0 },
      { id: "b", kind: "fixed", point: "p", x: 1, y: 0 },
    ],
  };
  expect(() => edit(source, { kind: "solve", forProfile: true })).toThrow(
    /converg|constraint|profile/i,
  );
  expect(source.points[0].x).toBe(0);
});

it("recognizes semantic noops without manufacturing authoring history", () => {
  const source = fixture();
  for (const intent of [
    { kind: "pointSet", pointId: "a", x: 10 },
    { kind: "segmentSet", segmentId: "s", a: "a" },
    { kind: "construction", curveId: "s", enabled: false },
    { kind: "planeOffset", offsetMm: 12 },
  ] as SketchEditIntent[]) {
    expect(edit(source, intent).changed).toBe(false);
  }
});

it.each([
  { kind: "pointSet", pointId: "missing", x: 1 },
  { kind: "segmentSet", segmentId: "s", a: "b" },
  { kind: "arcAdd", a: "a", b: "b" },
  { kind: "dimension", constraintId: "s", value: 1 },
  { kind: "remove", target: "point", id: "missing" },
  { kind: "pointSet", pointId: "a", x: Infinity },
  { kind: "pointSet", pointId: "a", x: 1e9 + 1 },
  { kind: "pointAdd", position: [0, 0], id: "client-owned-id" },
])("rejects malformed or invalid intent $kind before publication", (intent) => {
  const source = fixture(),
    before = structuredClone(source);
  expect(() =>
    applySketchEditIntent(source, intent as SketchEditIntent),
  ).toThrow();
  expect(source).toEqual(before);
});

it("bounds prospective edit work without imposing a project decoder cap", () => {
  const source: Sketch = {
    version: 1,
    points: Array.from({ length: 2048 }, (_, index) => ({
      id: `p${index}`,
      x: index,
      y: 0,
    })),
    segments: [],
    constraints: Array.from({ length: 1024 }, (_, index) => ({
      id: `c${index}`,
      kind: "fixed",
      point: "p0",
      x: 0,
      y: 0,
    })),
  };
  expect(source.constraints.length * source.points.length).toBeGreaterThan(
    SKETCH_EDIT_LIMITS.validationWork,
  );
  expect(() => edit(source, { kind: "pointAdd" })).toThrow(
    SketchEditResourceLimit,
  );
  expect(source.points).toHaveLength(2048);
});

it("keeps large low-constraint numeric graphs editable beyond drawing's point cap", () => {
  const source: Sketch = {
    version: 1,
    points: Array.from({ length: 1024 }, (_, index) => ({
      id: `p${index}`,
      x: index,
      y: 0,
    })),
    segments: [],
    constraints: [],
  };
  const result = edit(source, { kind: "pointSet", pointId: "p1000", y: 0.125 });
  expect(result.sketch.points[1000]).toMatchObject({ x: 1000, y: 0.125 });
  expect(result.solution).toBeUndefined();
  expect(source.points[1000].y).toBe(0);
});

it("checks cancellation before any ID generation or input mutation", () => {
  const source = fixture(),
    controller = new AbortController();
  controller.abort();
  let generated = false;
  expect(() =>
    applySketchEditIntent(
      source,
      { kind: "pointAdd" },
      {
        signal: controller.signal,
        createId: () => {
          generated = true;
          return "forbidden";
        },
      },
    ),
  ).toThrow();
  expect(generated).toBe(false);
  expect(source.points).toHaveLength(3);
});

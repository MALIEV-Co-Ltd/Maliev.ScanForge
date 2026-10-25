import { describe, expect, it } from "vitest";
import { mirrorSketch } from "../src/sketch-mirror";
import {
  parseSketch,
  serializeSketch,
  validateSketch,
  type Sketch,
} from "../src/sketch";
import { coordinateSketchFrame } from "../src/sketch-frame";

function fixture(): Sketch {
  return {
    version: 1,
    points: [
      { id: "axis-a", x: 0, y: -10 },
      { id: "axis-b", x: 0, y: 10 },
      { id: "a", x: 2, y: 1 },
      { id: "b", x: 4, y: 3 },
      { id: "c", x: 5, y: 1 },
    ],
    segments: [
      { id: "axis", a: "axis-a", b: "axis-b", construction: true },
      { id: "first", a: "a", b: "b" },
      { id: "second", a: "b", b: "c", construction: false },
    ],
    constraints: [
      { id: "fixed-original", kind: "fixed", point: "a", x: 2, y: 1 },
    ],
  };
}
const request = { axis: "axis", curveIds: ["first", "second"] };
const point = (s: Sketch, id: string) => s.points.find((p) => p.id === id)!;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

describe("immutable analytic sketch mirror copies", () => {
  it("reflects literal line coordinates and preserves originals, order and shared endpoints", async () => {
    const s = freeze(fixture()),
      before = structuredClone(s);
    const r = await mirrorSketch(s, request);
    expect(s).toEqual(before);
    expect(r.sketch.points.slice(0, s.points.length)).toEqual(s.points);
    expect(r.sketch.segments.slice(0, s.segments.length)).toEqual(s.segments);
    expect(r.sketch.constraints).toEqual(s.constraints);
    expect(r.createdPointIds).toHaveLength(3);
    expect(r.createdCurveIds).toHaveLength(2);
    expect(Object.keys(r.pointMap).sort()).toEqual(["a", "b", "c"]);
    for (const [id, xy] of [
      ["a", [-2, 1]],
      ["b", [-4, 3]],
      ["c", [-5, 1]],
    ] as const) {
      const p = point(r.sketch, r.pointMap[id]);
      expect([p.x, p.y]).toEqual(xy);
    }
    const first = r.sketch.segments.find((c) => c.id === r.curveMap.first)!;
    const second = r.sketch.segments.find((c) => c.id === r.curveMap.second)!;
    expect(first.b).toBe(second.a);
    expect(first).not.toHaveProperty("construction");
    expect(second.construction).toBe(false);
    expect(r.createdCurveIds).toEqual([r.curveMap.first, r.curveMap.second]);
    expect(() => validateSketch(r.sketch)).not.toThrow();
  });
  it("reflects against a translated oblique axis using independent literal answers", async () => {
    const s = fixture();
    Object.assign(point(s, "axis-a"), { x: 1, y: 2 });
    Object.assign(point(s, "axis-b"), { x: 4, y: 5 });
    Object.assign(point(s, "a"), { x: 2, y: 5 });
    Object.assign(point(s, "b"), { x: 3, y: 5 });
    s.constraints = [];
    const r = await mirrorSketch(s, { axis: "axis", curveIds: ["first"] });
    expect(point(r.sketch, r.pointMap.a).x).toBeCloseTo(4, 13);
    expect(point(r.sketch, r.pointMap.a).y).toBeCloseTo(3, 13);
    expect(point(r.sketch, r.pointMap.b).x).toBeCloseTo(4, 13);
    expect(point(r.sketch, r.pointMap.b).y).toBeCloseTo(4, 13);
  });
  it("preserves frame/reference and creates no symmetry or copied constraints", async () => {
    const s = fixture();
    s.frame = coordinateSketchFrame("OYZ", 12);
    s.reference = {
      kind: "section",
      sourceId: "scan",
      axis: "x",
      offset: 12,
      onSlicingPlane: true,
      selectedOnly: false,
      sampled: false,
      segments: [0, 0, 1, 1],
    };
    const r = await mirrorSketch(s, request);
    expect(r.sketch.frame).toEqual(s.frame);
    expect(r.sketch.reference).toEqual(s.reference);
    expect(r.sketch.constraints).toEqual(s.constraints);
    expect(parseSketch(serializeSketch(r.sketch))).toEqual(r.sketch);
  });
  it("copies two semicircles with one center and reversed arc orientation", async () => {
    const s = fixture();
    s.points.push(
      { id: "center", x: 3, y: 0 },
      { id: "left", x: 1, y: 0 },
      { id: "right", x: 5, y: 0 },
    );
    s.arcs = [
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
    ];
    const r = await mirrorSketch(s, {
      axis: "axis",
      curveIds: ["upper", "lower"],
    });
    expect(r.createdPointIds).toHaveLength(3);
    expect(r.sketch.arcs!.slice(0, 2)).toEqual(s.arcs);
    const arcs = r.sketch.arcs!.slice(2);
    expect(arcs.map((a) => a.clockwise)).toEqual([true, true]);
    expect(arcs[0].center).toBe(arcs[1].center);
    expect(arcs[0].a).toBe(arcs[1].b);
    expect(arcs[0].construction).toBe(true);
    expect(arcs[1]).not.toHaveProperty("construction");
    expect(point(r.sketch, arcs[0].center)).toMatchObject({ x: -3, y: 0 });
    for (const arc of arcs) {
      const a = point(r.sketch, arc.a),
        b = point(r.sketch, arc.b),
        c = point(r.sketch, arc.center);
      expect(Math.hypot(a.x - c.x, a.y - c.y)).toBe(2);
      expect(Math.hypot(b.x - c.x, b.y - c.y)).toBe(2);
    }
  });
  it("reflects shared source axis points into distinct copied topology without moving the axis", async () => {
    const s = fixture();
    s.segments[1].a = "axis-a";
    const r = await mirrorSketch(s, { axis: "axis", curveIds: ["first"] });
    expect(r.pointMap["axis-a"]).not.toBe("axis-a");
    expect(point(r.sketch, r.pointMap["axis-a"])).toMatchObject({
      x: 0,
      y: -10,
    });
    expect(r.sketch.segments[0]).toEqual(s.segments[0]);
  });
  it("is geometrically involutive when the newly copied curves are mirrored again", async () => {
    const s = fixture(),
      first = await mirrorSketch(s, request);
    const second = await mirrorSketch(first.sketch, {
      axis: "axis",
      curveIds: first.createdCurveIds,
    });
    for (const id of ["a", "b", "c"]) {
      const p = point(second.sketch, second.pointMap[first.pointMap[id]]),
        original = point(s, id);
      expect([p.x, p.y]).toEqual([original.x, original.y]);
    }
  });
  it("uses deterministic IDs avoiding existing points, curves and constraints", async () => {
    const s = fixture();
    s.points.push(
      { id: "mirror-point-0", x: 20, y: 20 },
      { id: "mirror-curve-0", x: 21, y: 20 },
    );
    s.constraints.push({
      id: "mirror-point-1",
      kind: "horizontal",
      segment: "axis",
    });
    const a = await mirrorSketch(s, request),
      b = await mirrorSketch(s, request);
    expect(a).toEqual(b);
    const ids = [
      ...a.sketch.points,
      ...a.sketch.segments,
      ...(a.sketch.arcs ?? []),
      ...a.sketch.constraints,
    ].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(a.createdPointIds.every((id) => /^mirror-point-\d+$/.test(id))).toBe(
      true,
    );
    expect(a.createdCurveIds.every((id) => /^mirror-curve-\d+$/.test(id))).toBe(
      true,
    );
  });
  it("handles prototype-like point and curve identifiers as ordinary own map keys", async () => {
    const s = fixture();
    point(s, "a").id = "__proto__";
    s.segments[1] = { ...s.segments[1], id: "constructor", a: "__proto__" };
    s.constraints = [];
    const r = await mirrorSketch(s, {
      axis: "axis",
      curveIds: ["constructor"],
    });
    expect(Object.hasOwn(r.pointMap, "__proto__")).toBe(true);
    expect(Object.hasOwn(r.curveMap, "constructor")).toBe(true);
    expect(typeof r.pointMap["__proto__"]).toBe("string");
    expect(point(r.sketch, r.pointMap["__proto__"])).toMatchObject({
      x: -2,
      y: 1,
    });
    expect(r.createdCurveIds).toEqual([r.curveMap.constructor]);
  });
  it.each([
    { axis: "axis", curveIds: [] },
    { axis: "axis", curveIds: ["first", "first"] },
    { axis: "axis", curveIds: ["missing"] },
    { axis: "missing", curveIds: ["first"] },
    { axis: "first", curveIds: ["second"] },
    { axis: "axis", curveIds: ["axis"] },
  ])("rejects invalid selection %j without mutation", async (req) => {
    const s = fixture(),
      before = structuredClone(s);
    await expect(mirrorSketch(s, req)).rejects.toThrow();
    expect(s).toEqual(before);
  });
  it.each([0, 1e-12])(
    "rejects zero or unresolved axis length %s",
    async (length) => {
      const s = fixture();
      Object.assign(point(s, "axis-b"), { x: 0, y: -10 + length });
      await expect(mirrorSketch(s, request)).rejects.toThrow(
        /axis|degenerate/i,
      );
    },
  );
  it.each([NaN, Infinity, 1e9 + 1])(
    "rejects nonfinite/out-of-bounds input %s",
    async (x) => {
      const s = fixture();
      point(s, "a").x = x;
      await expect(mirrorSketch(s, request)).rejects.toThrow();
    },
  );
  it("rejects out-of-bounds reflected output atomically", async () => {
    const s = fixture();
    point(s, "axis-a").x = 9e8;
    point(s, "axis-b").x = 9e8;
    point(s, "a").x = -9e8;
    const before = structuredClone(s);
    await expect(mirrorSketch(s, request)).rejects.toThrow(/bound/i);
    expect(s).toEqual(before);
  });
  it.each([
    "points",
    "curves",
    "constraints",
    "selected",
    "output-points",
    "output-curves",
  ])("rejects the %s collection limit before publication", async (kind) => {
    const s = fixture();
    s.constraints = [];
    let req = request;
    if (kind === "points" || kind === "output-points") {
      const target = kind === "points" ? 32769 : 32767;
      while (s.points.length < target)
        s.points.push({ id: `extra-p-${s.points.length}`, x: 1, y: 1 });
    }
    if (kind === "curves" || kind === "selected" || kind === "output-curves") {
      const target =
        kind === "curves" ? 8193 : kind === "selected" ? 4098 : 8192;
      while (s.segments.length < target)
        s.segments.push({ id: `extra-s-${s.segments.length}`, a: "a", b: "b" });
      if (kind === "selected")
        req = { axis: "axis", curveIds: s.segments.slice(1).map((c) => c.id) };
    }
    if (kind === "constraints")
      for (let i = 0; i < 4097; i++)
        s.constraints.push({
          id: `fixed-${i}`,
          kind: "fixed",
          point: "a",
          x: 2,
          y: 1,
        });
    await expect(mirrorSketch(s, req)).rejects.toThrow(/limit|budget/i);
  });
  it("honors abort before work and across an asynchronous yield", async () => {
    const s = fixture(),
      before = structuredClone(s),
      initial = new AbortController();
    initial.abort();
    await expect(
      mirrorSketch(s, request, { signal: initial.signal }),
    ).rejects.toThrow();
    const later = new AbortController();
    const timer = setTimeout(() => later.abort(), 0);
    try {
      await expect(
        mirrorSketch(s, request, { signal: later.signal }),
      ).rejects.toThrow();
    } finally {
      clearTimeout(timer);
    }
    expect(s).toEqual(before);
  });
  it("propagates revision checks without mutating the source", async () => {
    const s = fixture();
    for (let i = 0; i < 2000; i++)
      s.points.push({ id: `revision-spare-${i}`, x: i, y: 1 });
    const before = structuredClone(s);
    let revisionChanged = false;
    const timer = setTimeout(() => {
      revisionChanged = true;
    }, 0);
    try {
      await expect(
        mirrorSketch(s, request, {
          check: () => {
            if (revisionChanged) throw Error("revision changed");
          },
        }),
      ).rejects.toThrow(/revision changed/);
    } finally {
      clearTimeout(timer);
    }
    expect(revisionChanged).toBe(true);
    expect(s).toEqual(before);
  });
  it("propagates an immediate revision failure", async () => {
    const s = fixture(),
      before = structuredClone(s);
    await expect(
      mirrorSketch(s, request, {
        check: () => {
          throw Error("stale at entry");
        },
      }),
    ).rejects.toThrow(/stale at entry/);
    expect(s).toEqual(before);
  });
  it("yields during admitted large work so a later timer abort prevents publication", async () => {
    const s = fixture();
    for (let i = 0; i < 2000; i++)
      s.points.push({ id: `spare-${i}`, x: i, y: 1 });
    const before = structuredClone(s),
      controller = new AbortController();
    let callbackFired = false;
    const timer = setTimeout(() => {
      callbackFired = true;
      controller.abort();
    }, 0);
    try {
      await expect(
        mirrorSketch(s, request, { signal: controller.signal }),
      ).rejects.toThrow();
    } finally {
      clearTimeout(timer);
    }
    expect(callbackFired).toBe(true);
    expect(s).toEqual(before);
  });
});

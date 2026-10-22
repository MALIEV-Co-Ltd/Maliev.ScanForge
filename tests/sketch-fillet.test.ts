import { describe, expect, it } from "vitest";
import { filletSketchCorner, SKETCH_FILLET_LIMITS } from "../src/sketch-fillet";
import {
  sketchCurveProfile,
  validateSketch,
  serializeSketch,
  parseSketch,
  type Sketch,
} from "../src/sketch";
import { coordinateSketchFrame } from "../src/sketch-frame";

function fixture(shared = false): Sketch {
  return {
    version: 1,
    points: [
      { id: "left", x: -10, y: 0 },
      { id: "corner", x: 0, y: 0 },
      ...(!shared ? [{ id: "other-corner", x: 0, y: 0 }] : []),
      { id: "top", x: 0, y: 10 },
    ],
    segments: [
      { id: "first", a: "left", b: "corner" },
      { id: "second", a: shared ? "corner" : "other-corner", b: "top" },
    ],
    constraints: [],
  };
}
const request = {
  first: "first",
  second: "second",
  firstEnd: "b",
  secondEnd: "a",
  radiusMm: 2,
} as const;
function p(s: Sketch, id: string) {
  return s.points.find((p) => p.id === id)!;
}
const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("fixed-radius two-line sketch fillet", () => {
  it.each([false, true])(
    "creates exact analytic tangency with shared-corner=%s without source mutation",
    async (shared) => {
      const s = fixture(shared);
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
      const before = structuredClone(s),
        r = await filletSketchCorner(s, request);
      expect(r.changed).toBe(true);
      expect(r.intersection).toEqual([0, 0]);
      expect(r.tangentPoints).toEqual([
        [-2, 0],
        [0, 2],
      ]);
      expect(r.center).toEqual([-2, 2]);
      expect(r.radiusMm).toBe(2);
      const arc = r.sketch.arcs!.find((a) => a.id === r.arcId)!;
      expect(arc).toBeDefined();
      expect(arc.clockwise).toBe(false);
      expect(arc.a).toBe("corner");
      expect(arc.b).toBe(r.sketch.segments[1].a);
      expect(arc.b).not.toBe(arc.a);
      expect(arc.center).not.toBe(arc.a);
      expect(p(r.sketch, arc.a)).toMatchObject({ x: -2, y: 0 });
      expect(p(r.sketch, arc.b)).toMatchObject({ x: 0, y: 2 });
      expect(p(r.sketch, arc.center)).toMatchObject({ x: -2, y: 2 });
      expect(r.sketch.segments.map((l) => l.id)).toEqual(["first", "second"]);
      expect(p(r.sketch, "left")).toEqual(p(s, "left"));
      expect(p(r.sketch, "top")).toEqual(p(s, "top"));
      if (!shared) expect(arc.b).toBe("other-corner");
      expect(r.sketch.frame).toEqual(s.frame);
      expect(r.sketch.reference).toEqual(s.reference);
      expect(r.sketch.constraints).toEqual([]);
      expect(s).toEqual(before);
      expect(parseSketch(serializeSketch(r.sketch))).toEqual(r.sketch);
      expect(() => validateSketch(r.sketch)).not.toThrow();
    },
  );
  it.each([
    ["a", "a"],
    ["a", "b"],
    ["b", "a"],
    ["b", "b"],
  ] as const)(
    "selects physical ends explicitly: %s/%s",
    async (firstEnd, secondEnd) => {
      const s = fixture();
      if (firstEnd === "a")
        s.segments[0] = { ...s.segments[0], a: "corner", b: "left" };
      if (secondEnd === "b")
        s.segments[1] = { ...s.segments[1], a: "top", b: "other-corner" };
      const r = await filletSketchCorner(s, {
        ...request,
        firstEnd,
        secondEnd,
      });
      expect(r.center).toEqual([-2, 2]);
      expect(r.tangentPoints).toEqual([
        [-2, 0],
        [0, 2],
      ]);
    },
  );
  it.each([5, 45, 90, 120, 175])(
    "preserves radius and tangency for a %s-degree retained-ray angle",
    async (degrees) => {
      const theta = (degrees * Math.PI) / 180,
        s = fixture();
      s.points = [
        { id: "left", x: 100, y: 0 },
        { id: "corner", x: 0, y: 0 },
        { id: "other-corner", x: 0, y: 0 },
        { id: "top", x: 100 * Math.cos(theta), y: 100 * Math.sin(theta) },
      ];
      const r = await filletSketchCorner(s, { ...request, radiusMm: 1 }),
        arc = r.sketch.arcs![0],
        a = p(r.sketch, arc.a),
        b = p(r.sketch, arc.b),
        center = p(r.sketch, arc.center);
      expect(d(a, center)).toBeCloseTo(1, 11);
      expect(d(b, center)).toBeCloseTo(1, 11);
      expect(a.x - center.x).toBeCloseTo(0, 10);
      expect(
        (b.x - center.x) * Math.cos(theta) + (b.y - center.y) * Math.sin(theta),
      ).toBeCloseTo(0, 10);
      expect(arc.clockwise).toBe(true);
    },
  );
  it("may extend selected ends toward valid retained-ray tangent points", async () => {
    const s = fixture();
    p(s, "corner").x = -4;
    p(s, "other-corner").y = 4;
    const r = await filletSketchCorner(s, request);
    expect(r.intersection).toEqual([0, 0]);
    expect(r.tangentPoints).toEqual([
      [-2, 0],
      [0, 2],
    ]);
  });
  it("keeps a closed profile analytic after replacing one shared corner", async () => {
    const s: Sketch = {
      version: 1,
      points: [
        { id: "00", x: 0, y: 0 },
        { id: "10", x: 10, y: 0 },
        { id: "11", x: 10, y: 10 },
        { id: "01", x: 0, y: 10 },
      ],
      segments: [
        { id: "bottom", a: "00", b: "10" },
        { id: "right", a: "10", b: "11" },
        { id: "top", a: "11", b: "01" },
        { id: "left", a: "01", b: "00" },
      ],
      constraints: [],
    };
    const r = await filletSketchCorner(s, {
        first: "left",
        second: "bottom",
        firstEnd: "b",
        secondEnd: "a",
        radiusMm: 1,
      }),
      edges = sketchCurveProfile(r.sketch);
    expect(edges).toHaveLength(5);
    expect(edges.filter((e) => e.kind === "arc")).toHaveLength(1);
    expect(r.sketch.segments.map((l) => l.id)).toEqual(
      s.segments.map((l) => l.id),
    );
  });
  it("preserves construction and unrelated geometry order", async () => {
    const s = fixture();
    s.segments = s.segments.map((l) => ({ ...l, construction: true }));
    s.points.push({ id: "u", x: 20, y: 20 }, { id: "v", x: 21, y: 20 });
    s.segments.splice(1, 0, { id: "unrelated", a: "u", b: "v" });
    s.constraints = [{ id: "fixed", kind: "fixed", point: "u", x: 20, y: 20 }];
    const r = await filletSketchCorner(s, request);
    expect(r.sketch.segments.map((l) => l.id)).toEqual([
      "first",
      "unrelated",
      "second",
    ]);
    expect(r.sketch.arcs![0].construction).toBe(true);
    expect(r.sketch.segments[1]).toEqual(s.segments[1]);
    expect(r.sketch.constraints).toEqual(s.constraints);
  });
  it("uses deterministic IDs that avoid all existing point/curve/constraint identifiers", async () => {
    const s = fixture(true);
    s.points.push(
      { id: "fillet-point-0", x: 40, y: 40 },
      { id: "fillet-arc-0", x: 41, y: 41 },
    );
    const a = await filletSketchCorner(s, request),
      b = await filletSketchCorner(s, request);
    expect(a).toEqual(b);
    const ids = [
      ...a.sketch.points,
      ...a.sketch.segments,
      ...a.sketch.arcs!,
      ...a.sketch.constraints,
    ].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it.each(["point", "segment", "relation"])(
    "rejects affected %s constraints with their IDs atomically",
    async (kind) => {
      const s = fixture();
      s.constraints = [
        kind === "point"
          ? { id: "affected-id", kind: "fixed", point: "corner", x: 0, y: 0 }
          : kind === "segment"
            ? { id: "affected-id", kind: "horizontal", segment: "first" }
            : {
                id: "affected-id",
                kind: "perpendicular",
                first: "first",
                second: "second",
              },
      ];
      const before = structuredClone(s);
      await expect(filletSketchCorner(s, request)).rejects.toThrow(
        /affected-id/,
      );
      expect(s).toEqual(before);
    },
  );
  it.each(["segment", "arc"])(
    "rejects chosen points used by unrelated %s geometry",
    async (kind) => {
      const s = fixture(true);
      s.points.push({ id: "q", x: 2, y: 2 });
      if (kind === "segment")
        s.segments.push({ id: "other", a: "corner", b: "q" });
      else
        s.arcs = [
          {
            id: "other",
            a: "corner",
            b: "q",
            center: "left",
            clockwise: false,
          },
        ];
      await expect(filletSketchCorner(s, request)).rejects.toThrow(
        /shared|used|unrelated/i,
      );
    },
  );
  it.each([0, -1, NaN, Infinity, 1e10, 10, 11])(
    "rejects invalid or excessive radius %s",
    async (radiusMm) => {
      const s = fixture(),
        before = structuredClone(s);
      await expect(
        filletSketchCorner(s, { ...request, radiusMm }),
      ).rejects.toThrow(/radius|collapse|retained/i);
      expect(s).toEqual(before);
    },
  );
  it.each([
    "same",
    "missing",
    "endpoint",
    "parallel",
    "coincident",
    "zero",
    "construction",
    "bounds",
  ])("rejects invalid %s input", async (kind) => {
    const s = fixture();
    const q: any = { ...request };
    if (kind === "same") q.second = "first";
    if (kind === "missing") q.second = "absent";
    if (kind === "endpoint") q.firstEnd = "c";
    if (kind === "parallel" || kind === "coincident") {
      p(s, "other-corner").x = -10;
      p(s, "other-corner").y = kind === "parallel" ? 1 : 0;
      p(s, "top").x = 0;
      p(s, "top").y = kind === "parallel" ? 1 : 0;
    }
    if (kind === "zero") {
      p(s, "corner").x = -10;
    }
    if (kind === "construction") s.segments[0].construction = true;
    if (kind === "bounds") p(s, "left").x = -2e9;
    await expect(filletSketchCorner(s, q)).rejects.toThrow();
  });
  it.each([1e-6, 1e6])(
    "supports locally representable tiny/large radius %s",
    async (radiusMm) => {
      const s = fixture();
      p(s, "left").x = -10 * radiusMm;
      p(s, "top").y = 10 * radiusMm;
      const r = await filletSketchCorner(s, { ...request, radiusMm });
      expect(r.center[0] / radiusMm).toBeCloseTo(-1, 10);
      expect(r.center[1] / radiusMm).toBeCloseTo(1, 10);
    },
  );
  it("honors pre-abort, check failure and cancellation across a yield", async () => {
    const s = fixture(),
      before = structuredClone(s),
      c = new AbortController();
    c.abort();
    await expect(
      filletSketchCorner(s, request, { signal: c.signal }),
    ).rejects.toThrow(/abort/i);
    await expect(
      filletSketchCorner(s, request, {
        check: () => {
          throw Error("stale");
        },
      }),
    ).rejects.toThrow("stale");
    const later = new AbortController();
    setTimeout(() => later.abort(), 0);
    await expect(
      filletSketchCorner(s, request, { signal: later.signal }),
    ).rejects.toThrow(/abort/i);
    expect(s).toEqual(before);
  });
  it("pre-admits collection limits before accessing malformed oversized entries", async () => {
    const s = fixture();
    s.points.length = SKETCH_FILLET_LIMITS.points + 1;
    Object.defineProperty(s.points, 0, {
      get() {
        throw Error("entry must not be read");
      },
    });
    await expect(filletSketchCorner(s, request)).rejects.toThrow(
      /limit|bound/i,
    );
  });
  it("rejects excessive generic validation work before unbounded symmetry searches", async () => {
    const s = fixture();
    s.points.push(
      ...Array.from({ length: 3000 }, (_, i) => ({ id: `p${i}`, x: i, y: 1 })),
    );
    s.segments.push({ id: "axis", a: "p0", b: "p1", construction: true });
    s.constraints = Array.from({ length: 400 }, (_, i) => ({
      id: `sym${i}`,
      kind: "symmetric" as const,
      first: "first",
      second: "second",
      axis: "axis",
      reverse: false,
    }));
    await expect(filletSketchCorner(s, request)).rejects.toThrow(
      /validation work budget/,
    );
  });
});

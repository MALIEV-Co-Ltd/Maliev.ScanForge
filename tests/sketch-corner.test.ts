import { describe, expect, it } from "vitest";
import { cornerTrimSketch } from "../src/sketch-corner";
import { serializeSketch, parseSketch, type Sketch } from "../src/sketch";
import { coordinateSketchFrame } from "../src/sketch-frame";
function fixture(): Sketch {
  return {
    version: 1,
    points: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 2, y: 0 },
      { id: "c", x: 3, y: 1 },
      { id: "d", x: 3, y: 3 },
    ],
    segments: [
      { id: "one", a: "a", b: "b", construction: true },
      { id: "two", a: "c", b: "d" },
    ],
    constraints: [],
  };
}
const options = {
  first: "one",
  second: "two",
  firstEnd: "b",
  secondEnd: "a",
} as const;
describe("two-line corner trim", () => {
  it("extends selected ends, merges IDs and preserves metadata without mutation", () => {
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
    const before = structuredClone(s),
      r = cornerTrimSketch(s, options);
    expect(r.intersection).toEqual([3, 0]);
    expect(r.pointId).toBe("b");
    expect(r.changed).toBe(true);
    expect(r.sketch.segments).toEqual([
      { id: "one", a: "a", b: "b", construction: true },
      { id: "two", a: "b", b: "d" },
    ]);
    expect(r.sketch.points.find((p) => p.id === "b")).toEqual({
      id: "b",
      x: 3,
      y: 0,
    });
    expect(r.sketch.points.some((p) => p.id === "c")).toBe(false);
    expect(r.sketch.frame).toEqual(s.frame);
    expect(r.sketch.reference).toEqual(s.reference);
    expect(s).toEqual(before);
    expect(parseSketch(serializeSketch(r.sketch))).toEqual(r.sketch);
  });
  it.each([false, true])(
    "trims oblique lines with reversed endpoint selection %s",
    (reverse) => {
      const s = fixture();
      s.points = [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 4, y: 4 },
        { id: "c", x: 0, y: 4 },
        { id: "d", x: 4, y: 0 },
      ];
      if (reverse)
        s.segments = s.segments.map((l) => ({ ...l, a: l.b, b: l.a }));
      const r = cornerTrimSketch(s, {
        ...options,
        firstEnd: reverse ? "a" : "b",
        secondEnd: reverse ? "b" : "a",
      });
      expect(r.intersection).toEqual([2, 2]);
      expect(r.sketch.points.find((p) => p.id === "a")).toEqual(s.points[0]);
      expect(r.sketch.points.find((p) => p.id === "d")).toEqual(s.points[3]);
    },
  );
  it("preserves unrelated constraints", () => {
    const s = fixture();
    s.constraints = [{ id: "fixed", kind: "fixed", point: "a", x: 0, y: 0 }];
    expect(cornerTrimSketch(s, options).sketch.constraints).toEqual(
      s.constraints,
    );
  });
  it.each(["fixed", "horizontal", "parallel", "symmetric", "tangent"])(
    "rejects dependent %s relations atomically",
    (kind) => {
      const s = fixture();
      s.segments.push({ id: "axis", a: "a", b: "d", construction: true });
      if (kind === "tangent")
        s.arcs = [{ id: "arc", a: "b", b: "d", center: "c", clockwise: false }];
      s.constraints = [
        kind === "fixed"
          ? { id: "q", kind, point: "b", x: 2, y: 0 }
          : kind === "horizontal"
            ? { id: "q", kind, segment: "one" }
            : kind === "symmetric"
              ? {
                  id: "q",
                  kind,
                  first: "one",
                  second: "two",
                  axis: "axis",
                  reverse: false,
                }
              : kind === "tangent"
                ? { id: "q", kind, first: "one", second: "arc", point: "b" }
                : { id: "q", kind: "parallel", first: "one", second: "two" },
      ];
      const before = structuredClone(s);
      expect(() => cornerTrimSketch(s, options)).toThrow(/constraint/i);
      expect(s).toEqual(before);
    },
  );
  it.each(["segment", "arc"])(
    "rejects endpoints shared with another %s",
    (kind) => {
      const s = fixture();
      if (kind === "segment") s.segments.push({ id: "other", a: "b", b: "d" });
      else
        s.arcs = [
          { id: "other", a: "a", b: "d", center: "b", clockwise: false },
        ];
      expect(() => cornerTrimSketch(s, options)).toThrow(/shared|used/i);
    },
  );
  it("rejects a finite-input intersection beyond the coordinate bound", () => {
    const s = fixture();
    s.points[2] = { id: "c", x: 0, y: 3 };
    s.points[3] = { id: "d", x: 1, y: 3 - 1e-9 };
    expect(() => cornerTrimSketch(s, options)).toThrow(/out of bounds/);
  });
  it("rejects nonfinite input without mutation", () => {
    const s = fixture();
    s.points[0].x = NaN;
    expect(() => cornerTrimSketch(s, options)).toThrow();
    expect(s.points[0].x).toBeNaN();
  });
  it("merges distinct endpoint IDs already at the intersection", () => {
    const s = fixture();
    s.points[1].x = 3;
    s.points[2].y = 0;
    const r = cornerTrimSketch(s, options);
    expect(r.changed).toBe(true);
    expect(r.pointId).toBe("b");
    expect(r.sketch.segments[1].a).toBe("b");
  });
  it("returns no-op for an existing shared corner even with relations", () => {
    const s = fixture();
    s.segments[1].a = "b";
    s.constraints = [{ id: "f", kind: "fixed", point: "b", x: 2, y: 0 }];
    const r = cornerTrimSketch(s, options);
    expect(r.changed).toBe(false);
    expect(r.pointId).toBe("b");
    expect(r.sketch).toEqual(s);
  });
  it.each([
    "same",
    "missing",
    "parallel",
    "collinear",
    "zero",
    "collapse",
    "bounds",
    "badend",
  ])("rejects %s geometry", (kind) => {
    const s = fixture();
    let o: any = { ...options };
    if (kind === "same") o.second = "one";
    if (kind === "missing") o.second = "absent";
    if (kind === "badend") o.firstEnd = "c";
    if (kind === "parallel" || kind === "collinear") {
      s.points[2] = { id: "c", x: 0, y: kind === "parallel" ? 1 : 0 };
      s.points[3] = { id: "d", x: 4, y: kind === "parallel" ? 1 : 0 };
    }
    if (kind === "zero") s.points[1] = { id: "b", x: 0, y: 0 };
    if (kind === "collapse") {
      s.points[2].x = 0;
      s.points[3].x = 0;
    }
    if (kind === "bounds") {
      s.points[2].x = 2e9;
      s.points[3].x = 2e9;
    }
    expect(() => cornerTrimSketch(s, o)).toThrow();
  });
});

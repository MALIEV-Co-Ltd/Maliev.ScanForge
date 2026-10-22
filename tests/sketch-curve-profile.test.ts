import { describe, expect, it } from "vitest";
import { sketchCurveProfile, type Sketch } from "../src/sketch";

function circle(clockwise = false, radius = 2, shift = 0): Sketch {
  return {
    version: 1,
    points: [
      { id: "a", x: shift + radius, y: shift },
      { id: "b", x: shift - radius, y: shift },
      { id: "c", x: shift, y: shift },
    ],
    segments: [],
    arcs: [
      { id: "upper", a: "a", b: "b", center: "c", clockwise },
      { id: "lower", a: "a", b: "b", center: "c", clockwise: !clockwise },
    ],
    constraints: [],
  };
}

describe("analytic sketch curve profile", () => {
  it.each([false, true])(
    "preserves two exact semicircles and traversal orientation (clockwise=%s)",
    (clockwise) => {
      const sketch = circle(clockwise);
      const original = structuredClone(sketch);
      expect(sketchCurveProfile(sketch)).toEqual([
        { kind: "arc", start: [2, 0], end: [-2, 0], center: [0, 0], clockwise },
        { kind: "arc", start: [-2, 0], end: [2, 0], center: [0, 0], clockwise },
      ]);
      expect(sketch).toEqual(original);
    },
  );

  it("orders mixed lines and reversed arcs without chords or construction edges", () => {
    const sketch = circle();
    sketch.segments = [
      { id: "diameter", a: "b", b: "a" },
      { id: "reference", a: "a", b: "c", construction: true },
    ];
    sketch.arcs = [sketch.arcs![0]];
    expect(sketchCurveProfile(sketch)).toEqual([
      { kind: "line", start: [-2, 0], end: [2, 0] },
      {
        kind: "arc",
        start: [2, 0],
        end: [-2, 0],
        center: [0, 0],
        clockwise: false,
      },
    ]);
  });

  it("admits a large circular profile without a chord-sampling capacity gate", () => {
    expect(sketchCurveProfile(circle(false, 1e9))).toHaveLength(2);
  });

  it("does not lose a translated circle's nonzero analytic area", () => {
    expect(sketchCurveProfile(circle(false, 2, 1e9))).toHaveLength(2);
  });

  it("rejects zero-length edges, including distinct IDs with identical coordinates", () => {
    const sketch = circle();
    sketch.points[1] = { ...sketch.points[1], x: 2 };
    expect(() => sketchCurveProfile(sketch)).toThrow(/zero-length/i);
  });

  it("rejects invalid radii without changing the draft", () => {
    const sketch = circle();
    sketch.points[1].x = -3;
    const original = structuredClone(sketch);
    expect(() => sketchCurveProfile(sketch)).toThrow(/radius|circle/i);
    expect(sketch).toEqual(original);
  });

  it("rejects disconnected cycles even when each component closes", () => {
    const sketch = circle();
    const other = circle();
    sketch.points.push(
      ...other.points.map((p) => ({ ...p, id: "other-" + p.id, x: p.x + 10 })),
    );
    sketch.arcs!.push(
      ...other.arcs!.map((a) => ({
        ...a,
        id: "other-" + a.id,
        a: "other-" + a.a,
        b: "other-" + a.b,
        center: "other-" + a.center,
      })),
    );
    expect(() => sketchCurveProfile(sketch)).toThrow(/disconnected/i);
  });

  it("rejects branches and open profiles", () => {
    const sketch = circle();
    sketch.segments.push({ id: "branch", a: "a", b: "c" });
    expect(() => sketchCurveProfile(sketch)).toThrow(/cycle|closed/i);
    sketch.segments = [];
    sketch.arcs!.pop();
    expect(() => sketchCurveProfile(sketch)).toThrow(/closed/i);
  });

  it("rejects a closed profile whose analytic signed area is zero", () => {
    const sketch = circle();
    sketch.arcs = [];
    sketch.segments = [
      { id: "there", a: "a", b: "b" },
      { id: "back", a: "b", b: "a" },
    ];
    expect(() => sketchCurveProfile(sketch)).toThrow(/area/i);
  });
});

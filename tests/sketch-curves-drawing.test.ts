import { describe, expect, it } from "vitest";
import {
  circleThroughThreePoints,
  drawSketchCircle,
  drawThreePointCurve,
  previewSketchCurve,
} from "../src/sketch-drawing";
import { sampleSketchArc, sketchProfile, type Sketch } from "../src/sketch";
import { coordinateSketchFrame } from "../src/sketch-frame";
import { parseProject, serializeProject } from "../src/io";
const empty = (): Sketch => ({
  version: 1,
  points: [],
  segments: [],
  constraints: [],
  frame: coordinateSketchFrame("OXZ", 17),
  reference: {
    kind: "section",
    sourceId: "scan",
    axis: "y",
    offset: 17,
    onSlicingPlane: true,
    selectedOnly: false,
    sampled: false,
    segments: [0, 0, 2, 2],
  },
});
describe("interactive circular sketch geometry", () => {
  it("appends a circle without replacing existing geometry or losing frame/reference metadata", () => {
    const source = empty();
    source.points = [{ id: "existing", x: 1, y: 2 }];
    const before = structuredClone(source);
    const drawn = drawSketchCircle(source, [3, 4], [8, 4]);
    expect(source).toEqual(before);
    expect(drawn.points[0]).toEqual(source.points[0]);
    expect(drawn.arcs).toHaveLength(2);
    expect(drawn.frame).toEqual(source.frame);
    expect(drawn.reference).toEqual(source.reference);
    const profile = sketchProfile(drawn, 0.01);
    for (const [x, y] of profile)
      expect(Math.hypot(x - 3, y - 4)).toBeCloseTo(5, 8);
    let twiceArea = 0;
    for (let i = 0; i < profile.length; i++) {
      const a = profile[i],
        b = profile[(i + 1) % profile.length];
      twiceArea += a[0] * b[1] - a[1] * b[0];
    }
    expect(Math.abs(twiceArea) / 2).toBeGreaterThan(Math.PI * 25 * 0.99);
    expect(
      parseProject(serializeProject("circle", [], { sketch: drawn })).authoring!
        .sketch,
    ).toEqual(drawn);
  });
  it("computes an accurate three-point circle after a large translation", () => {
    const x = 1e8,
      y = -1e8;
    const circle = circleThroughThreePoints([x + 5, y], [x, y + 5], [x - 5, y]);
    expect(circle.center).toEqual([x, y]);
    expect(circle.radius).toBe(5);
    const sketch = drawThreePointCurve(
      empty(),
      [
        [5, 0],
        [0, 5],
        [-5, 0],
      ],
      "circle3",
    );
    expect(sketch.arcs).toHaveLength(2);
    expect(sketchProfile(sketch).length).toBeGreaterThan(20);
  });
  it.each([1, -1])(
    "creates an arc through the ordered middle point on side %s",
    (side) => {
      const sketch = drawThreePointCurve(
        empty(),
        [
          [5, 0],
          [0, side * 5],
          [-5, 0],
        ],
        "arc3",
      );
      expect(sketch.arcs).toHaveLength(1);
      expect(sketch.arcs![0].clockwise).toBe(side < 0);
      const samples = sampleSketchArc(sketch, sketch.arcs![0], false, 0.01);
      expect(samples.every((p) => p[1] * side >= -1e-8)).toBe(true);
      expect(Math.max(...samples.map((p) => p[1] * side))).toBeCloseTo(5, 1);
    },
  );
  it("chooses a major arc when the middle point requires it", () => {
    const picked: [[number, number], [number, number], [number, number]] = [
      [5, 0],
      [-5, 0],
      [0, 5],
    ];
    const drawn = drawThreePointCurve(empty(), picked, "arc3");
    expect(drawn.arcs![0].clockwise).toBe(true);
    const preview = previewSketchCurve("arc3", picked);
    expect(preview.some((p) => p[1] < -4.9)).toBe(true);
    expect(preview[0][0]).toBeCloseTo(5);
    expect(preview.at(-1)![1]).toBeCloseTo(5);
  });
  it("rejects repeated, collinear, zero-radius and unbounded input atomically", () => {
    const source = empty(),
      before = structuredClone(source);
    expect(() =>
      drawThreePointCurve(
        source,
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        "arc3",
      ),
    ).toThrow(/noncollinear/);
    expect(() => circleThroughThreePoints([0, 0], [0, 0], [1, 1])).toThrow();
    expect(() => drawSketchCircle(source, [1, 1], [1, 1])).toThrow(/positive/);
    expect(() => drawSketchCircle(source, [1e20, 0], [1e20, 10])).toThrow(
      /bounded/,
    );
    expect(() => drawSketchCircle(source, [0, 0], [Infinity, 1])).toThrow();
    expect(source).toEqual(before);
  });
});

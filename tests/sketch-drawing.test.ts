import { describe, expect, it } from "vitest";
import { drawSketchLine, moveSketchEndpoint } from "../src/sketch-drawing";
import { rectangleSketch, sketchProfile, type Sketch } from "../src/sketch";
import { coordinateSketchFrame } from "../src/sketch-frame";
import { parseProject, serializeProject } from "../src/io";

const empty = (): Sketch => ({
  version: 1,
  points: [],
  segments: [],
  constraints: [],
  frame: coordinateSketchFrame("OYZ", 12),
});
describe("model-view sketch drawing", () => {
  it("joins snapped endpoints into a closed profile and retains frame through persistence", () => {
    let sketch = empty();
    for (const [a, b] of [
      [
        [0, 0],
        [20, 0.1],
      ],
      [
        [20.1, 0],
        [20, 10],
      ],
      [
        [20, 10.1],
        [0, 10],
      ],
      [
        [0, 10],
        [0.1, 0],
      ],
    ] as const)
      sketch = drawSketchLine(sketch, [...a], [...b], 0.3, true);
    expect(sketch.points).toHaveLength(4);
    expect(sketch.segments).toHaveLength(4);
    expect(sketch.constraints.map((c) => c.kind)).toEqual([
      "fixed",
      "horizontal",
      "vertical",
      "horizontal",
      "vertical",
    ]);
    expect(sketchProfile(sketch)).toHaveLength(4);
    const project = parseProject(serializeProject("drawn", [], { sketch }));
    expect(project.authoring!.sketch).toEqual(sketch);
    expect(sketch.frame).toEqual(coordinateSketchFrame("OYZ", 12));
  });
  it("allows free lines with constraints disabled and does not mutate its input", () => {
    const sketch = empty(),
      before = structuredClone(sketch);
    const first = drawSketchLine(sketch, [0, 0], [20, 0.1], 0.3, false);
    const second = drawSketchLine(first, [20, 0.1], [20, 10], 0.3, false);
    expect(second.points).toHaveLength(4);
    expect(second.constraints).toHaveLength(0);
    expect(second.points[1].y).toBe(0.1);
    expect(sketch).toEqual(before);
  });
  it("moves connected constrained geometry together without saving a drag constraint", () => {
    let sketch = empty();
    sketch = drawSketchLine(sketch, [5, 0], [20, 0], 0.1, true);
    const moved = moveSketchEndpoint(sketch, sketch.points[1].id, [30, 7]);
    expect(moved.points[0].y).toBeCloseTo(7, 5);
    expect(moved.points[1].x).toBeCloseTo(30, 5);
    expect(moved.constraints).toEqual(sketch.constraints);
    expect(sketch.points[0].y).toBe(0);
  });
  it("rejects fixed endpoint movement atomically and rejects invalid or zero strokes", () => {
    const sketch = rectangleSketch(),
      before = structuredClone(sketch);
    expect(() => moveSketchEndpoint(sketch, "p1", [3, 5])).toThrow(/conflicts/);
    expect(sketch).toEqual(before);
    expect(() => drawSketchLine(empty(), [0, 0], [0, 0], 0.1, true)).toThrow(
      /nonzero/,
    );
    expect(() => drawSketchLine(empty(), [NaN, 0], [3, 0], 0.1, true)).toThrow(
      /finite/,
    );
    expect(() => drawSketchLine(empty(), [0, 0], [3, 0], -1, true)).toThrow(
      /tolerance/,
    );
  });
});

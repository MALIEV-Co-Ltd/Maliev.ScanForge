import { describe, expect, it } from "vitest";
import {
  parseSketch,
  serializeSketch,
  validateSketch,
  rectangleSketch,
  sketchProfile,
  solveSketch,
  type Sketch,
} from "../src/sketch";
describe("constraint sketches", () => {
  it("roundtrips stable authoring IDs and rejects malformed or unknown constraint JSON", () => {
    const sketch = rectangleSketch();
    expect(parseSketch(serializeSketch(sketch))).toEqual(sketch);
    for (const input of [
      null,
      {},
      { ...sketch, points: [{ id: "p", x: "0", y: 0 }] },
      { ...sketch, constraints: [{ id: "x", kind: "future" }] },
      {
        ...sketch,
        constraints: [
          { id: "x", kind: "distance", a: "p1", b: "p2", value: -1 },
        ],
      },
    ])
      expect(() => validateSketch(input)).toThrow();
    const duplicate = rectangleSketch();
    duplicate.points[1].id = "p1";
    expect(() => parseSketch(JSON.stringify(duplicate))).toThrow(/unique/);
  });
  it("solves an anchored dimensioned rectangle with zero local DOF", () => {
    const sketch = rectangleSketch(40, 30);
    sketch.points[2].x = 43;
    sketch.points[2].y = 34;
    const result = solveSketch(sketch);
    expect(result.converged).toBe(true);
    expect(result.degreesOfFreedom).toBe(0);
    expect(result.sketch.points[2].x).toBeCloseTo(40, 4);
    expect(result.sketch.points[2].y).toBeCloseTo(30, 4);
    expect(sketchProfile(result.sketch)).toHaveLength(4);
  });
  it("reports inconsistent dimensions rather than claiming constraint satisfaction", () => {
    const sketch = rectangleSketch();
    sketch.constraints.push({
      id: "conflict",
      kind: "distance",
      a: "p1",
      b: "p2",
      value: 50,
    });
    const result = solveSketch(sketch);
    expect(result.converged).toBe(false);
    expect(result.conflictingConstraintIds).toContain("conflict");
    expect(result.maxResidual).toBeGreaterThan(1);
  });
  it("retains rigid motion degrees of freedom in an unconstrained profile", () => {
    const sketch = rectangleSketch();
    sketch.constraints = [];
    expect(solveSketch(sketch).degreesOfFreedom).toBe(8);
    expect(JSON.parse(JSON.stringify(sketch))).toEqual(sketch);
  });
  it("supports coincident, equal, parallel, perpendicular and signed angle dimensions", () => {
    const sketch: Sketch = {
      version: 1,
      points: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 10, y: 0 },
        { id: "c", x: 0, y: 0 },
        { id: "d", x: 0, y: 10 },
        { id: "e", x: 0, y: 1 },
        { id: "f", x: 10, y: 1 },
      ],
      segments: [
        { id: "u", a: "a", b: "b" },
        { id: "v", a: "c", b: "d" },
        { id: "w", a: "e", b: "f" },
      ],
      constraints: [
        { id: "co", kind: "coincident", a: "a", b: "c" },
        { id: "eq", kind: "equal", first: "u", second: "v" },
        { id: "pe", kind: "perpendicular", first: "u", second: "v" },
        { id: "pa", kind: "parallel", first: "u", second: "w" },
        { id: "an", kind: "angle", first: "u", second: "v", value: 90 },
      ],
    };
    expect(solveSketch(sketch).converged).toBe(true);
  });
  it("rejects disconnected and crossing profiles and missing references", () => {
    const sketch = rectangleSketch();
    sketch.points[1] = { ...sketch.points[1], x: 40, y: 30 };
    sketch.points[2] = { ...sketch.points[2], x: 40, y: 0 };
    expect(() => sketchProfile(sketch)).toThrow(/intersect/);
    const invalid = rectangleSketch();
    invalid.segments[0].a = "missing";
    expect(() => solveSketch(invalid)).toThrow(/reference/);
  });
});

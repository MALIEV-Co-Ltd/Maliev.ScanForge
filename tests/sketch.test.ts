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
  it("solves positive radius dimensions and inherent circular endpoint geometry", () => {
    const sketch: Sketch = {
      version: 1,
      points: [
        { id: "o", x: 0, y: 0 },
        { id: "a", x: 12, y: 0 },
        { id: "b", x: 0, y: 8 },
      ],
      segments: [],
      arcs: [{ id: "arc", a: "a", b: "b", center: "o", clockwise: false }],
      constraints: [
        { id: "origin", kind: "fixed", point: "o", x: 0, y: 0 },
        { id: "r", kind: "radius", arc: "arc", value: 10 },
      ],
    };
    const solved = solveSketch(sketch);
    expect(solved.converged).toBe(true);
    const [o, a, b] = solved.sketch.points;
    expect(Math.hypot(a.x - o.x, a.y - o.y)).toBeCloseTo(10, 4);
    expect(Math.hypot(b.x - o.x, b.y - o.y)).toBeCloseTo(10, 4);
    expect(solved.degreesOfFreedom).toBe(2);
    expect(parseSketch(serializeSketch(solved.sketch)).arcs).toEqual(
      sketch.arcs,
    );
  });
  it("enforces geometric tangency at a shared line/arc endpoint and exposes conflicts", () => {
    const sketch: Sketch = {
      version: 1,
      points: [
        { id: "o", x: 0, y: 0 },
        { id: "a", x: 10, y: 0 },
        { id: "b", x: 0, y: 10 },
        { id: "end", x: 11, y: 5 },
      ],
      segments: [{ id: "line", a: "a", b: "end" }],
      arcs: [{ id: "arc", a: "a", b: "b", center: "o", clockwise: false }],
      constraints: [
        { id: "fo", kind: "fixed", point: "o", x: 0, y: 0 },
        { id: "fa", kind: "fixed", point: "a", x: 10, y: 0 },
        { id: "fb", kind: "fixed", point: "b", x: 0, y: 10 },
        { id: "end-y", kind: "distance", a: "a", b: "end", value: 5 },
        {
          id: "tan",
          kind: "tangent",
          first: "arc",
          second: "line",
          point: "a",
        },
      ],
    };
    const result = solveSketch(sketch);
    expect(result.converged).toBe(true);
    expect(result.sketch.points[3].x).toBeCloseTo(10, 4);
    expect(result.sketch.points[3].y).toBeCloseTo(5, 4);
    const conflict = {
      ...sketch,
      constraints: [
        ...sketch.constraints,
        { id: "locked-end", kind: "fixed" as const, point: "end", x: 11, y: 5 },
      ],
    };
    expect(solveSketch(conflict).converged).toBe(false);
  });
  it("samples a full circular profile as two arcs while ignoring its construction center", () => {
    const sketch: Sketch = {
      version: 1,
      points: [
        { id: "o", x: 0, y: 0 },
        { id: "a", x: 10, y: 0 },
        { id: "b", x: -10, y: 0 },
      ],
      segments: [],
      arcs: [
        { id: "upper", a: "a", b: "b", center: "o", clockwise: false },
        { id: "lower", a: "b", b: "a", center: "o", clockwise: false },
      ],
      constraints: [],
    };
    const profile = sketchProfile(sketch, 0.005);
    expect(profile.length).toBeGreaterThan(80);
    const area = Math.abs(
      profile.reduce((sum, p, i) => {
        const q = profile[(i + 1) % profile.length];
        return sum + p[0] * q[1] - p[1] * q[0];
      }, 0) / 2,
    );
    expect(Math.abs(area - Math.PI * 100)).toBeLessThan(0.25);
    for (const point of profile)
      expect(Math.hypot(...point)).toBeCloseTo(10, 6);
    const wrong = {
      ...sketch,
      points: sketch.points.map((p) => (p.id === "b" ? { ...p, x: -9 } : p)),
    };
    expect(() => sketchProfile(wrong)).toThrow(/same positive-radius/);
  });
  it("validates arc serialization, references and tangent endpoint ownership", () => {
    const sketch: Sketch = {
      version: 1,
      points: [
        { id: "o", x: 0, y: 0 },
        { id: "a", x: 10, y: 0 },
        { id: "b", x: 0, y: 10 },
      ],
      segments: [{ id: "line", a: "a", b: "b" }],
      arcs: [{ id: "arc", a: "a", b: "b", center: "o", clockwise: false }],
      constraints: [],
    };
    expect(parseSketch(serializeSketch(sketch))).toEqual(sketch);
    expect(() =>
      validateSketch({
        ...sketch,
        arcs: [{ ...sketch.arcs![0], center: "missing" }],
      }),
    ).toThrow(/Arc references/);
    expect(() =>
      validateSketch({
        ...sketch,
        constraints: [{ id: "radius", kind: "radius", arc: "arc", value: 0 }],
      }),
    ).toThrow(/positive/);
    expect(() =>
      validateSketch({
        ...sketch,
        constraints: [
          {
            id: "tan",
            kind: "tangent",
            first: "arc",
            second: "line",
            point: "o",
          },
        ],
      }),
    ).toThrow(/sharing/);
    expect(() =>
      validateSketch({
        ...sketch,
        arcs: [{ ...sketch.arcs![0], clockwise: "false" }],
      }),
    ).toThrow(/structure/);
  });
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

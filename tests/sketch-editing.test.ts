import { describe, expect, it } from "vitest";
import {
  parseSketch,
  rectangleSketch,
  removeSketchGeometry,
  serializeSketch,
  solveSketch,
  sketchProfile,
  constrainSketch,
  validateSketch,
  type Sketch,
} from "../src/sketch";

describe("directional sketch dimensions", () => {
  it("applies a solved relation atomically and preserves the prior draft on conflict", () => {
    const input = rectangleSketch();
    const next = constrainSketch(input, {
      id: "diagonal-v",
      kind: "verticalDistance",
      a: "p1",
      b: "p3",
      value: 30,
    });
    expect(next.constraints).toHaveLength(8);
    expect(solveSketch(next).converged).toBe(true);
    expect(() =>
      constrainSketch(input, {
        id: "conflict",
        kind: "horizontalDistance",
        a: "p1",
        b: "p2",
        value: 90,
      }),
    ).toThrow(/Conflicting/);
    expect(input.constraints).toHaveLength(7);
    expect(input.points[1].x).toBe(40);
  });
  it.each([1, -1])(
    "solves independent horizontal and vertical distances on side %s",
    (side) => {
      const input: Sketch = {
        version: 1,
        points: [
          { id: "a", x: 3, y: 4 },
          { id: "b", x: 3 + side * 5, y: 4 + side * 2 },
        ],
        segments: [],
        constraints: [
          { id: "fixed", kind: "fixed", point: "a", x: 3, y: 4 },
          {
            id: "horizontal",
            kind: "horizontalDistance",
            a: "a",
            b: "b",
            value: 12,
          },
          {
            id: "vertical",
            kind: "verticalDistance",
            a: "a",
            b: "b",
            value: 7,
          },
        ],
      };
      const solved = solveSketch(input);
      expect(solved.converged).toBe(true);
      expect(solved.degreesOfFreedom).toBe(0);
      expect(solved.sketch.points[1].x).toBeCloseTo(3 + side * 12, 5);
      expect(solved.sketch.points[1].y).toBeCloseTo(4 + side * 7, 5);
      expect(input.points[1].x).toBe(3 + side * 5);
      expect(parseSketch(serializeSketch(solved.sketch))).toEqual(
        solved.sketch,
      );
    },
  );
  it("leaves the unmeasured coordinate free instead of using Euclidean distance", () => {
    const input: Sketch = {
      version: 1,
      points: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 5, y: 100 },
      ],
      segments: [],
      constraints: [
        { id: "f", kind: "fixed", point: "a", x: 0, y: 0 },
        { id: "h", kind: "horizontalDistance", a: "b", b: "a", value: 20 },
      ],
    };
    const result = solveSketch(input);
    expect(result.converged).toBe(true);
    expect(result.sketch.points[1].x).toBeCloseTo(20, 5);
    expect(result.sketch.points[1].y).toBe(100);
    expect(result.degreesOfFreedom).toBe(1);
  });
  it("rejects missing points, nonfinite and negative dimensions and reports conflicting fixed geometry", () => {
    const input: Sketch = {
      version: 1,
      points: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 5, y: 0 },
      ],
      segments: [],
      constraints: [
        { id: "fa", kind: "fixed", point: "a", x: 0, y: 0 },
        { id: "fb", kind: "fixed", point: "b", x: 5, y: 0 },
        { id: "v", kind: "verticalDistance", a: "a", b: "b", value: 10 },
      ],
    };
    expect(solveSketch(input).converged).toBe(false);
    for (const value of [-1, NaN, Infinity])
      expect(() =>
        validateSketch({
          ...input,
          constraints: [
            { id: "d", kind: "verticalDistance", a: "a", b: "b", value },
          ],
        }),
      ).toThrow();
    expect(() =>
      validateSketch({
        ...input,
        constraints: [
          {
            id: "d",
            kind: "horizontalDistance",
            a: "a",
            b: "missing",
            value: 1,
          },
        ],
      }),
    ).toThrow(/missing/);
  });
});

const connected: Sketch = {
  version: 1,
  points: [
    { id: "a", x: 1, y: 0 },
    { id: "b", x: 0, y: 1 },
    { id: "o", x: 0, y: 0 },
    { id: "c", x: 1, y: 2 },
  ],
  segments: [{ id: "line", a: "a", b: "c" }],
  arcs: [{ id: "arc", a: "a", b: "b", center: "o", clockwise: false }],
  constraints: [
    { id: "fixed", kind: "fixed", point: "c", x: 1, y: 2 },
    { id: "radius", kind: "radius", arc: "arc", value: 1 },
    {
      id: "tangent",
      kind: "tangent",
      first: "arc",
      second: "line",
      point: "a",
    },
    { id: "vertical", kind: "vertical", segment: "line" },
    { id: "distance", kind: "verticalDistance", a: "o", b: "c", value: 2 },
  ],
};
describe("scoped sketch deletion", () => {
  it("removes only constraints of a deleted segment and preserves point dimensions", () => {
    const sketch = rectangleSketch();
    const next = removeSketchGeometry(sketch, "segment", "s1");
    expect(next.constraints.map((c) => c.id)).toEqual([
      "c1",
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
    ]);
    expect(next.points).toEqual(sketch.points);
    expect(sketch.constraints).toHaveLength(7);
    expect(solveSketch(next).converged).toBe(true);
  });
  it("cascades point deletion through lines, arcs, radii and tangency while preserving independent relations", () => {
    const next = removeSketchGeometry(connected, "point", "a");
    expect(next.segments).toHaveLength(0);
    expect(next.arcs).toHaveLength(0);
    expect(next.constraints.map((c) => c.id)).toEqual(["fixed", "distance"]);
    expect(parseSketch(serializeSketch(next))).toEqual(next);
    expect(connected.arcs).toHaveLength(1);
  });
  it("deletes arc relations without deleting the adjacent line or its constraint", () => {
    const next = removeSketchGeometry(connected, "arc", "arc");
    expect(next.constraints.map((c) => c.id)).toEqual([
      "fixed",
      "vertical",
      "distance",
    ]);
    expect(next.segments).toEqual(connected.segments);
  });
});

describe("construction geometry", () => {
  it("keeps a constrained construction diagonal out of the extrusion boundary", () => {
    const sketch = rectangleSketch();
    const withReference: Sketch = {
      ...sketch,
      segments: [
        ...sketch.segments,
        { id: "diagonal", a: "p1", b: "p3", construction: true },
      ],
      constraints: [
        ...sketch.constraints,
        {
          id: "angle",
          kind: "angle",
          first: "s1",
          second: "diagonal",
          value: (Math.atan2(30, 40) * 180) / Math.PI,
        },
      ],
    };
    expect(sketchProfile(withReference)).toEqual(sketchProfile(sketch));
    expect(solveSketch(withReference).converged).toBe(true);
    expect(parseSketch(serializeSketch(withReference))).toEqual(withReference);
    expect(() =>
      sketchProfile({
        ...withReference,
        segments: withReference.segments.map((s) => ({
          ...s,
          construction: false,
        })),
      }),
    ).toThrow(/unbranched/);
  });
  it("excludes construction arcs while validating their references and flag type", () => {
    const sketch = rectangleSketch();
    const reference: Sketch = {
      ...sketch,
      points: [...sketch.points, { id: "center", x: 20, y: 0 }],
      arcs: [
        {
          id: "arc",
          a: "p1",
          b: "p2",
          center: "center",
          clockwise: false,
          construction: true,
        },
      ],
    };
    expect(sketchProfile(reference)).toEqual(sketchProfile(sketch));
    expect(() =>
      validateSketch({
        ...reference,
        arcs: [{ ...reference.arcs![0], construction: "true" }],
      }),
    ).toThrow(/arc structure/);
    expect(() =>
      validateSketch({
        ...reference,
        segments: [{ ...sketch.segments[0], construction: 1 }],
      }),
    ).toThrow(/segment structure/);
  });
});

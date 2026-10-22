import { describe, expect, it } from "vitest";
import {
  constrainSketch,
  parseSketch,
  removeSketchGeometry,
  serializeSketch,
  solveSketch,
  validateSketch,
  type Sketch,
  type SketchConstraint,
} from "../src/sketch";

const symmetry = (reverse = false): SketchConstraint => ({
  id: "sym",
  kind: "symmetric",
  first: "left",
  second: "right",
  axis: "axis",
  reverse,
});
function lines(reverse = false): Sketch {
  return {
    version: 1,
    points: [
      { id: "a", x: -2, y: 0 },
      { id: "b", x: -2, y: 3 },
      { id: "c", x: 3, y: reverse ? 3 : 0 },
      { id: "d", x: 3, y: reverse ? 0 : 3 },
      { id: "o", x: 0, y: -4 },
      { id: "p", x: 0, y: 5 },
    ],
    segments: [
      { id: "left", a: "a", b: "b" },
      { id: "right", a: "c", b: "d" },
      { id: "axis", a: "o", b: "p", construction: true },
    ],
    constraints: [symmetry(reverse)],
  };
}
function fix(sketch: Sketch, ids: string[]) {
  sketch.constraints.push(
    ...ids.map((id) => {
      const p = sketch.points.find((p) => p.id === id)!;
      return {
        id: "fix-" + id,
        kind: "fixed" as const,
        point: id,
        x: p.x,
        y: p.y,
      };
    }),
  );
  return sketch;
}
function point(sketch: Sketch, id: string) {
  return sketch.points.find((p) => p.id === id)!;
}

describe("construction-axis sketch symmetry", () => {
  it.each([false, true])(
    "reflects a line pair with stable endpoint reversal=%s",
    (reverse) => {
      const sketch = fix(lines(reverse), ["a", "b", "o", "p"]),
        before = structuredClone(sketch);
      const solved = solveSketch(sketch);
      expect(solved.converged).toBe(true);
      expect(point(solved.sketch, "c").x).toBeCloseTo(2, 5);
      expect(point(solved.sketch, "d").x).toBeCloseTo(2, 5);
      expect(point(solved.sketch, "c").y).toBeCloseTo(reverse ? 3 : 0, 5);
      expect(solved.degreesOfFreedom).toBe(0);
      expect(sketch).toEqual(before);
    },
  );

  it("reflects about an oblique translated construction axis", () => {
    const sketch = lines();
    const angle = 0.63,
      c = Math.cos(angle),
      s = Math.sin(angle);
    for (const p of sketch.points) {
      const x = p.x,
        y = p.y;
      p.x = 11 + c * x - s * y;
      p.y = -7 + s * x + c * y;
    }
    fix(sketch, ["a", "b", "o", "p"]);
    const solved = solveSketch(sketch);
    expect(solved.converged).toBe(true);
    expect(point(solved.sketch, "c").x).toBeCloseTo(11 + 2 * c, 5);
    expect(point(solved.sketch, "c").y).toBeCloseTo(-7 + 2 * s, 5);
  });

  it("allows an unfixed axis to move to the perpendicular bisectors", () => {
    const sketch = fix(lines(), ["a", "b", "c", "d"]);
    const solved = solveSketch(sketch);
    expect(solved.converged).toBe(true);
    expect(point(solved.sketch, "o").x).toBeCloseTo(0.5, 5);
    expect(point(solved.sketch, "p").x).toBeCloseTo(0.5, 5);
  });

  it.each([false, true])(
    "reflects arc endpoints and centers with compatible orientation (reverse=%s)",
    (reverse) => {
      const sketch: Sketch = {
        version: 1,
        points: [
          { id: "a", x: -2, y: 0 },
          { id: "b", x: -3, y: 1 },
          { id: "lc", x: -3, y: 0 },
          { id: "c", x: reverse ? 3.2 : 2.2, y: reverse ? 1.2 : 0.2 },
          { id: "d", x: reverse ? 2.2 : 3.2, y: reverse ? 0.2 : 1.2 },
          { id: "rc", x: 3.2, y: 0.2 },
          { id: "o", x: 0, y: -4 },
          { id: "p", x: 0, y: 5 },
        ],
        segments: [{ id: "axis", a: "o", b: "p", construction: true }],
        arcs: [
          { id: "left", a: "a", b: "b", center: "lc", clockwise: false },
          { id: "right", a: "c", b: "d", center: "rc", clockwise: !reverse },
        ],
        constraints: [symmetry(reverse)],
      };
      fix(sketch, ["a", "b", "lc", "o", "p"]);
      const solved = solveSketch(sketch);
      expect(solved.converged).toBe(true);
      expect(point(solved.sketch, "rc").x).toBeCloseTo(3, 5);
      expect(point(solved.sketch, "rc").y).toBeCloseTo(0, 5);
      expect(point(solved.sketch, "c").x).toBeCloseTo(reverse ? 3 : 2, 5);
      expect(point(solved.sketch, "c").y).toBeCloseTo(reverse ? 1 : 0, 5);
      expect(solved.degreesOfFreedom).toBe(0);
    },
  );

  it("attributes symmetry and following fixed conflicts to their own residual rows", () => {
    const sketch = fix(lines(), ["a", "b", "c", "d", "o", "p"]);
    const solved = solveSketch(sketch, 1e-6, 0);
    expect(solved.converged).toBe(false);
    expect(solved.conflictingConstraintIds).toEqual(["sym"]);
    expect(() =>
      constrainSketch(
        { ...sketch, constraints: sketch.constraints.slice(1) },
        symmetry(),
      ),
    ).toThrow(/conflict|unsolved/i);
  });

  it("does not misattribute an intrinsic arc-radius failure after six symmetry rows", () => {
    const sketch = lines();
    sketch.points.push({ id: "lc", x: -2, y: 1.5 }, { id: "rc", x: 2, y: 1.5 });
    point(sketch, "c").x = 2;
    point(sketch, "d").x = 2;
    point(sketch, "d").y = 4;
    sketch.segments = [sketch.segments[2]];
    sketch.arcs = [
      { id: "left", a: "a", b: "b", center: "lc", clockwise: false },
      { id: "right", a: "c", b: "d", center: "rc", clockwise: true },
    ];
    const solved = solveSketch(sketch, 1e-6, 0);
    expect(solved.conflictingConstraintIds).toContain("sym");
    expect(solved.conflictingConstraintIds).toContain("arc:right");
    expect(solved.conflictingConstraintIds).not.toContain("arc:left");
  });

  it("keeps finite DOF when a finite-difference perturbation collapses a short axis", () => {
    const sketch = lines();
    point(sketch, "o").x = -1e-5;
    point(sketch, "o").y = 0;
    point(sketch, "p").x = 0;
    point(sketch, "p").y = 0;
    const solved = solveSketch(fix(sketch, ["a", "b", "o", "p"]));
    expect(solved.converged).toBe(true);
    expect(Number.isFinite(solved.degreesOfFreedom)).toBe(true);
    expect(
      solved.sketch.points.every(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
      ),
    ).toBe(true);
  });

  it("never reports convergence when another arc produces a nonfinite residual", () => {
    const sketch = lines();
    point(sketch, "c").x = 2;
    point(sketch, "d").x = 2;
    sketch.points.push(
      { id: "overflow-a", x: -1e308, y: 0 },
      { id: "overflow-b", x: -1e308, y: 1 },
      { id: "overflow-center", x: 1e308, y: 0 },
    );
    sketch.arcs = [
      {
        id: "overflow-arc",
        a: "overflow-a",
        b: "overflow-b",
        center: "overflow-center",
        clockwise: false,
      },
    ];
    const solved = solveSketch(sketch);
    expect(solved.converged).toBe(false);
    expect(solved.conflictingConstraintIds).toContain("arc:overflow-arc");
    expect(Number.isNaN(solved.maxResidual)).toBe(false);
  });

  it.each(["axis", "left", "a", "o"])(
    "removes dependent symmetry after deleting %s",
    (id) => {
      const sketch = lines();
      expect(
        removeSketchGeometry(
          sketch,
          id === "a" || id === "o" ? "point" : "segment",
          id,
        ).constraints.some((c) => c.id === "sym"),
      ).toBe(false);
    },
  );

  it("roundtrips the stable correspondence without modifying existing sketch version", () => {
    const sketch = lines(true);
    expect(parseSketch(serializeSketch(sketch))).toEqual(sketch);
  });

  it.each([
    { first: "missing" },
    { first: "right" },
    { axis: "missing" },
    { axis: "left" },
    { reverse: 1 },
  ])("rejects invalid symmetry references or fields: %j", (patch) => {
    const sketch = lines();
    sketch.constraints = [{ ...symmetry(), ...patch } as SketchConstraint];
    expect(() => validateSketch(sketch)).toThrow(/symmetr|axis|construction/i);
  });

  it("rejects mixed curve types and incompatible reflected arc orientation", () => {
    const sketch = lines();
    sketch.points.push({ id: "center", x: 3, y: 1.5 });
    sketch.arcs = [
      { id: "arc", a: "c", b: "d", center: "center", clockwise: false },
    ];
    sketch.constraints = [{ ...symmetry(), second: "arc" } as SketchConstraint];
    expect(() => validateSketch(sketch)).toThrow(/same|symmetr/i);
    sketch.segments = sketch.segments.filter((s) => s.id !== "left");
    sketch.arcs.push({
      id: "left",
      a: "a",
      b: "b",
      center: "o",
      clockwise: false,
    });
    expect(() => validateSketch(sketch)).toThrow(/orientation|symmetr/i);
  });

  it("requires a nondegenerate construction axis", () => {
    const sketch = lines();
    sketch.segments[2].construction = false;
    expect(() => validateSketch(sketch)).toThrow(/construction|axis/i);
    sketch.segments[2].construction = true;
    point(sketch, "p").x = point(sketch, "o").x;
    point(sketch, "p").y = point(sketch, "o").y;
    expect(() => validateSketch(sketch)).toThrow(/axis|degenerate/i);
  });
});

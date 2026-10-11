import { describe, expect, it } from "vitest";
import {
  createGridPatch,
  editControlPoint,
  evaluatePatch,
  fitGridSurface,
  importQuadGridObj,
  parsePatch,
  serializePatch,
  snapControlPoint,
  tessellatePatch,
  validatePatch,
  type NurbsPatch,
} from "../src/surfaces";

describe("tensor rational B-spline patches", () => {
  it("preserves linear planar geometry with an interior knot and clamped endpoints", () => {
    const patch = createGridPatch(6, 5, 20, 30, 3);
    expect(evaluatePatch(patch, 0, 0)).toEqual([0, 0, 0]);
    expect(evaluatePatch(patch, 1, 1)).toEqual([20, 30, 0]);
    const p = evaluatePatch(patch, 0.37, 0.62);
    expect(p[0]).toBeCloseTo(7.4, 10);
    expect(p[1]).toBeCloseTo(18.6, 10);
    const mesh = tessellatePatch(patch, 3, 2);
    expect(mesh).toHaveLength(108);
    expect(mesh.every(Number.isFinite)).toBe(true);
    expect(parsePatch(serializePatch(patch))).toEqual(patch);
  });
  it("evaluates an exact rational quarter cylinder", () => {
    const patch: NurbsPatch = {
      format: "scanforge-nurbs",
      version: 1,
      countU: 3,
      countV: 2,
      degreeU: 2,
      degreeV: 1,
      knotsU: [0, 0, 0, 1, 1, 1],
      knotsV: [0, 0, 1, 1],
      points: [
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
        [1, 0, 5],
        [1, 1, 5],
        [0, 1, 5],
      ],
      weights: [1, Math.SQRT1_2, 1, 1, Math.SQRT1_2, 1],
    };
    const p = evaluatePatch(patch, 0.5, 0.5);
    expect(p[0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(p[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(p[2]).toBe(2.5);
    expect(p[0] ** 2 + p[1] ** 2).toBeCloseTo(1, 12);
  });
  it("edits controls independently and snaps to the nearest actual scan vertex", () => {
    const patch = createGridPatch(2, 2, 10, 10, 1);
    const edited = editControlPoint(patch, 0, [1, 1, 2], 2);
    expect(patch.points[0]).toEqual([0, 0, 0]);
    expect(edited.weights[0]).toBe(2);
    expect(
      snapControlPoint(edited, 0, new Float32Array([8, 8, 8, 1, 2, 3]))
        .points[0],
    ).toEqual([1, 2, 3]);
    expect(() => editControlPoint(patch, 0, [0, 0, 0], 0)).toThrow(/positive/);
    expect(() => snapControlPoint(patch, 0, [NaN, 0, 0])).toThrow(/nonfinite/);
  });
  it("rejects invalid knots, control sizes and out-of-domain evaluation", () => {
    const patch = createGridPatch();
    expect(() =>
      validatePatch({ ...patch, knotsU: [0, 0, 0, 0, 1, 0.5, 1, 1] }),
    ).toThrow(/nondecreasing/);
    expect(() =>
      validatePatch({ ...patch, knotsV: [0, 0, 0, 0, 0, 1, 1, 1] }),
    ).toThrow(/empty|multiplicity/);
    expect(() => validatePatch({ ...patch, weights: [1] })).toThrow(/counts/);
    expect(() => evaluatePatch(patch, -0.1, 0)).toThrow(/domain/);
    expect(() => createGridPatch(17, 4)).toThrow(/integer/);
    expect(() => tessellatePatch(patch, 0, 4)).toThrow(/integer/);
  });
  it("recovers a manufactured curved height field with measured residuals", () => {
    const points: number[] = [];
    for (let j = 0; j <= 20; j++)
      for (let i = 0; i <= 20; i++) {
        const x = i / 2,
          y = j / 2;
        points.push(x, y, 2 + x * x * 0.1 + y * 0.4);
      }
    const fit = fitGridSurface(new Float32Array(points), {
      countU: 4,
      countV: 4,
      projection: "xy",
      sampleLimit: 441,
    });
    expect(fit.samples).toBe(441);
    expect(fit.rms).toBeLessThan(1e-6);
    expect(fit.maxError).toBeLessThan(2e-6);
    const p = evaluatePatch(fit.patch, 0.37, 0.62);
    expect(p[2]).toBeCloseTo(2 + 3.7 ** 2 * 0.1 + 6.2 * 0.4, 5);
    expect(fit.solverBytes).toBeGreaterThan(16 * 16 * 8);
  });
  it("supports alternate projection and rejects unconstrained/invalid fits", () => {
    const scan: number[] = [];
    for (let y = 0; y < 5; y++)
      for (let z = 0; z < 5; z++) scan.push(3 + y + 2 * z, y, z);
    const fit = fitGridSurface(scan, {
      countU: 2,
      countV: 2,
      degree: 1,
      projection: "yz",
      sampleLimit: 25,
    });
    const middle = evaluatePatch(fit.patch, 0.5, 0.5);
    expect(middle[0]).toBeCloseTo(9, 10);
    expect(middle[1]).toBeCloseTo(2, 10);
    expect(middle[2]).toBeCloseTo(2, 10);
    expect(() =>
      fitGridSurface([0, 0, 0, 1, 0, 1], {
        countU: 2,
        countV: 2,
        projection: "xy",
        sampleLimit: 16,
      }),
    ).toThrow(/two finite/);
    const diagonal = Array.from({ length: 20 }, (_, i) => [i, i, i]).flat();
    expect(() =>
      fitGridSurface(diagonal, {
        countU: 2,
        countV: 2,
        degree: 1,
        projection: "xy",
        sampleLimit: 20,
      }),
    ).toThrow(/constrain/);
    expect(() =>
      fitGridSurface(scan, {
        countU: 8,
        countV: 8,
        projection: "xy",
        sampleLimit: 25,
      }),
    ).toThrow(/coefficients/);
  });
  it("imports ordered quad control grids and rejects unsupported topology", () => {
    const obj = "v 0 0 0\nv 10 0 0\nv 0 10 2\nv 10 10 3\nf 1 2 4 3";
    const patch = importQuadGridObj(obj, 2, 2, 1);
    expect(evaluatePatch(patch, 1, 1)).toEqual([10, 10, 3]);
    expect(() =>
      importQuadGridObj(obj.replace("1 2 4 3", "1 4 2 3"), 2, 2, 1),
    ).toThrow(/crossed/);
    expect(() =>
      importQuadGridObj(obj.replace("1 2 4 3", "1 2 3"), 2, 2, 1),
    ).toThrow(/quads/);
    expect(() => importQuadGridObj(obj, 3, 2, 1)).toThrow(/dimensions/);
  });
});

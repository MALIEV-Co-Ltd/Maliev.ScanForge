import { describe, expect, it } from "vitest";
import {
  createGridPatch,
  editControlPoint,
  evaluatePatch,
  fitGridSurface,
  importQuadGridObj,
  joinPatchBoundary,
  insertPatchKnot,
  preparePatchCrease,
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

describe("exact rational knot refinement", () => {
  it("preserves nonunit-weight curved geometry through U and V insertion", () => {
    const original = createGridPatch(5, 4, 20, 30, 3);
    original.points = original.points.map((p, i) => [
      p[0],
      p[1],
      Math.sin(i) * 4,
    ]);
    original.weights = original.weights.map((_, i) => 0.7 + (i % 7) / 3);
    const snapshot = serializePatch(original);
    const refined = insertPatchKnot(
      insertPatchKnot(original, "u", 0.27, 2),
      "v",
      0.61,
    );
    expect(refined.countU).toBe(7);
    expect(refined.countV).toBe(5);
    expect(refined.knotsU.filter((x) => x === 0.27)).toHaveLength(2);
    for (const u of [0, 0.13, 0.27, 0.5, 0.77, 1])
      for (const v of [0, 0.17, 0.61, 0.93, 1]) {
        const a = evaluatePatch(original, u, v),
          b = evaluatePatch(refined, u, v);
        for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k], 10);
      }
    expect(serializePatch(original)).toBe(snapshot);
  });
  it("refines normalized nonunit knot domains and prepares a shape-preserving crease", () => {
    const original = createGridPatch(4, 4, 20, 30);
    original.knotsU = [2, 2, 2, 2, 8, 8, 8, 8];
    original.points[5][2] = 5;
    original.weights[5] = 2;
    const once = insertPatchKnot(original, "u", 0.5);
    const crease = preparePatchCrease(once, "u", 0.5);
    expect(crease.knotsU.filter((knot) => knot === 5)).toHaveLength(3);
    expect(crease.countU).toBe(7);
    for (const u of [2, 2.37, 5, 6.21, 8]) {
      const a = evaluatePatch(original, u, 0.4),
        b = evaluatePatch(crease, u, 0.4);
      for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k], 10);
    }
    expect(() => preparePatchCrease(crease, "u", 0.5)).toThrow(/already/);
  });
  it("rejects endpoint insertion, excessive multiplicity and resource-resolution bounds", () => {
    const patch = createGridPatch();
    for (const parameter of [0, 1, -0.1, 1.1, NaN])
      expect(() => insertPatchKnot(patch, "u", parameter)).toThrow(
        /strictly inside/,
      );
    const crease = preparePatchCrease(patch, "u", 0.4);
    expect(() => insertPatchKnot(crease, "u", 0.4)).toThrow(/multiplicity/);
    expect(() => insertPatchKnot(patch, "v", 0.4, 4)).toThrow(/integer/);
    expect(() => insertPatchKnot(createGridPatch(16, 4), "u", 0.4)).toThrow(
      /16-control/,
    );
    expect(() => preparePatchCrease(createGridPatch(15, 4), "u", 0.37)).toThrow(
      /16-control/,
    );
  });
});

describe("compatible two-patch boundary continuity", () => {
  it("joins rational C0 boundaries without mutating either input or target inner rows", () => {
    const a = createGridPatch(4, 4, 20, 30),
      b = createGridPatch(4, 4, 70, 40);
    a.weights = a.weights.map((_, i) => 1 + i / 20);
    a.points = a.points.map((p, i) => [p[0], p[1], Math.sin(i)]);
    const originals = JSON.stringify([a, b]);
    const joined = joinPatchBoundary(a, b, {
      referenceEdge: "u1",
      targetEdge: "u0",
      continuity: "C0",
    });
    for (const t of [0, 0.17, 0.5, 0.91, 1]) {
      const pa = evaluatePatch(a, 1, t),
        pb = evaluatePatch(joined, 0, t);
      for (let k = 0; k < 3; k++) expect(pa[k]).toBeCloseTo(pb[k], 11);
    }
    expect(joined.points[1]).toEqual(b.points[1]);
    expect(JSON.stringify([a, b])).toBe(originals);
  });
  it("matches rational C1 transverse derivatives with different degrees and domains", () => {
    const a = createGridPatch(4, 4, 20, 30),
      b = createGridPatch(3, 4, 70, 40);
    b.knotsU = [0, 0, 0, 2, 2, 2];
    a.points = a.points.map((p, i) => [p[0], p[1], Math.cos(i) * 2]);
    a.weights = a.weights.map((_, i) =>
      i % 4 === 3 ? 1 + Math.floor(i / 4) * 0.2 : 0.8 + Math.floor(i / 4) * 0.1,
    );
    const joined = joinPatchBoundary(a, b, {
      referenceEdge: "u1",
      targetEdge: "u0",
      continuity: "C1",
    });
    const epsilon = 1e-6;
    for (const t of [0, 0.17, 0.5, 0.91, 1]) {
      const edgeA = evaluatePatch(a, 1, t),
        edgeB = evaluatePatch(joined, 0, t);
      const innerA = evaluatePatch(a, 1 - epsilon, t),
        innerB = evaluatePatch(joined, 2 * epsilon, t);
      for (let k = 0; k < 3; k++) {
        expect(edgeA[k]).toBeCloseTo(edgeB[k], 10);
        expect((edgeA[k] - innerA[k]) / epsilon).toBeCloseTo(
          (innerB[k] - edgeB[k]) / epsilon,
          3,
        );
      }
    }
  });
  it("handles reversed seam ordering and cross-axis boundary joins", () => {
    const a = createGridPatch(4, 4, 20, 30),
      b = createGridPatch(4, 4, 70, 40);
    const joined = joinPatchBoundary(a, b, {
      referenceEdge: "u1",
      targetEdge: "v0",
      continuity: "C1",
      reverse: true,
    });
    for (const t of [0, 0.23, 0.77, 1]) {
      const pa = evaluatePatch(a, 1, 1 - t),
        pb = evaluatePatch(joined, t, 0);
      for (let k = 0; k < 3; k++) expect(pa[k]).toBeCloseTo(pb[k], 10);
      const eps = 1e-6,
        ai = evaluatePatch(a, 1 - eps, 1 - t),
        bi = evaluatePatch(joined, t, eps);
      for (let k = 0; k < 3; k++)
        expect((pa[k] - ai[k]) / eps).toBeCloseTo((bi[k] - pb[k]) / eps, 3);
    }
  });
  it("rejects incompatible seam knots/degrees/counts and invalid rational weights", () => {
    const a = createGridPatch(4, 4, 20, 30),
      b = createGridPatch(4, 4, 70, 40);
    const opts = {
      referenceEdge: "u1" as const,
      targetEdge: "u0" as const,
      continuity: "C1" as const,
    };
    expect(() => joinPatchBoundary(a, createGridPatch(4, 5), opts)).toThrow(
      /compatible/,
    );
    expect(() =>
      joinPatchBoundary(a, createGridPatch(4, 4, 1, 1, 2), opts),
    ).toThrow(/compatible/);
    const source = createGridPatch(4, 5, 20, 30, 2),
      target = createGridPatch(4, 5, 70, 40, 2);
    source.knotsV = [0, 0, 0, 0.2, 0.7, 1, 1, 1];
    expect(() =>
      joinPatchBoundary(source, target, { ...opts, reverse: true }),
    ).toThrow(/compatible/);
    a.weights[2] = 3;
    expect(() => joinPatchBoundary(a, b, opts)).toThrow(/nonpositive/);
    a.weights[2] = 0;
    expect(() => joinPatchBoundary(a, b, opts)).toThrow(/positive/);
    const unclamped = createGridPatch(4, 4);
    unclamped.knotsU = [0, 0, 0, 0.1, 0.8, 1, 1, 1];
    expect(() => joinPatchBoundary(b, unclamped, opts)).toThrow(/clamped/);
  });
});

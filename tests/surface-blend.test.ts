import { describe, expect, it } from "vitest";
import {
  blendPatchBoundaries,
  createGridPatch,
  evaluatePatch,
  validatePatch,
  type NurbsPatch,
  type PatchEdge,
  type PatchJoinOptions,
} from "../src/surfaces";
import type { Vec3 } from "../src/types";

const edges: PatchEdge[] = ["u0", "u1", "v0", "v1"];
const samples = [0, 0.13, 0.41, 0.78, 1];
const options: PatchJoinOptions = {
  referenceEdge: "u1",
  targetEdge: "u0",
  continuity: "C1",
};

function rationalPatch(offset: number, interior = 0.25): NurbsPatch {
  const patch = createGridPatch(4, 4, 18, 23, 2);
  // Unequal end spans and different non-unit domains exercise normalized derivatives.
  patch.knotsU = [2, 2, 2, 2 + 6 * interior, 8, 8, 8];
  patch.knotsV = [-3, -3, -3, -3 + 10 * interior, 7, 7, 7];
  patch.points = patch.points.map((point, index) => {
    const u = index % 4,
      v = Math.floor(index / 4);
    return [point[0] + offset, point[1] - offset / 3, u * v + (u * u) / 3];
  });
  patch.weights = patch.weights.map(
    (_, index) => 1 + (index % 4) * 0.02 + Math.floor(index / 4) * 0.04,
  );
  return patch;
}

function normalizedPoint(patch: NurbsPatch, u: number, v: number): Vec3 {
  const startU = patch.knotsU[patch.degreeU],
    startV = patch.knotsV[patch.degreeV];
  return evaluatePatch(
    patch,
    startU + u * (patch.knotsU[patch.countU] - startU),
    startV + v * (patch.knotsV[patch.countV] - startV),
  );
}

function edgePoint(
  patch: NurbsPatch,
  edge: PatchEdge,
  along: number,
  inward = 0,
): Vec3 {
  const transverse = edge.endsWith("1") ? 1 - inward : inward;
  return edge.startsWith("u")
    ? normalizedPoint(patch, transverse, along)
    : normalizedPoint(patch, along, transverse);
}

function expectPoint(actual: Vec3, expected: Vec3, digits = 10) {
  for (let coordinate = 0; coordinate < 3; coordinate++)
    expect(actual[coordinate]).toBeCloseTo(expected[coordinate], digits);
}

function inwardDerivative(curve: (depth: number) => Vec3): Vec3 {
  const h = 1e-5,
    a = curve(0),
    b = curve(h),
    c = curve(2 * h);
  return a.map(
    (coordinate, axis) => (-3 * coordinate + 4 * b[axis] - c[axis]) / (2 * h),
  ) as Vec3;
}

function freezePatch(patch: NurbsPatch): NurbsPatch {
  patch.points.forEach(Object.freeze);
  Object.freeze(patch.points);
  Object.freeze(patch.weights);
  Object.freeze(patch.knotsU);
  Object.freeze(patch.knotsV);
  return Object.freeze(patch);
}

describe("materialized compatible NURBS boundary blends", () => {
  for (const continuity of ["C0", "C1"] as const) {
    for (const referenceEdge of edges) {
      for (const targetEdge of edges) {
        for (const reverse of [false, true]) {
          it(`${continuity} connects ${referenceEdge} to ${targetEdge}, reverse=${reverse}, with rational seams and normalized derivatives`, () => {
            const reference = freezePatch(rationalPatch(0)),
              target = freezePatch(rationalPatch(35, reverse ? 0.75 : 0.25));
            const originals = JSON.stringify([reference, target]);
            const blend = blendPatchBoundaries(reference, target, {
              referenceEdge,
              targetEdge,
              continuity,
              reverse,
            });
            expect(blend.countU).toBe(continuity === "C0" ? 2 : 4);
            expect(blend.degreeU).toBe(continuity === "C0" ? 1 : 3);
            expect(blend.countV).toBe(4);
            expect(blend.degreeV).toBe(2);
            expect(blend.knotsU).toEqual(
              continuity === "C0" ? [0, 0, 1, 1] : [0, 0, 0, 0, 1, 1, 1, 1],
            );
            expect(blend.knotsV).toEqual([
              0,
              0,
              0,
              reverse ? 0.75 : 0.25,
              1,
              1,
              1,
            ]);
            expect(() => validatePatch(blend)).not.toThrow();
            expect(
              blend.weights.every(
                (weight) => Number.isFinite(weight) && weight > 0,
              ),
            ).toBe(true);
            for (const along of samples) {
              const sourceAlong = reverse ? 1 - along : along;
              expectPoint(
                normalizedPoint(blend, 0, along),
                edgePoint(reference, referenceEdge, sourceAlong),
              );
              expectPoint(
                normalizedPoint(blend, 1, along),
                edgePoint(target, targetEdge, along),
              );
              if (continuity === "C1") {
                const referenceOutward = inwardDerivative((depth) =>
                  edgePoint(reference, referenceEdge, sourceAlong, depth),
                ).map((value) => -value) as Vec3;
                const targetInward = inwardDerivative((depth) =>
                  edgePoint(target, targetEdge, along, depth),
                );
                const blendStart = inwardDerivative((depth) =>
                  normalizedPoint(blend, depth, along),
                );
                const blendEnd = inwardDerivative((depth) =>
                  normalizedPoint(blend, 1 - depth, along),
                ).map((value) => -value) as Vec3;
                expectPoint(blendStart, referenceOutward, 3);
                expectPoint(blendEnd, targetInward, 3);
              }
            }
            expect(JSON.stringify([reference, target])).toBe(originals);
            expect(blend).not.toBe(reference);
            expect(blend).not.toBe(target);
            expect(blend.knotsV).not.toBe(target.knotsV);
            expect(
              blend.points.every(
                (point) =>
                  !reference.points.includes(point) &&
                  !target.points.includes(point),
              ),
            ).toBe(true);
          });
        }
      }
    }
  }

  it("uses exact homogeneous C1 strips including their rational weights", () => {
    const reference = createGridPatch(2, 2, 9, 6, 1),
      target = createGridPatch(2, 2, 8, 6, 1);
    reference.weights = [0.5, 2, 0.75, 3];
    target.weights = [3, 1.5, 4, 2];
    target.points = target.points.map(([x, y, z]) => [x + 20, y, z + 2]);
    const blend = blendPatchBoundaries(reference, target, options);
    for (let v = 0; v < 2; v++) {
      const a = v * 2 + 1,
        ai = v * 2,
        b = v * 2,
        bi = v * 2 + 1;
      const expectedWeights = [
        reference.weights[a],
        (4 * reference.weights[a] - reference.weights[ai]) / 3,
        (4 * target.weights[b] - target.weights[bi]) / 3,
        target.weights[b],
      ];
      for (let u = 0; u < 4; u++)
        expect(blend.weights[v * 4 + u]).toBeCloseTo(expectedWeights[u], 13);
      for (let axis = 0; axis < 3; axis++) {
        expect(
          blend.points[v * 4 + 1][axis] * blend.weights[v * 4 + 1],
        ).toBeCloseTo(
          (4 * reference.points[a][axis] * reference.weights[a] -
            reference.points[ai][axis] * reference.weights[ai]) /
            3,
          12,
        );
        expect(
          blend.points[v * 4 + 2][axis] * blend.weights[v * 4 + 2],
        ).toBeCloseTo(
          (4 * target.points[b][axis] * target.weights[b] -
            target.points[bi][axis] * target.weights[bi]) /
            3,
          12,
        );
      }
    }
  });

  it("matches normalized C1 derivatives when the source and target transverse degrees differ", () => {
    const reference = createGridPatch(4, 4, 18, 23, 3),
      target = createGridPatch(3, 4, 12, 23, 3);
    reference.knotsU = [2, 2, 2, 2, 8, 8, 8, 8];
    target.knotsU = [-7, -7, -7, -2, -2, -2];
    reference.weights = reference.weights.map(
      (_, index) => 1 + (index % 4) * 0.03,
    );
    target.weights = target.weights.map((_, index) => 1 + (index % 3) * 0.04);
    target.points = target.points.map(([x, y, z]) => [x + 30, y, z + 4]);
    const blend = blendPatchBoundaries(reference, target, options);
    for (const along of samples) {
      expectPoint(
        inwardDerivative((depth) => normalizedPoint(blend, depth, along)),
        inwardDerivative((depth) =>
          edgePoint(reference, "u1", along, depth),
        ).map((value) => -value) as Vec3,
        3,
      );
      expectPoint(
        inwardDerivative((depth) =>
          normalizedPoint(blend, 1 - depth, along),
        ).map((value) => -value) as Vec3,
        inwardDerivative((depth) => edgePoint(target, "u0", along, depth)),
        3,
      );
    }
  });

  it("retains supported degree-five seams with sixteen along-boundary controls", () => {
    const reference = createGridPatch(2, 16, 9, 23, 5),
      target = createGridPatch(16, 2, 23, 8, 5);
    target.points = target.points.map(([x, y, z]) => [x + 30, y, z + 4]);
    for (const continuity of ["C0", "C1"] as const) {
      const blend = blendPatchBoundaries(reference, target, {
        ...options,
        targetEdge: "v0",
        continuity,
      });
      expect(blend.countV).toBe(16);
      expect(blend.degreeV).toBe(5);
      expect(() => validatePatch(blend)).not.toThrow();
      for (const along of samples) {
        expectPoint(
          normalizedPoint(blend, 0, along),
          edgePoint(reference, "u1", along),
        );
        expectPoint(
          normalizedPoint(blend, 1, along),
          edgePoint(target, "v0", along),
        );
      }
    }
  });

  it("C0 interpolates homogeneously between distinct rational boundary curves", () => {
    const reference = createGridPatch(2, 2, 9, 6, 1),
      target = createGridPatch(2, 2, 8, 6, 1);
    reference.weights = [1, 2, 1, 4];
    target.weights = [3, 1, 5, 1];
    target.points = target.points.map(([x, y, z]) => [x + 20, y, z + 5]);
    const blend = blendPatchBoundaries(reference, target, {
      ...options,
      continuity: "C0",
    });
    const t = 0.37,
      s = 0.61;
    const expected: Vec3 = [0, 0, 0];
    let denominator = 0;
    for (let row = 0; row < 2; row++) {
      for (let side = 0; side < 2; side++) {
        const patch = side === 0 ? reference : target,
          index = row * 2 + (side === 0 ? 1 : 0),
          weight =
            (row === 0 ? 1 - s : s) *
            (side === 0 ? 1 - t : t) *
            patch.weights[index];
        denominator += weight;
        for (let axis = 0; axis < 3; axis++)
          expected[axis] += weight * patch.points[index][axis];
      }
    }
    expectPoint(
      normalizedPoint(blend, t, s),
      expected.map((value) => value / denominator) as Vec3,
    );
  });

  it("rejects different seam control counts, degrees and normalized knots without refitting", () => {
    const reference = rationalPatch(0),
      target = rationalPatch(30);
    expect(() =>
      blendPatchBoundaries(
        reference,
        createGridPatch(4, 5, 20, 30, 2),
        options,
      ),
    ).toThrow(/compatible/);
    expect(() =>
      blendPatchBoundaries(
        reference,
        createGridPatch(4, 4, 20, 30, 3),
        options,
      ),
    ).toThrow(/compatible/);
    expect(() =>
      blendPatchBoundaries(reference, rationalPatch(30, 0.4), options),
    ).toThrow(/compatible/);
    expect(() =>
      blendPatchBoundaries(reference, target, { ...options, reverse: true }),
    ).toThrow(/compatible/);
  });

  for (const side of ["reference", "target"] as const) {
    for (const innerWeight of [4, 5]) {
      it(`rejects nonpositive generated C1 weights from ${side}, inner=${innerWeight}`, () => {
        const reference = createGridPatch(2, 2, 9, 6, 1),
          target = createGridPatch(2, 2, 8, 6, 1);
        const patch = side === "reference" ? reference : target;
        patch.weights[side === "reference" ? 0 : 1] = innerWeight;
        expect(() => blendPatchBoundaries(reference, target, options)).toThrow(
          /weight/i,
        );
        expect(() =>
          blendPatchBoundaries(reference, target, {
            ...options,
            continuity: "C0",
          }),
        ).not.toThrow();
      });
    }
    it(`rejects overflowing generated C1 weights from ${side}`, () => {
      const reference = createGridPatch(3, 2, 9, 6, 2),
        target = createGridPatch(3, 2, 8, 6, 2);
      (side === "reference" ? reference : target).weights[1] = Number.MAX_VALUE;
      expect(() => blendPatchBoundaries(reference, target, options)).toThrow(
        /weight/i,
      );
    });
  }

  it("rejects generated nonfinite control coordinates even when all input coordinates are finite", () => {
    const reference = createGridPatch(2, 2, 9, 6, 1),
      target = createGridPatch(2, 2, 8, 6, 1);
    reference.points[1][0] = -Number.MAX_VALUE;
    reference.points[0][0] = Number.MAX_VALUE;
    const originals = JSON.stringify([reference, target]);
    expect(() => blendPatchBoundaries(reference, target, options)).toThrow(
      /finite|overflow|coordinate/i,
    );
    expect(JSON.stringify([reference, target])).toBe(originals);
  });

  it("validates both inputs, boundary names, transverse clamping and supported continuity", () => {
    const reference = rationalPatch(0),
      target = rationalPatch(30);
    for (const weight of [0, -1, NaN, Infinity]) {
      const invalid = { ...target, weights: [...target.weights] };
      invalid.weights[0] = weight;
      expect(() => blendPatchBoundaries(invalid, target, options)).toThrow(
        /weight|positive|finite/i,
      );
      expect(() => blendPatchBoundaries(reference, invalid, options)).toThrow(
        /weight|positive|finite/i,
      );
    }
    const unclamped = { ...target, knotsU: [0, 0, 0.1, 0.5, 1, 1, 1] };
    expect(() => blendPatchBoundaries(reference, unclamped, options)).toThrow(
      /clamped/,
    );
    expect(() =>
      blendPatchBoundaries(reference, target, {
        ...options,
        referenceEdge: "bad" as PatchEdge,
      }),
    ).toThrow(/boundary/);
    expect(() =>
      blendPatchBoundaries(reference, target, {
        ...options,
        targetEdge: "bad" as PatchEdge,
      }),
    ).toThrow(/boundary/);
    expect(() =>
      blendPatchBoundaries(reference, target, {
        ...options,
        continuity: "G2" as "C1",
      }),
    ).toThrow(/C0|C1/);
  });
});

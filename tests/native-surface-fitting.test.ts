import { describe, expect, it } from "vitest";
import fixture from "./fixtures/native-surface-core.json";
import {
  nativeBasis,
  nativeDerivative,
  nativeFactor,
  nativeIntegral,
  nativeMatrices,
  nativeSolve,
  nativeSurfaceWorkingSet,
  NATIVE_SURFACE_MAX_BYTES,
  NATIVE_SURFACE_MAX_SCALAR_WORK,
} from "../src/native-surface-fitting";

function bits(value: number): string {
  const bytes = new ArrayBuffer(8);
  new DataView(bytes).setFloat64(0, value, true);
  return Array.from(new Uint8Array(bytes), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
function exact(actual: readonly number[], expected: readonly number[]): void {
  expect(actual.length).toBe(expected.length);
  expect(actual.map(bits)).toEqual(expected.map(bits));
}
const knots = [0, 0, 0, 0, 1, 1, 1, 1];

describe("captured native approximation arithmetic", () => {
  it("retains the original capture and its explicit allocator/workflow boundary", () => {
    expect(fixture.provenance.imageSha256).toBe(
      "e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1",
    );
    expect(fixture.provenance.nativeApplicationWorkflow).toBe(false);
    expect(fixture.provenance.allocatorBoundary).toMatch(
      /identity\/OOM parity unclaimed/,
    );
    expect(fixture.allocationCount).toBe(fixture.freeCount);
    expect(fixture.canariesVerified).toBe(true);
  });
  it("matches scalar basis and derivative bits, including exact endpoints", () => {
    for (const c of fixture.basisCases) {
      exact(
        [0, 1, 2, 3].map((i) => nativeBasis(knots, 4, i, c.parameter)),
        c.basis,
      );
      for (let d = 1; d <= 3; d++)
        exact(
          [0, 1, 2, 3].map((i) =>
            nativeDerivative(knots, 4, i, d, c.parameter),
          ),
          c.derivatives[d - 1],
        );
    }
  });
  it("matches interior knots and native degrees one through five at five and ten controls", () => {
    for (const c of fixture.expandedCapture.expandedBasisCases) {
      exact(
        Array.from({ length: c.count }, (_, i) =>
          nativeBasis(c.knots, c.order, i, c.parameter),
        ),
        c.basis,
      );
      for (let derivative = 1; derivative <= 5; derivative++)
        exact(
          Array.from({ length: c.count }, (_, i) =>
            nativeDerivative(c.knots, c.order, i, derivative, c.parameter),
          ),
          c.derivatives[derivative - 1],
        );
    }
  });
  it("matches normalization, signed zero and rejection without mutating inputs", () => {
    for (const c of fixture.cases) {
      const a = c.matrix.slice(),
        b = c.rhs.slice();
      const result = nativeSolve(a, b);
      expect(result.accepted).toBe(c.accepted);
      exact(a, c.matrix);
      exact(b, c.rhs);
      if (result.accepted) exact(result.output, c.output);
    }
  });
  it("matches LU ties, permutations and strict threshold equality", () => {
    for (const c of fixture.factorCases) {
      const threshold = 2 ** -23;
      const below = new ArrayBuffer(8),
        view = new DataView(below);
      view.setFloat64(0, threshold, true);
      view.setBigUint64(0, view.getBigUint64(0, true) - 1n, true);
      const values =
        c.name === "tie"
          ? [1, 1, -1, 1]
          : [
              1,
              0,
              0,
              c.name === "threshold-equal"
                ? threshold
                : view.getFloat64(0, true),
            ];
      const result = nativeFactor(values, 2, c.tolerance);
      expect(result.accepted).toBe(c.accepted);
      expect(result.sign).toBe(c.sign);
      expect(result.pivots).toEqual(c.pivots);
      exact(result.lu, c.lu);
    }
  });
  it("matches every captured tensor, penalty, system, RHS and control bit", () => {
    for (const c of [
      ...fixture.fittingCases,
      ...fixture.expandedCapture.fittingCases,
    ]) {
      const result = nativeMatrices(
        c.points,
        c.uv,
        4,
        4,
        4,
        4,
        knots,
        knots,
        undefined,
        c.lambdaValue,
      );
      for (let i = 0; i < result.columns.length; i++)
        exact(result.columns[i], c.columns[i]);
      for (const field of ["gram", "penalty1", "penalty2", "system"] as const)
        exact(result[field], c[field]);
      for (let axis = 0; axis < 3; axis++) {
        exact(result.rhs[axis], c.rhs[axis]);
        const coordinate = result.coordinates[axis];
        expect(coordinate.accepted).toBe(c.coordinates[axis].accepted);
        if (coordinate.accepted)
          exact(coordinate.output, c.coordinates[axis].output);
      }
    }
  });
  it("admits the default 10 by 10, 10000-sample workspace without allocating it", () => {
    const admitted = nativeSurfaceWorkingSet(10, 10, 10000);
    expect(admitted.bytes).toBeLessThan(NATIVE_SURFACE_MAX_BYTES);
    expect(admitted.scalarWork).toBeLessThan(NATIVE_SURFACE_MAX_SCALAR_WORK);
    expect(() => nativeSurfaceWorkingSet(16, 16, 10000)).toThrow(
      /bounded workspace|scalar-work/,
    );
  });
  it("rejects malformed, nonfinite and excessive inputs before numeric work", () => {
    expect(() => nativeSolve([1, 2, 3], [1, 2])).toThrow(/square/);
    expect(() => nativeSolve([1, 0, 0, NaN], [1, 2])).toThrow(/nonfinite/);
    expect(() => nativeSolve([1, 0, 0, 1], [1, Infinity])).toThrow(/nonfinite/);
    expect(() => nativeFactor([1], 1, 0)).toThrow(/positive/);
    expect(() => nativeBasis([0, 0, 1, 0], 2, 0, 0.5)).toThrow(/nondecreasing/);
    expect(() => nativeDerivative(knots, 4, 0, -1, 0.5)).toThrow(
      /derivative order/,
    );
    expect(() => nativeIntegral(knots, 4, 0, 0, 0, 0, [])).toThrow(/seven/);
    expect(() => nativeMatrices([], [], 4, 4, 4, 4, knots, knots)).toThrow(
      /sample count/,
    );
    const points = Array.from({ length: 16 }, () => [0, 0, 0]);
    const uv = Array.from({ length: 16 }, () => [0.5, 0.5]);
    expect(() =>
      nativeMatrices(points, uv, 4, 4, 4, 4, knots, knots, undefined, -1),
    ).toThrow(/nonnegative/);
    uv[0][0] = 2;
    expect(() => nativeMatrices(points, uv, 4, 4, 4, 4, knots, knots)).toThrow(
      /\[0,1\]/,
    );
  });
});

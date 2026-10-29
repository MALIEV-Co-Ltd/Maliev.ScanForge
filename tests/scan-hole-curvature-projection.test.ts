import { expect, it } from "vitest";
import { nativeCurvatureWeights } from "../src/scan-hole-curvature-projection";

it("recovers native origin-based triangle weights on an offset plane", () => {
  const weights = nativeCurvatureWeights(
    [0, 0, 2],
    [3, 0, 2],
    [0, 4, 2],
    [0.6, 1.2, 2],
  )!;
  for (const [i, value] of [0.5, 0.2, 0.3].entries())
    expect(Math.abs(weights[i] - value)).toBeLessThan(1e-15);
});

it("keeps the native homogeneous solve instead of renormalizing off-plane weights", () => {
  const weights = nativeCurvatureWeights(
    [0, 0, 2],
    [3, 0, 2],
    [0, 4, 2],
    [0.6, 1.2, 4],
  )!;
  for (const [i, value] of [1.5, 0.2, 0.3].entries())
    expect(Math.abs(weights[i] - value)).toBeLessThan(1e-15);
  expect(weights.reduce((sum, value) => sum + value, 0)).toBe(2);
});

it("preserves the native singular-plane and inclusive determinant threshold", () => {
  expect(
    nativeCurvatureWeights([0, 0, 0], [3, 0, 0], [0, 4, 0], [0.6, 1.2, 0]),
  ).toBeUndefined();
  expect(
    nativeCurvatureWeights(
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, Number.EPSILON],
      [0.2, 0.3, Number.EPSILON * 0.5],
    ),
  ).toEqual([0.2, 0.3, 0.5]);
  expect(
    nativeCurvatureWeights(
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, Number.EPSILON / 2],
      [0.2, 0.3, 0],
    ),
  ).toBeUndefined();
});

it("rejects malformed triangle and projection coordinates", () => {
  expect(() =>
    nativeCurvatureWeights([0, 0, 2], [3, 0, 2], [0, 4, 2], [NaN, 0, 2]),
  ).toThrow(/finite/);
  expect(() =>
    nativeCurvatureWeights([0, 0], [3, 0, 2], [0, 4, 2], [0, 0, 2]),
  ).toThrow(/XYZ/);
});

import { expect, it } from "vitest";
import { simplifyBoundaryCurve } from "../src/scan-boundary-simplify";

it("removes collinear 3D points while preserving open endpoints and source data", () => {
  const input = [0, 0, 0, 1, 2, 3, 2, 4, 6, 3, 6, 9];
  expect(simplifyBoundaryCurve(input, 0.1)).toEqual([0, 0, 0, 3, 6, 9]);
  expect(input).toHaveLength(12);
});
it("bounds deviation from every original point to its simplified 3D segment", () => {
  const input = Array.from({ length: 81 }, (_, i) => [
    i / 10,
    Math.sin(i / 10) * 0.3,
    Math.cos(i / 10) * 0.2,
  ]).flat();
  const result = simplifyBoundaryCurve(input, 0.05);
  const distance = (p: number[], a: number[], b: number[]) => {
    const d = b.map((x, i) => x - a[i]);
    const t = Math.max(
      0,
      Math.min(
        1,
        p.reduce((sum, x, i) => sum + (x - a[i]) * d[i], 0) /
          d.reduce((sum, x) => sum + x * x, 0),
      ),
    );
    return Math.hypot(...p.map((x, i) => x - a[i] - t * d[i]));
  };
  for (let i = 0; i < input.length; i += 3) {
    const deviations = [];
    for (let j = 0; j < result.length - 3; j += 3)
      deviations.push(
        distance(
          input.slice(i, i + 3),
          result.slice(j, j + 3),
          result.slice(j + 3, j + 6),
        ),
      );
    expect(Math.min(...deviations)).toBeLessThanOrEqual(0.05 + 1e-12);
  }
  expect(result.length).toBeLessThan(input.length);
});
it("preserves closed rectangle corners and the explicit closing point", () => {
  const input = [
    0, 0, 2, 1, 0, 2, 2, 0, 2, 2, 1, 2, 2, 2, 2, 1, 2, 2, 0, 2, 2, 0, 1, 2, 0,
    0, 2,
  ];
  expect(simplifyBoundaryCurve(input, 0.1)).toEqual([
    0, 0, 2, 2, 0, 2, 2, 2, 2, 0, 2, 2, 0, 0, 2,
  ]);
  const large = simplifyBoundaryCurve(input, 100);
  expect(large).toHaveLength(12);
  expect(large.slice(-3)).toEqual(large.slice(0, 3));
});
it.each([0, -1, NaN, Infinity])("rejects invalid tolerance %s", (tolerance) => {
  expect(() => simplifyBoundaryCurve([0, 0, 0, 1, 1, 1], tolerance)).toThrow(
    /tolerance/,
  );
});
it("rejects malformed curves", () => {
  expect(() => simplifyBoundaryCurve([0, 0, 0, 1], 0.1)).toThrow(/XYZ/);
  expect(() => simplifyBoundaryCurve([0, 0, 0, NaN, 1, 1], 0.1)).toThrow(/XYZ/);
});

import { describe, expect, it } from "vitest";
import { decomposeCurvatureTensor } from "../src/field-curvature-eigen";
import native from "./fixtures/field-native-eigen.json";

describe("recovered curvature eigensolver", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches isolated native case $id at $iterations sweeps, sort=$sort",
    ({ tensor, pairs, iterations, tolerance, sort }) => {
      const original = tensor.slice();
      const actual = decomposeCurvatureTensor(tensor, {
        iterations,
        tolerance,
        sort,
      });
      // Include signs, ordering and partially iterated outputs, not only eigenvalues.
      expect(Array.from(actual)).toEqual(pairs);
      expect(tensor).toEqual(original);
    },
  );
  it("produces orthonormal eigenvectors satisfying the supplied dense tensor", () => {
    const tensor = [4, 1, 2, 3, -1, 7];
    const pairs = decomposeCurvatureTensor(tensor);
    const a = [
      [4, 1, 2],
      [1, 3, -1],
      [2, -1, 7],
    ];
    for (let p = 0; p < 3; p++) {
      const v = pairs.slice(p * 4, p * 4 + 3);
      const value = pairs[p * 4 + 3];
      for (let row = 0; row < 3; row++)
        expect(
          Math.abs(
            a[row].reduce((sum, x, col) => sum + x * v[col], 0) -
              value * v[row],
          ),
        ).toBeLessThan(1e-12);
      for (let q = 0; q < 3; q++) {
        const dot = v.reduce((sum, x, j) => sum + x * pairs[q * 4 + j], 0);
        expect(dot).toBeCloseTo(p === q ? 1 : 0, 13);
      }
    }
  });
  it("retains input-axis order when absolute eigenvalues tie", () => {
    expect(Array.from(decomposeCurvatureTensor([-2, 0, 0, 2, 0, -2]))).toEqual([
      1, 0, 0, -2, 0, 1, 0, 2, 0, 0, 1, -2,
    ]);
  });
  it("uses a strict absolute convergence tolerance", () => {
    const tensor = [2, 1, 0, 2, 0, 5];
    expect(decomposeCurvatureTensor(tensor, { tolerance: 1.01 })[3]).toBe(2);
    expect(decomposeCurvatureTensor(tensor, { tolerance: 1 })[3]).toBe(1);
  });
  it("owns output and rejects malformed or unsafe browser inputs", () => {
    const tensor = new Float64Array([4, 1, 2, 3, -1, 7]);
    const first = decomposeCurvatureTensor(tensor);
    first.fill(0);
    expect(decomposeCurvatureTensor(tensor)[3]).not.toBe(0);
    for (const input of [[], [1, 2], [1, 2, 3, 4, 5, NaN]])
      expect(() => decomposeCurvatureTensor(input)).toThrow();
    for (const iterations of [-1, 0.5, Infinity, 10001])
      expect(() => decomposeCurvatureTensor(tensor, { iterations })).toThrow();
    for (const tolerance of [-1, NaN, Infinity])
      expect(() => decomposeCurvatureTensor(tensor, { tolerance })).toThrow();
  });
});

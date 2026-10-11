import { describe, expect, it } from "vitest";
import {
  solveFieldLinearSystem,
  type FieldLinearSystem,
  type FieldSolveOptions,
} from "../src/field-linear-solver";

function matrix(rows: number[][], rhs: number[]): FieldLinearSystem {
  const indices: number[] = [],
    coefficients: number[] = [],
    offsets = [0];
  for (const row of rows) {
    row.forEach((value, index) => {
      if (value !== 0) {
        indices.push(index);
        coefficients.push(value);
      }
    });
    offsets.push(indices.length);
  }
  return {
    offsets: new Uint32Array(offsets),
    indices: new Uint32Array(indices),
    coefficients: new Float64Array(coefficients),
    rightHandSide: new Float64Array(rhs),
  };
}
const options: FieldSolveOptions = {
  seedIndices: new Uint32Array([0, 1]),
  relativeTolerance: 1e-9,
  maxIterations: -1,
  diagonalScaling: false,
};

describe("recovered field-system recurrence", () => {
  it("satisfies every equation of a larger coupled manufactured system", () => {
    const size = 64;
    const expected = Array.from(
      { length: size },
      (_, i) => Math.sin(i) + i / 8,
    );
    const rows = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) =>
        i === j ? 3 + i / 16 : Math.abs(i - j) === 1 ? -1 : 0,
      ),
    );
    const rhs = rows.map((row) =>
      row.reduce((sum, value, j) => sum + value * expected[j], 0),
    );
    for (const diagonalScaling of [false, true]) {
      const output = solveFieldLinearSystem(
        matrix(rows, rhs),
        new Float64Array(size).fill(0.5),
        {
          ...options,
          diagonalScaling,
          seedIndices: Uint32Array.from({ length: size }, (_, i) => i),
        },
      );
      expect(output.status).toBe("converged");
      expect(output.iterations).toBeLessThan(64);
      for (let i = 0; i < size; i++) {
        expect(output.solution[i]).toBeCloseTo(expected[i], 7);
        const actual = rows[i].reduce(
          (sum, value, j) => sum + value * output.solution[j],
          0,
        );
        expect(actual).toBeCloseTo(rhs[i], 7);
      }
    }
  });
  it("solves a known coupled symmetric system without changing its inputs", () => {
    const system = matrix(
      [
        [4, 1],
        [1, 3],
      ],
      [1, 2],
    );
    const initial = new Float64Array(2);
    const before = system.coefficients.slice();
    const output = solveFieldLinearSystem(system, initial, options);
    expect(output.status).toBe("converged");
    expect(output.iterations).toBe(2);
    expect(output.solution[0]).toBeCloseTo(1 / 11, 12);
    expect(output.solution[1]).toBeCloseTo(7 / 11, 12);
    expect(output.finalStatistic).toBeLessThan(1e-20);
    expect(initial).toEqual(new Float64Array(2));
    expect(system.coefficients).toEqual(before);
  });
  it("propagates support from one residual seed into adjacent variables", () => {
    const output = solveFieldLinearSystem(
      matrix(
        [
          [4, 1],
          [1, 3],
        ],
        [1, 0],
      ),
      new Float64Array(2),
      { ...options, seedIndices: new Uint32Array([0]) },
    );
    expect(output.status).toBe("converged");
    expect(output.activeCount).toBe(2);
    expect(output.solution[0]).toBeCloseTo(3 / 11, 12);
    expect(output.solution[1]).toBeCloseTo(-1 / 11, 12);
  });
  it("uses inverse-diagonal scaling and a nonzero initial solution", () => {
    const output = solveFieldLinearSystem(
      matrix(
        [
          [4, 0],
          [0, 9],
        ],
        [8, 27],
      ),
      new Float64Array([1, 1]),
      { ...options, diagonalScaling: true },
    );
    expect(output.status).toBe("converged");
    expect(output.iterations).toBe(1);
    expect(Array.from(output.solution)).toEqual([2, 3]);
  });
  it("retains the native small-initial-statistic and last-iteration policies", () => {
    const small = solveFieldLinearSystem(
      matrix([[1]], [0.001]),
      new Float64Array(1),
      { ...options, seedIndices: new Uint32Array([0]) },
    );
    expect(small.status).toBe("converged");
    expect(small.iterations).toBe(0);
    expect(small.solution[0]).toBe(0);
    const last = solveFieldLinearSystem(
      matrix([[1]], [1]),
      new Float64Array(1),
      { ...options, seedIndices: new Uint32Array([0]), maxIterations: 1 },
    );
    expect(last.status).toBe("iteration-limit");
    expect(last.solution[0]).toBe(1);
    expect(last.finalStatistic).toBe(0);
  });
  it("reports a zero denominator and honors zero iteration allowance", () => {
    const system = matrix([[0]], [1]);
    const limits = { ...options, seedIndices: new Uint32Array([0]) };
    expect(
      solveFieldLinearSystem(system, new Float64Array(1), limits).status,
    ).toBe("breakdown");
    const none = solveFieldLinearSystem(system, new Float64Array([2]), {
      ...limits,
      maxIterations: 0,
    });
    expect(none.status).toBe("iteration-limit");
    expect(none.solution[0]).toBe(2);
  });
  it("rejects invalid inputs and cancellation before numerical execution", () => {
    const system = matrix(
      [
        [4, 1],
        [1, 3],
      ],
      [1, 2],
    );
    const initial = new Float64Array(2);
    expect(() =>
      solveFieldLinearSystem(
        { ...system, offsets: new Uint32Array([0, 5, 4]) },
        initial,
        options,
      ),
    ).toThrow("ordered");
    expect(() =>
      solveFieldLinearSystem(system, initial, {
        ...options,
        seedIndices: new Uint32Array([0, 0]),
      }),
    ).toThrow("unique");
    expect(() =>
      solveFieldLinearSystem(system, initial, {
        ...options,
        maxIterations: -2,
      }),
    ).toThrow("limits");
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      solveFieldLinearSystem(system, initial, {
        ...options,
        signal: controller.signal,
      }),
    ).toThrow("cancelled");
  });
});

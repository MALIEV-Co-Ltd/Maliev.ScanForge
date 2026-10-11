import { describe, expect, it } from "vitest";
import { selectFieldIntegerBatch } from "../src/field-integer-selection";
import { fixFieldVariables } from "../src/field-variable-fixing";
import { assembleFieldSystem } from "../src/field-system-assembly";
import {
  solveFieldLinearSystem,
  type FieldLinearSystem,
} from "../src/field-linear-solver";

function input(
  values: number[],
  variables = values.map((_, i) => i),
  marked = variables.map(() => 0),
  scales?: number[],
) {
  return {
    solution: Float64Array.from(values),
    variables: Uint32Array.from(variables),
    marked: Uint8Array.from(marked),
    scales: scales && Float64Array.from(scales),
  };
}
function solve(system: FieldLinearSystem) {
  return solveFieldLinearSystem(
    system,
    new Float64Array(system.rightHandSide.length),
    {
      seedIndices: Uint32Array.from(system.rightHandSide, (_, i) => i),
      relativeTolerance: 1e-10,
      maxIterations: 100,
      diagonalScaling: true,
    },
  );
}

describe("recovered integer batch selection", () => {
  it("uses nearest residual order, mapped variables and first-ordinal ties with immutable inputs", () => {
    const source = input([0.25, -0.25, 1.1, 2.1], [3, 1, 0, 2]);
    const before = structuredClone(source);
    const batch = selectFieldIntegerBatch(source, 0.5, 1);
    // 2.1 and 1.1 have the same represented fractional residual.
    expect(batch.choices).toEqual([
      { ordinal: 0, variable: 3, value: 2 },
      { ordinal: 3, variable: 2, value: 1 },
      { ordinal: 1, variable: 1, value: 0 },
    ]);
    expect(Array.from(batch.marked)).toEqual([1, 1, 0, 1]);
    expect(batch.threshold).toBe(0.25);
    expect(batch.budgetUsed).toBeCloseTo(0.7, 12);
    expect(source).toEqual(before);
  });
  it("rounds signed half values away from zero and guarantees the first choice even over budget", () => {
    expect(selectFieldIntegerBatch(input([-1.5, 1.5]), 0, 1).choices).toEqual([
      { ordinal: 0, variable: 0, value: -2 },
    ]);
    expect(selectFieldIntegerBatch(input([1.5]), 0.5, 1).choices[0].value).toBe(
      2,
    );
  });
  it("scales residuals before selection and multiplies rounded targets back by each candidate scale", () => {
    const batch = selectFieldIntegerBatch(
      input([5.1, -7.8, 9], [1, 0, 2], [0, 0, 1], [4, 2, -3]),
      1,
      1,
    );
    expect(batch.choices.map((c) => [c.variable, c.value])).toEqual([
      [1, -8],
      [0, 6],
    ]);
    expect(batch.budgetUsed).toBeCloseTo(0.5, 12);
    expect(Array.from(batch.marked)).toEqual([1, 1, 1]);
  });
  it("runs progressively wider threshold prepasses in ordinal order before greedy selection", () => {
    const batch = selectFieldIntegerBatch(
      input([0.02, 0.001, 0.000005, 0.4]),
      1,
      0,
    );
    expect(batch.choices.map((c) => c.ordinal)).toEqual([2, 1, 0, 3]);
    expect(batch.threshold).toBe(0.05);
    expect(batch.budgetUsed).toBeCloseTo(0.421005, 12);
    const boundary = selectFieldIntegerBatch(input([0.00001, 0.000005]), 1, 0);
    expect(boundary.choices.map((c) => c.ordinal)).toEqual([1, 0]);
  });
  it("counts a rejected threshold candidate before the greedy fallback", () => {
    // All residuals enter the fifth threshold pass (< 0.05); the 21st exceeds 1.
    const batch = selectFieldIntegerBatch(input(Array(23).fill(0.049)), 1, 0);
    expect(batch.choices).toHaveLength(20);
    expect(batch.budgetUsed).toBeCloseTo(22 * 0.049, 12);
    expect(batch.threshold).toBe(0.049);
    expect(batch.marked[20]).toBe(0);
  });
  it("handles exhausted candidates, empty scales and equality at the budget boundary", () => {
    expect(
      selectFieldIntegerBatch(input([1.2], [0], [1]), 1, 0).choices,
    ).toEqual([]);
    expect(
      selectFieldIntegerBatch(input([], [], [], []), 0, 0).choices,
    ).toEqual([]);
    expect(
      selectFieldIntegerBatch(
        input([0.25, 0.25], undefined, undefined, []),
        0.5,
        1,
      ).choices,
    ).toHaveLength(2);
  });
  it("connects continuous solving, integer selection, fixing and re-solving on recovered equations", () => {
    const assembled = assembleFieldSystem(
      3,
      [
        { left: 0, right: 1, transportAngle: 0.2, quarterTurns: 0 },
        { left: 1, right: 2, transportAngle: -0.1, quarterTurns: 0 },
      ],
      2,
      [],
      [{ node: 0, angle: 1.2, strength: 4 }],
    );
    const continuous = solve(assembled.system);
    expect(continuous.status).toBe("converged");
    const batch = selectFieldIntegerBatch(
      {
        solution: continuous.solution,
        variables: Uint32Array.from([2, 0, 1]),
        marked: new Uint8Array(3),
      },
      0,
      1,
    );
    expect(batch.choices).toHaveLength(1);
    const fixed = fixFieldVariables(assembled.system, batch.choices);
    const result = solve(fixed);
    expect(result.status).toBe("converged");
    expect(result.solution[batch.choices[0].variable]).toBeCloseTo(
      batch.choices[0].value,
      10,
    );
    for (let row = 0; row < 3; row++) {
      let product = 0;
      for (let k = fixed.offsets[row]; k < fixed.offsets[row + 1]; k++)
        product += fixed.coefficients[k] * result.solution[fixed.indices[k]];
      expect(product).toBeCloseTo(fixed.rightHandSide[row], 10);
    }
  });
  it("rejects invalid choices, scales, flags, limits and unsupported integer conversion", () => {
    for (const source of [
      input([NaN]),
      input([Infinity]),
      input([2147483648]),
      input([1], [2]),
      input([1], [0, 0]),
      input([1], [0], [2]),
      input([1], [0], [0], [0]),
      input([1], [0], [0], [NaN]),
      input([1], [0], [0], [1, 2]),
    ])
      expect(() => selectFieldIntegerBatch(source, 1, 0)).toThrow();
    for (const [budget, threshold] of [
      [-1, 0],
      [Infinity, 0],
      [1, NaN],
      [1, -1],
    ])
      expect(() =>
        selectFieldIntegerBatch(input([1]), budget, threshold),
      ).toThrow();
  });
});

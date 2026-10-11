import { describe, expect, it } from "vitest";
import { fixFieldVariables } from "../src/field-variable-fixing";
import { assembleFieldSystem } from "../src/field-system-assembly";
import {
  solveFieldLinearSystem,
  type FieldLinearSystem,
} from "../src/field-linear-solver";

function fixture(): FieldLinearSystem {
  return {
    offsets: new Uint32Array([0, 2, 5, 7]),
    indices: new Uint32Array([0, 1, 0, 1, 2, 1, 2]),
    coefficients: new Float64Array([4, -1, -1, 4, -1, -1, 3]),
    rightHandSide: new Float64Array([1, 2, 3]),
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

describe("recovered field-variable fixing", () => {
  it("replaces the chosen row and paired column without changing sparse structure or inputs", () => {
    const system = fixture();
    const before = structuredClone(system);
    const fixed = fixFieldVariables(system, [{ variable: 1, value: 5 }]);
    expect(fixed.offsets).toEqual(system.offsets);
    expect(fixed.indices).toEqual(system.indices);
    expect(Array.from(fixed.coefficients)).toEqual([4, 0, 0, 1, 0, 0, 3]);
    expect(Array.from(fixed.rightHandSide)).toEqual([6, 5, 8]);
    expect(system).toEqual(before);
    expect(fixed.offsets).not.toBe(system.offsets);
    expect(fixed.indices).not.toBe(system.indices);
    const result = solve(fixed);
    expect(result.status).toBe("converged");
    expect(result.solution[0]).toBeCloseTo(1.5, 12);
    expect(result.solution[1]).toBeCloseTo(5, 12);
    expect(result.solution[2]).toBeCloseTo(8 / 3, 12);
  });
  it("fixes adjacent variables sequentially and gives the same equations in either order", () => {
    const choices = [
      { variable: 0, value: -2 },
      { variable: 1, value: 5 },
    ];
    const output = fixFieldVariables(fixture(), choices);
    expect(output).toEqual(
      fixFieldVariables(fixture(), [...choices].reverse()),
    );
    expect(Array.from(output.coefficients)).toEqual([1, 0, 0, 1, 0, 0, 3]);
    expect(Array.from(output.rightHandSide)).toEqual([-2, 5, 8]);
    expect(Array.from(solve(output).solution)).toEqual([-2, 5, 8 / 3]);
  });
  it("matches fixed-node assembly on the free equations of an oriented connection graph", () => {
    const connections = [
      { left: 0, right: 1, transportAngle: 0.2, quarterTurns: 1 },
      { left: 1, right: 2, transportAngle: -0.1, quarterTurns: -1 },
      { left: 2, right: 3, transportAngle: 0.3, quarterTurns: 0 },
    ];
    const all = assembleFieldSystem(4, connections, 2, [], []);
    const fixed = fixFieldVariables(all.system, [
      { variable: 0, value: 1 },
      { variable: 3, value: -2 },
    ]);
    const reduced = assembleFieldSystem(
      4,
      connections,
      2,
      [
        { node: 0, angle: 1 },
        { node: 3, angle: -2 },
      ],
      [],
    );
    const fullSolution = solve(fixed),
      reducedSolution = solve(reduced.system);
    expect(fullSolution.status).toBe("converged");
    expect(reducedSolution.status).toBe("converged");
    for (let row = 0; row < 4; row++) {
      let product = 0;
      for (let k = fixed.offsets[row]; k < fixed.offsets[row + 1]; k++)
        product +=
          fixed.coefficients[k] * fullSolution.solution[fixed.indices[k]];
      expect(product).toBeCloseTo(fixed.rightHandSide[row], 10);
    }
    for (let i = 0; i < reduced.variableNodes.length; i++)
      expect(fullSolution.solution[reduced.variableNodes[i]]).toBeCloseTo(
        reducedSolution.solution[i],
        10,
      );
  });
  it("keeps explicit zero neighbors and supports empty systems and empty choices", () => {
    const system = fixture();
    system.coefficients[1] = system.coefficients[2] = 0;
    const fixed = fixFieldVariables(system, [{ variable: 0, value: 0 }]);
    expect(Array.from(fixed.rightHandSide)).toEqual([0, 2, 3]);
    expect(fixed.indices).toEqual(system.indices);
    expect(fixFieldVariables(system, [])).toEqual(system);
    const empty = {
      offsets: new Uint32Array([0]),
      indices: new Uint32Array(),
      coefficients: new Float64Array(),
      rightHandSide: new Float64Array(),
    };
    expect(fixFieldVariables(empty, [])).toEqual(empty);
  });
  it("rejects malformed structure, asymmetric coefficients, missing diagonals and invalid choices", () => {
    for (const choices of [
      [{ variable: -1, value: 0 }],
      [{ variable: 3, value: 0 }],
      [{ variable: 0.5, value: 0 }],
      [{ variable: 0, value: Infinity }],
      [
        { variable: 0, value: 1 },
        { variable: 0, value: 2 },
      ],
    ])
      expect(() => fixFieldVariables(fixture(), choices)).toThrow();
    const malformed = fixture();
    malformed.offsets[1] = 8;
    expect(() => fixFieldVariables(malformed, [])).toThrow();
    const asymmetric = fixture();
    asymmetric.coefficients[1] = -2;
    expect(() => fixFieldVariables(asymmetric, [])).toThrow(/symmetric/);
    const missing = fixture();
    missing.offsets = new Uint32Array([0, 1, 4, 6]);
    missing.indices = new Uint32Array([1, 0, 1, 2, 1, 2]);
    missing.coefficients = new Float64Array([-1, -1, 4, -1, -1, 3]);
    expect(() => fixFieldVariables(missing, [])).toThrow(/diagonal/);
    const unpaired = fixture();
    unpaired.offsets = new Uint32Array([0, 2, 4, 6]);
    unpaired.indices = new Uint32Array([0, 1, 1, 2, 1, 2]);
    unpaired.coefficients = new Float64Array([4, -1, 4, -1, -1, 3]);
    expect(() => fixFieldVariables(unpaired, [])).toThrow(/symmetric/);
    const nonfinite = fixture();
    nonfinite.rightHandSide[0] = NaN;
    expect(() => fixFieldVariables(nonfinite, [])).toThrow();
  });
  it("rejects overflow while preserving the original system", () => {
    const system = fixture();
    system.coefficients[1] = system.coefficients[2] = -2;
    const before = structuredClone(system);
    expect(() =>
      fixFieldVariables(system, [{ variable: 1, value: Number.MAX_VALUE }]),
    ).toThrow(/overflow/);
    expect(system).toEqual(before);
  });
});

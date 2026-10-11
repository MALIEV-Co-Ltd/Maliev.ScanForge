import { describe, expect, it } from "vitest";
import {
  assembleFieldSystem,
  type FieldConnection,
} from "../src/field-system-assembly";
import { solveFieldLinearSystem } from "../src/field-linear-solver";

function solve(output: ReturnType<typeof assembleFieldSystem>) {
  return solveFieldLinearSystem(
    output.system,
    new Float64Array(output.variableNodes.length),
    {
      seedIndices: Uint32Array.from(output.variableNodes, (_, i) => i),
      relativeTolerance: 1e-10,
      maxIterations: 100,
      diagonalScaling: true,
    },
  );
}

describe("recovered connection-system assembly", () => {
  it("eliminates fixed values and solves an oriented connection chain", () => {
    const edges: FieldConnection[] = [
      { left: 0, right: 1, transportAngle: 0.2, quarterTurns: 0 },
      { left: 1, right: 2, transportAngle: -0.1, quarterTurns: 0 },
    ];
    const output = assembleFieldSystem(
      3,
      edges,
      2,
      [{ node: 0, angle: 1 }],
      [],
    );
    expect(Array.from(output.variableNodes)).toEqual([1, 2]);
    expect(Array.from(output.system.offsets)).toEqual([0, 2, 4]);
    expect(Array.from(output.system.indices)).toEqual([0, 1, 0, 1]);
    expect(Array.from(output.system.coefficients)).toEqual([4, -2, -2, 2]);
    const result = solve(output);
    expect(result.status).toBe("converged");
    expect(result.solution[0]).toBeCloseTo(1 - Math.fround(0.2), 12);
    expect(result.solution[1]).toBeCloseTo(
      1 - Math.fround(0.2) + Math.fround(0.1),
      12,
    );
    expect(edges[0].transportAngle).toBe(0.2);
  });
  it("preserves the native float quarter-turn constant and orientation reversal", () => {
    const edge = { left: 0, right: 1, transportAngle: 0.2, quarterTurns: 1 };
    const forward = assembleFieldSystem(
      2,
      [edge],
      3,
      [{ node: 0, angle: 1 }],
      [],
    );
    const reverse = assembleFieldSystem(
      2,
      [{ ...edge, left: 1, right: 0, transportAngle: -0.2, quarterTurns: -1 }],
      3,
      [{ node: 0, angle: 1 }],
      [],
    );
    expect(reverse.system).toEqual(forward.system);
    expect(solve(forward).solution[0]).toBeCloseTo(
      1 - Math.fround(0.2) + Math.fround(Math.PI / 2),
      12,
    );
  });
  it("adds qualifying anchors and ignores the cutoff and fixed-node anchors", () => {
    const edge = { left: 0, right: 1, transportAngle: 0, quarterTurns: 0 };
    const output = assembleFieldSystem(
      2,
      [edge],
      2,
      [],
      [
        { node: 0, angle: 3, strength: 4 },
        { node: 1, angle: 100, strength: 0.000002 },
      ],
    );
    expect(Array.from(output.system.coefficients)).toEqual([6, -2, -2, 2]);
    expect(Array.from(output.system.rightHandSide)).toEqual([12, 0]);
    const anchoredSolution = solve(output).solution;
    expect(anchoredSolution[0]).toBeCloseTo(3, 12);
    expect(anchoredSolution[1]).toBeCloseTo(3, 12);
    const fixed = assembleFieldSystem(
      1,
      [],
      1,
      [{ node: 0, angle: 2 }],
      [{ node: 0, angle: 99, strength: 10 }],
    );
    expect(fixed.variableNodes.length).toBe(0);
    expect(Array.from(fixed.system.offsets)).toEqual([0]);
  });
  it("accumulates repeated connections and retains sorted unique matrix entries", () => {
    const edge = { left: 0, right: 1, transportAngle: 0.5, quarterTurns: 0 };
    const output = assembleFieldSystem(
      2,
      [edge, edge],
      2,
      [{ node: 1, angle: 1 }],
      [],
    );
    expect(Array.from(output.system.coefficients)).toEqual([4]);
    expect(solve(output).solution[0]).toBe(1.5);
  });
  it("leaves an unanchored zero row explicit without claiming positive-definiteness", () => {
    const output = assembleFieldSystem(1, [], 1, [], []);
    expect(Array.from(output.system.coefficients)).toEqual([0]);
    expect(Array.from(output.system.rightHandSide)).toEqual([0]);
    expect(Array.from(output.variableNodes)).toEqual([0]);
  });
  it("rejects malformed constraints and arithmetic overflow", () => {
    expect(() => assembleFieldSystem(-1, [], 1, [], [])).toThrow("node count");
    expect(() => assembleFieldSystem(1, [], -1, [], [])).toThrow("weight");
    expect(() =>
      assembleFieldSystem(
        1,
        [],
        1,
        [
          { node: 0, angle: 0 },
          { node: 0, angle: 1 },
        ],
        [],
      ),
    ).toThrow("unique");
    expect(() =>
      assembleFieldSystem(
        1,
        [{ left: 0, right: 0, transportAngle: 0, quarterTurns: 0 }],
        1,
        [],
        [],
      ),
    ).toThrow("connection");
    expect(() =>
      assembleFieldSystem(1, [], 1, [], [{ node: 1, angle: 0, strength: 1 }]),
    ).toThrow("invalid node");
    expect(() =>
      assembleFieldSystem(
        2,
        [{ left: 0, right: 1, transportAngle: 0, quarterTurns: 2 }],
        Number.MAX_VALUE,
        [],
        [],
      ),
    ).toThrow("overflow");
  });
});

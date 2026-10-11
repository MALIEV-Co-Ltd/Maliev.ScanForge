import { describe, expect, it } from "vitest";
import { applyFieldCandidateConstraints } from "../src/field-candidate-constraints";
import { assembleFieldSystem } from "../src/field-system-assembly";
import {
  solveFieldLinearSystem,
  type FieldLinearSystem,
} from "../src/field-linear-solver";

function diagonal(size: number): FieldLinearSystem {
  return {
    offsets: Uint32Array.from({ length: size + 1 }, (_, i) => i),
    indices: Uint32Array.from({ length: size }, (_, i) => i),
    coefficients: new Float64Array(size).fill(1),
    rightHandSide: new Float64Array(size),
  };
}

describe("recovered selected-candidate constraint updates", () => {
  it("adds coupled rows and a node target, then solves every equation", () => {
    const base = diagonal(3);
    const before = structuredClone(base);
    const turn = Math.fround(Math.PI / 2);
    const delta = (Math.fround(0.2) - turn) * 200;
    const output = applyFieldCandidateConstraints(
      base,
      3,
      new Uint32Array([0, 1, 2]),
      [],
      [
        {
          left: 0,
          right: 1,
          transportAngle: 0.2,
          quarterTurns: 1,
          weight: 200,
        },
        { left: 1, right: 2, transportAngle: 0, quarterTurns: 0, weight: 2 },
      ],
      [{ node: 2, quarterTurns: -1, referenceAngle: 0.4 }],
    );
    expect([...output.system.coefficients]).toEqual([
      201, -200, -200, 203, -2, -2, 4,
    ]);
    expect([...output.system.rightHandSide]).toEqual([
      delta,
      -delta,
      -turn + 0.4,
    ]);
    expect([...output.affectedVariables]).toEqual([0, 1, 1, 2, 2]);
    expect(base).toEqual(before);
    for (const key of [
      "offsets",
      "indices",
      "coefficients",
      "rightHandSide",
    ] as const)
      expect(output.system[key].buffer).not.toBe(base[key].buffer);
    const result = solveFieldLinearSystem(output.system, new Float64Array(3), {
      seedIndices: new Uint32Array([0, 1, 2]),
      relativeTolerance: 1e-12,
      maxIterations: 100,
      diagonalScaling: true,
    });
    expect(result.status).toBe("converged");
    const x = result.solution;
    expect(201 * x[0] - 200 * x[1]).toBeCloseTo(delta, 8);
    expect(-200 * x[0] + 203 * x[1] - 2 * x[2]).toBeCloseTo(-delta, 8);
    expect(-2 * x[1] + 4 * x[2]).toBeCloseTo(-turn + 0.4, 8);
  });

  it("reduces fixed endpoints using float angles and preserves orientation reversal", () => {
    const fixed = [{ node: 0, angle: 0.123456789012 }];
    const edge = {
      left: 0,
      right: 1,
      transportAngle: 0.3,
      quarterTurns: 1,
      weight: 4,
    };
    const forward = applyFieldCandidateConstraints(
      diagonal(1),
      2,
      new Uint32Array([1]),
      fixed,
      [edge],
      [],
    );
    const reverse = applyFieldCandidateConstraints(
      diagonal(1),
      2,
      new Uint32Array([1]),
      fixed,
      [{ ...edge, left: 1, right: 0, transportAngle: -0.3, quarterTurns: -1 }],
      [],
    );
    expect(reverse.system).toEqual(forward.system);
    expect([...forward.system.coefficients]).toEqual([5]);
    expect(forward.system.rightHandSide[0]).toBe(
      Math.fround(fixed[0].angle) * 4 -
        (Math.fround(0.3) - Math.fround(Math.PI / 2)) * 4,
    );
    expect([...forward.affectedVariables]).toEqual([0]);
  });

  it("accumulates into existing entries across batches without replacing earlier contributions", () => {
    const edge = {
      left: 0,
      right: 1,
      transportAngle: 0,
      quarterTurns: 0,
      weight: 3,
    };
    const base = assembleFieldSystem(2, [edge], 2, [], []).system;
    const first = applyFieldCandidateConstraints(
      base,
      2,
      new Uint32Array([1, 0]),
      [],
      [edge],
      [],
    );
    const second = applyFieldCandidateConstraints(
      first.system,
      2,
      new Uint32Array([1, 0]),
      [],
      [edge],
      [],
    );
    expect([...first.system.coefficients]).toEqual([5, -5, -5, 5]);
    expect([...second.system.coefficients]).toEqual([8, -8, -8, 8]);
    expect([...first.affectedVariables]).toEqual([1, 0]);
    expect([...base.coefficients]).toEqual([2, -2, -2, 2]);
  });

  it("keeps explicit zero cross entries and skips fully fixed candidates", () => {
    const edge = {
      left: 0,
      right: 1,
      transportAngle: 0,
      quarterTurns: 0,
      weight: 0,
    };
    const output = applyFieldCandidateConstraints(
      diagonal(2),
      2,
      new Uint32Array([0, 1]),
      [],
      [edge],
      [],
    );
    expect([...output.system.indices]).toEqual([0, 1, 0, 1]);
    expect([...output.system.coefficients]).toEqual([1, 0, 0, 1]);
    const fixed = applyFieldCandidateConstraints(
      diagonal(0),
      2,
      new Uint32Array(),
      [
        { node: 0, angle: 1 },
        { node: 1, angle: 2 },
      ],
      [edge],
      [{ node: 0, quarterTurns: 2, referenceAngle: 0 }],
    );
    expect(fixed.system).toEqual(diagonal(0));
    expect(fixed.affectedVariables.length).toBe(0);
  });

  it("rejects incomplete mappings, malformed sparse input and invalid constraints", () => {
    const base = diagonal(2);
    const mapping = new Uint32Array([0, 1]);
    const edge = {
      left: 0,
      right: 1,
      transportAngle: 0,
      quarterTurns: 0,
      weight: 1,
    };
    expect(() =>
      applyFieldCandidateConstraints(base, 3, mapping, [], [], []),
    ).toThrow();
    expect(() =>
      applyFieldCandidateConstraints(
        base,
        2,
        new Uint32Array([0, 0]),
        [],
        [],
        [],
      ),
    ).toThrow();
    expect(() =>
      applyFieldCandidateConstraints(
        diagonal(1),
        2,
        new Uint32Array([0]),
        [{ node: 0, angle: 1 }],
        [],
        [],
      ),
    ).toThrow();
    expect(() =>
      applyFieldCandidateConstraints(
        { ...base, offsets: new Uint32Array([0, 2, 1]) },
        2,
        mapping,
        [],
        [],
        [],
      ),
    ).toThrow();
    for (const invalid of [
      { ...edge, weight: NaN },
      { ...edge, weight: -1 },
      { ...edge, right: 2 },
      { ...edge, right: 0 },
      { ...edge, quarterTurns: 0.5 },
      { ...edge, transportAngle: Infinity },
    ])
      expect(() =>
        applyFieldCandidateConstraints(base, 2, mapping, [], [invalid], []),
      ).toThrow();
    const node = { node: 0, quarterTurns: 1, referenceAngle: 0 };
    expect(() =>
      applyFieldCandidateConstraints(base, 2, mapping, [], [], [node, node]),
    ).toThrow();
    expect(() =>
      applyFieldCandidateConstraints(
        base,
        2,
        mapping,
        [],
        [],
        [{ ...node, referenceAngle: NaN }],
      ),
    ).toThrow();
  });

  it("rejects arithmetic overflow without modifying the source", () => {
    const base = diagonal(2);
    base.coefficients.fill(Number.MAX_VALUE);
    const before = structuredClone(base);
    expect(() =>
      applyFieldCandidateConstraints(
        base,
        2,
        new Uint32Array([0, 1]),
        [],
        [
          {
            left: 0,
            right: 1,
            transportAngle: 0,
            quarterTurns: 0,
            weight: Number.MAX_VALUE,
          },
        ],
        [],
      ),
    ).toThrow(/overflow/);
    expect(base).toEqual(before);
    const one = diagonal(1);
    one.rightHandSide[0] = Number.MAX_VALUE;
    expect(() =>
      applyFieldCandidateConstraints(
        one,
        1,
        new Uint32Array([0]),
        [],
        [],
        [{ node: 0, quarterTurns: 0, referenceAngle: Number.MAX_VALUE }],
      ),
    ).toThrow(/overflow/);
  });
});

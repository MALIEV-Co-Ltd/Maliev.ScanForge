import { describe, expect, it } from "vitest";
import { selectFieldResidualCandidates } from "../src/field-residual-selection";
import { applyFieldCandidateConstraints } from "../src/field-candidate-constraints";
import { solveFieldLinearSystem } from "../src/field-linear-solver";

describe("recovered phase-one residual buckets", () => {
  it("uses all eight thresholds and puts equality in the next bucket", () => {
    const output = selectFieldResidualCandidates(
      [
        { id: 7, residual: 0.0001 },
        { id: 8, residual: 0.00009 },
        { id: 9, residual: 0.25 },
        { id: 10, residual: 0.249 },
      ],
      [],
      1,
      1,
      0.2,
    );
    expect([...output.thresholds]).toEqual([
      0.0001,
      0.001,
      0.01,
      0.03,
      0.07,
      0.1,
      0.25,
      Number.MAX_VALUE,
    ]);
    expect([...output.connections]).toEqual([8, 7, 10, 9]);
    expect(output.nextThreshold).toBe(0.2);
  });

  it("uses nearest-first only within the overflowing connection bucket and keeps tie order", () => {
    const output = selectFieldResidualCandidates(
      [
        { id: 1, residual: 0.06 },
        { id: 2, residual: 0.04 },
        { id: 3, residual: 0.04 },
        { id: 4, residual: 0.3 },
      ],
      [],
      1,
      0.08,
    );
    expect([...output.connections]).toEqual([2, 3]);
    expect(output.connectionBudgetUsed).toBe(0.14);
    expect(output.nextThreshold).toBe(0.06);
  });

  it("forces one connection when none fits but does not force a second choice", () => {
    const forced = selectFieldResidualCandidates(
      [
        { id: 1, residual: 0.2 },
        { id: 2, residual: 0.1 },
      ],
      [],
      1,
      0,
    );
    expect([...forced.connections]).toEqual([2]);
    expect(forced.nextThreshold).toBe(0.1);
    const prefix = selectFieldResidualCandidates(
      [
        { id: 3, residual: 0 },
        { id: 4, residual: 0.2 },
      ],
      [],
      1,
      0,
    );
    expect([...prefix.connections]).toEqual([3]);
    expect(prefix.nextThreshold).toBe(0.2);
  });

  it("takes the entire node bucket before checking twice the budget", () => {
    const output = selectFieldResidualCandidates(
      [],
      [
        { id: 1, residual: 0.06 },
        { id: 2, residual: 0.04 },
        { id: 3, residual: 0.04 },
        { id: 4, residual: 0.3 },
      ],
      1,
      0.02,
    );
    expect([...output.nodes]).toEqual([1, 2, 3]);
    expect(output.nodeBudgetUsed).toBe(0.14);
    const equal = selectFieldResidualCandidates(
      [],
      [
        { id: 1, residual: 0.04 },
        { id: 2, residual: 0.08 },
      ],
      1,
      0.02,
    );
    expect([...equal.nodes]).toEqual([1, 2]);
  });

  it("handles collapsed thresholds, zero residuals, empty lists and immutable inputs", () => {
    const edges = [
      { id: 1, residual: 0 },
      { id: 2, residual: 0.2 },
    ];
    const before = structuredClone(edges);
    const output = selectFieldResidualCandidates(edges, [], 0, 0);
    expect([...output.connections]).toEqual([1]);
    expect(output.nextThreshold).toBe(0.2);
    expect(edges).toEqual(before);
    const empty = selectFieldResidualCandidates([], [], 0, 0, 0.3);
    expect(empty.connections.length + empty.nodes.length).toBe(0);
    expect(empty.nextThreshold).toBe(0.3);
    expect(empty.connectionBudgetUsed + empty.nodeBudgetUsed).toBe(0);
  });

  it("feeds selected constraints into a coupled solve without applying rejected candidates", () => {
    const candidates = [
      { id: 0, residual: 0.04 },
      { id: 1, residual: 0.06 },
    ];
    const selection = selectFieldResidualCandidates(candidates, [], 1, 0.04);
    const constraints = [
      { left: 0, right: 1, transportAngle: 0.2, quarterTurns: 0, weight: 2 },
      { left: 0, right: 1, transportAngle: 2, quarterTurns: 1, weight: 200 },
    ];
    const output = applyFieldCandidateConstraints(
      {
        offsets: new Uint32Array([0, 1, 2]),
        indices: new Uint32Array([0, 1]),
        coefficients: new Float64Array([1, 1]),
        rightHandSide: new Float64Array([0, 0]),
      },
      2,
      new Uint32Array([0, 1]),
      [],
      Array.from(selection.connections, (id) => constraints[id]),
      [],
    );
    const solve = solveFieldLinearSystem(output.system, new Float64Array(2), {
      seedIndices: new Uint32Array([0, 1]),
      relativeTolerance: 1e-12,
      maxIterations: 100,
      diagonalScaling: true,
    });
    expect(solve.status).toBe("converged");
    expect(solve.solution[0]).toBeCloseTo((Math.fround(0.2) * 2) / 5, 12);
    expect(solve.solution[1]).toBeCloseTo(-solve.solution[0], 12);
    expect([...selection.connections]).toEqual([0]);
  });

  it("rejects malformed IDs, residuals and settings", () => {
    for (const candidate of [
      { id: -1, residual: 0 },
      { id: 0.5, residual: 0 },
      { id: 0, residual: NaN },
      { id: 0, residual: -0.1 },
      { id: 0, residual: 0.51 },
    ])
      expect(() =>
        selectFieldResidualCandidates([candidate], [], 1, 1),
      ).toThrow();
    expect(() =>
      selectFieldResidualCandidates(
        [
          { id: 0, residual: 0 },
          { id: 0, residual: 0.1 },
        ],
        [],
        1,
        1,
      ),
    ).toThrow();
    for (const [scale, budget, previous] of [
      [NaN, 1, 0],
      [1, -1, 0],
      [1, Number.MAX_VALUE, 0],
      [1, 1, Infinity],
    ])
      expect(() =>
        selectFieldResidualCandidates([], [], scale, budget, previous),
      ).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { produceAlternateCurvatureDirections } from "../src/field-curvature-alternate";
import { produceCurvatureDirections } from "../src/field-curvature-directions";
import {
  produceStableCurvatureDirections,
  type CurvatureRadiusData,
} from "../src/field-curvature-radius";
import native from "./fixtures/field-native-alternate.json";

function stages(
  directions: number[][],
  qualificationMode = 1,
): CurvatureRadiusData[] {
  return directions.map((direction, i) => ({
    averages: new Float64Array(6),
    directions: new Float32Array(direction),
    middleValues: new Float32Array([1 + i]),
    largestValues: new Float32Array([10 + 2 * i]),
    qualified: new Uint8Array([
      qualificationMode === 1 || (qualificationMode === 2 && i % 2 === 0)
        ? 1
        : 0,
    ]),
  }));
}
function previous(radii: CurvatureRadiusData[], flags = 0) {
  const state = produceStableCurvatureDirections(radii, {
    backwardSpan: 0,
    forwardSpan: 0,
    ratioMinimum: 0,
    skippedFaces: new Uint8Array([255]),
  });
  state.selectedRadius[0] = 7;
  state.directions.set([1, 0, 0]);
  state.middleValues[0] = 9;
  state.largestValues[0] = 9;
  state.strengths[0] = 9;
  state.flags[0] = flags;
  state.qualifiedCounts[0] = 2;
  state.stableCounts[0] = 3;
  state.costs.forEach((cost) => (cost[0] = 777));
  state.candidateMasks.forEach((mask) => (mask[0] = 128));
  return state;
}

describe("alternate curvature direction worker", () => {
  it("dispatches mode one to the alternate worker and preserves primary modes", () => {
    const radii = stages([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const options = {
      backwardSpan: 1,
      forwardSpan: 1,
      ratioMinimum: 0.7,
      normalThresholds: [0.4, 0.5, 0.8] as const,
      previous: previous(radii),
    };
    const normals = new Float32Array([0, 0, 1]);
    const thresholds = new Float32Array([1, 0.5]);
    const alternate = produceCurvatureDirections(radii, normals, thresholds, {
      ...options,
      mode: 1,
    });
    expect(alternate).toEqual(
      produceAlternateCurvatureDirections(radii, options),
    );
    expect(alternate.strengths[0]).toBe(9);
    const primary = produceCurvatureDirections(
      radii,
      normals,
      thresholds,
      options,
    );
    expect(primary.strengths[0]).not.toBe(9);
    for (const mode of [0, 2] as const)
      expect(
        produceCurvatureDirections(radii, normals, thresholds, {
          ...options,
          mode,
        }),
      ).toEqual(primary);
  });
  it("addresses qualification and skip bits across byte boundaries", () => {
    const radii: CurvatureRadiusData[] = [
      {
        averages: new Float64Array(9 * 6),
        directions: new Float32Array(
          Array.from({ length: 9 }, () => [1, 0, 0]).flat(),
        ),
        middleValues: new Float32Array(9).fill(-2),
        largestValues: new Float32Array(9).fill(-10),
        qualified: new Uint8Array([255, 1]),
      },
    ];
    const result = produceAlternateCurvatureDirections(radii, {
      backwardSpan: 0,
      forwardSpan: 0,
      skippedFaces: new Uint8Array([0, 1]),
    });
    expect(Array.from(result.selectedRadius)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, -1,
    ]);
    expect(Array.from(result.candidateMasks[0])).toEqual([255, 0]);
    expect(Array.from(result.middleValues)).toEqual([
      -2, -2, -2, -2, -2, -2, -2, -2, 0,
    ]);
  });
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete original worker case $id",
    (entry) => {
      const radii = stages(entry.directions, entry.qualificationMode);
      radii.forEach((radius, i) => {
        radius.middleValues[0] = entry.middleInputs[i];
        radius.largestValues[0] = entry.largestInputs[i];
      });
      const prior = previous(radii, entry.initialFlags);
      const result = produceAlternateCurvatureDirections(radii, {
        backwardSpan: entry.back,
        forwardSpan: entry.forward,
        skippedFaces: new Uint8Array([Number(entry.skip)]),
        previous: prior,
      });
      expect(result.selectedRadius[0]).toBe(entry.selected);
      expect(Array.from(result.directions)).toEqual(entry.outputDirection);
      expect(result.middleValues[0]).toBe(entry.middle);
      expect(result.largestValues[0]).toBe(entry.largest);
      expect(result.strengths[0]).toBe(entry.strength);
      expect(result.flags[0]).toBe(entry.flags);
      expect(result.qualifiedCounts[0]).toBe(entry.rawCount);
      expect(result.stableCounts[0]).toBe(entry.stableCount);
      expect(result.costs.map((v) => v[0])).toEqual(entry.costs);
      expect(result.candidateMasks.map((v) => v[0])).toEqual(entry.stable);
      expect(result.completed[0]).toBe(entry.skip ? 0 : 1);
      expect(prior.strengths[0]).toBe(9);
      expect(prior.selectedRadius[0]).toBe(7);
      expect(prior.middleValues[0]).toBe(9);
    },
  );
  it("preserves strength for both stable and constrained winners", () => {
    const radii = stages([[1, 0, 0]]);
    for (const flags of [0, 4, 8, 12, 132, 137, 141]) {
      const result = produceAlternateCurvatureDirections(radii, {
        backwardSpan: 0,
        forwardSpan: 0,
        previous: previous(radii, flags),
      });
      expect(result.strengths[0]).toBe(9);
      expect(result.selectedRadius[0]).toBe(flags & 12 ? 7 : 0);
    }
  });
  it("uses qualified weights even when their neighboring radii prevent stable qualification", () => {
    const radii = stages(
      [
        [1, 0, 0],
        [0, 1, 0],
        [1, 0, 0],
      ],
      2,
    );
    radii[0].middleValues[0] = -2;
    radii[1].middleValues[0] = -20;
    radii[2].middleValues[0] = 8;
    const result = produceAlternateCurvatureDirections(radii, {
      backwardSpan: 1,
      forwardSpan: 1,
      previous: previous(radii),
    });
    expect(result.middleValues[0]).toBe(7.5);
    expect(result.selectedRadius[0]).toBe(-1);
    expect(result.flags[0]).toBe(0);
    expect(Array.from(result.directions)).toEqual([1, 0, 0]);
    expect(result.strengths[0]).toBe(9);
  });
  it("does not alias prior storage or input radius data", () => {
    const radii = stages([[1, 0, 0]]);
    const prior = previous(radii);
    const result = produceAlternateCurvatureDirections(radii, {
      backwardSpan: 0,
      forwardSpan: 0,
      previous: prior,
    });
    result.directions[0] = 42;
    result.costs[0][0] = 42;
    result.candidateMasks[0][0] = 0;
    expect(prior.directions[0]).toBe(1);
    expect(prior.costs[0][0]).toBe(777);
    expect(prior.candidateMasks[0][0]).toBe(128);
    expect(radii[0].directions[0]).toBe(1);
  });
  it("rejects missing averaging radii instead of returning native division-by-zero data", () => {
    const prior = previous(stages([[1, 0, 0]]));
    prior.costs = [];
    prior.candidateMasks = [];
    expect(() =>
      produceAlternateCurvatureDirections([], {
        backwardSpan: 0,
        forwardSpan: 0,
        previous: prior,
      }),
    ).toThrow("at least one radius");
  });
  it("rejects nonfinite data and invalid spans before calculation", () => {
    const radii = stages([[NaN, 0, 0]]);
    expect(() =>
      produceAlternateCurvatureDirections(radii, {
        backwardSpan: 0,
        forwardSpan: 0,
      }),
    ).toThrow("finite");
    expect(() =>
      produceAlternateCurvatureDirections([], {
        backwardSpan: -1,
        forwardSpan: 0,
      }),
    ).toThrow("thresholds");
  });
});

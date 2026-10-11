import { describe, expect, it } from "vitest";
import { produceConstrainedCurvatureDirections } from "../src/field-curvature-constrained";
import {
  produceStableCurvatureDirections,
  type CurvatureRadiusData,
} from "../src/field-curvature-radius";
import native from "./fixtures/field-native-constrained.json";

function stages(
  directions: number[][],
  middle?: number[],
  largest?: number[],
): CurvatureRadiusData[] {
  return directions.map((direction, i) => ({
    averages: new Float64Array(6),
    directions: new Float32Array(direction),
    middleValues: new Float32Array([middle?.[i] ?? 1]),
    largestValues: new Float32Array([largest?.[i] ?? 10]),
    qualified: new Uint8Array([1]),
  }));
}
function prior(radii: CurvatureRadiusData[], flags = 9) {
  const state = produceStableCurvatureDirections(
    radii.map((v) => ({ ...v, qualified: new Uint8Array() })),
    { backwardSpan: 1, forwardSpan: 1, ratioMinimum: 0.7 },
  );
  state.directions.set([1, 0, 0]);
  state.flags[0] = flags;
  state.middleValues[0] = 9;
  state.largestValues[0] = 9;
  state.strengths[0] = 9;
  state.qualifiedCounts[0] = 2;
  state.stableCounts[0] = 3;
  for (const cost of state.costs) cost[0] = 777;
  return state;
}

describe("constrained curvature radius production", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches isolated native constrained branch case $id at window $back/$forward",
    (entry) => {
      const radii = stages(
        entry.directions,
        entry.middleInputs,
        entry.largestInputs,
      );
      const previous = prior(radii, entry.initialFlags);
      const result = produceConstrainedCurvatureDirections(radii, previous, {
        backwardSpan: entry.back,
        forwardSpan: entry.forward,
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
      expect(result.completed[0]).toBe(1);
      expect(previous.flags[0]).toBe(entry.initialFlags);
      expect(previous.strengths[0]).toBe(9);
    },
  );
  it("selects only candidates with completely qualified clipped windows", () => {
    const radii = stages(
      [
        [1, 0, 0],
        [1, 0, 0],
        [1, 0, 0],
      ],
      [1, 2, 3],
      [10, 12, 14],
    );
    radii[0].qualified[0] = 0;
    const result = produceConstrainedCurvatureDirections(radii, prior(radii), {
      backwardSpan: 1,
      forwardSpan: 1,
    });
    expect(result.chosenRadius[0]).toBe(2);
    expect(result.middleValues[0]).toBe(3);
    expect(result.largestValues[0]).toBe(14);
    expect(result.selectedRadius[0]).toBe(-1);
  });
  it("swaps signed eigenvalues for an orthogonal supplied direction", () => {
    const radii = stages([[0, 1, 0]], [-2], [-10]);
    const result = produceConstrainedCurvatureDirections(radii, prior(radii), {
      backwardSpan: 0,
      forwardSpan: 0,
    });
    expect(result.middleValues[0]).toBe(-10);
    expect(result.largestValues[0]).toBe(-2);
    expect(Array.from(result.directions)).toEqual([1, 0, 0]);
  });
  it("uses raw supplied dot without clamping the eigenvalue projection", () => {
    const radii = stages([[2, 0, 0]]);
    const result = produceConstrainedCurvatureDirections(radii, prior(radii), {
      backwardSpan: 0,
      forwardSpan: 0,
    });
    expect(result.middleValues[0]).toBe(-8);
    expect(result.largestValues[0]).toBe(19);
  });
  it("projects both values to their mean at raw dot equality 0.5", () => {
    const radii = stages([[0.5, Math.sqrt(0.75), 0]]);
    const result = produceConstrainedCurvatureDirections(radii, prior(radii), {
      backwardSpan: 0,
      forwardSpan: 0,
    });
    expect(result.middleValues[0]).toBe(5.5);
    expect(result.largestValues[0]).toBe(5.5);
  });
  it("retains first-radius ties and the double five-degree deadband", () => {
    const radii = stages(
      [
        [1, 0, 0],
        [1, 0, 0],
      ],
      [0, 0],
      [0, 0],
    );
    const result = produceConstrainedCurvatureDirections(radii, prior(radii), {
      backwardSpan: 0,
      forwardSpan: 0,
    });
    expect(result.chosenRadius[0]).toBe(0);
    expect(result.scores.map((v) => v[0])).toEqual([0, 0]);
    const angle = (4 * Math.PI) / 180;
    const tilted = stages([[Math.cos(angle), Math.sin(angle), 0]]);
    const tiny = produceConstrainedCurvatureDirections(tilted, prior(tilted), {
      backwardSpan: 0,
      forwardSpan: 0,
    });
    expect(tiny.scores[0][0]).toBe(Math.fround(Math.fround(0.9) * 2) * 0.5);
  });
  it("preserves nonconstrained and skipped outputs and marks fallback incomplete", () => {
    const radii = stages([[1, 0, 0]]);
    const unflagged = prior(radii, 3);
    const skipped = produceConstrainedCurvatureDirections(radii, unflagged, {
      backwardSpan: 1,
      forwardSpan: 1,
    });
    expect(skipped.strengths[0]).toBe(9);
    expect(skipped.chosenRadius[0]).toBe(-1);
    const previous = prior(radii);
    expect(
      produceConstrainedCurvatureDirections(radii, previous, {
        backwardSpan: 1,
        forwardSpan: 1,
        skippedFaces: new Uint8Array([1]),
      }).strengths[0],
    ).toBe(9);
    radii[0].qualified[0] = 0;
    const incomplete = produceConstrainedCurvatureDirections(radii, previous, {
      backwardSpan: 1,
      forwardSpan: 1,
    });
    expect(incomplete.completed[0]).toBe(0);
    expect(incomplete.strengths[0]).toBe(50000);
    expect(incomplete.flags[0]).toBe(9);
    expect(incomplete.middleValues[0]).toBe(9);
  });
  it("rejects malformed completion state and overflowing projection", () => {
    const radii = stages([[1, 0, 0]]);
    const previous = prior(radii);
    expect(() =>
      produceConstrainedCurvatureDirections(
        radii,
        { ...previous, completed: new Uint8Array() },
        { backwardSpan: 1, forwardSpan: 1 },
      ),
    ).toThrow();
    radii[0].middleValues[0] = 3e38;
    radii[0].largestValues[0] = 3e38;
    expect(() =>
      produceConstrainedCurvatureDirections(radii, previous, {
        backwardSpan: 0,
        forwardSpan: 0,
      }),
    ).toThrow();
  });
});

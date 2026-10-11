import { describe, expect, it } from "vitest";
import {
  produceStableCurvatureDirections,
  type CurvatureRadiusData,
} from "../src/field-curvature-radius";
import native from "./fixtures/field-native-radius.json";
import { buildCurvatureEdgeData } from "../src/field-edge-curvature";
import { aggregateCurvatureNeighborhoods } from "../src/field-curvature-neighborhood";
import {
  deriveCurvatureFaceEigenData,
  qualifyCurvatureFaces,
} from "../src/field-curvature-faces";

function stages(directions: number[][]): CurvatureRadiusData[] {
  return directions.map((v) => ({
    averages: new Float64Array(6),
    directions: new Float32Array(v),
    middleValues: new Float32Array([1]),
    largestValues: new Float32Array([10]),
    qualified: new Uint8Array([1]),
  }));
}

describe("stable curvature radius production", () => {
  it("connects folded scan edge tensors through radius neighborhoods and face qualification", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
    const normals = new Float32Array([0, 0, 1, 0, 1, 0]);
    const edges = buildCurvatureEdgeData(positions, triangles, normals);
    const radii = [2, 4, 8].map((radius) => {
      const tensors = aggregateCurvatureNeighborhoods(
        positions,
        edges,
        radius,
      ).tensors;
      const data = deriveCurvatureFaceEigenData(triangles, tensors);
      return {
        ...data,
        qualified: qualifyCurvatureFaces(data, normals, {
          ratioMinimum: 0.7,
          normalDotMaximum: 0,
        }),
      };
    });
    const result = produceStableCurvatureDirections(radii, {
      backwardSpan: 1,
      forwardSpan: 1,
      ratioMinimum: 0.7,
    });
    expect(Array.from(result.selectedRadius)).toEqual([0, 0]);
    expect(Array.from(result.flags)).toEqual([3, 3]);
    expect(Array.from(result.strengths)).toEqual([1000, 1000]);
    expect(Array.from(result.directions)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(Array.from(result.qualifiedCounts)).toEqual([3, 3]);
    expect(Array.from(result.stableCounts)).toEqual([3, 3]);
  });
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches isolated native stable branch case $id with window $back/$forward",
    (entry) => {
      const radii = stages(entry.directions);
      const options = {
        backwardSpan: entry.back,
        forwardSpan: entry.forward,
        ratioMinimum: entry.ratioMinimum,
      };
      const prior = produceStableCurvatureDirections(
        radii.map((v) => ({ ...v, qualified: new Uint8Array() })),
        options,
      );
      prior.flags[0] = 128;
      prior.qualifiedCounts[0] = 2;
      prior.stableCounts[0] = 3;
      for (const costs of prior.costs) costs[0] = 777;
      const result = produceStableCurvatureDirections(radii, {
        ...options,
        previous: prior,
      });
      expect(result.selectedRadius[0]).toBe(entry.selected);
      expect(result.qualifiedCounts[0]).toBe(entry.rawCount);
      expect(result.stableCounts[0]).toBe(entry.stableCount);
      expect(result.candidateMasks.map((v) => v[0])).toEqual(entry.stable);
      expect(Array.from(result.directions)).toEqual(entry.outputDirection);
      expect(result.middleValues[0]).toBe(entry.middle);
      expect(result.largestValues[0]).toBe(entry.largest);
      expect(result.flags[0]).toBe(entry.flags);
      for (let radius = 0; radius < radii.length; radius++)
        expect(result.costs[radius][0]).toBe(entry.costs[radius]);
      expect(result.strengths[0]).toBe(entry.strength);
      expect(result.completed[0]).toBe(1);
      expect(prior.flags[0]).toBe(128);
      expect(prior.qualifiedCounts[0]).toBe(2);
    },
  );
  it("requires qualification throughout the inclusive clipped window", () => {
    const radii = stages([
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ]);
    radii[0].qualified[0] = 0;
    const result = produceStableCurvatureDirections(radii, {
      backwardSpan: 1,
      forwardSpan: 1,
      ratioMinimum: 0.7,
    });
    expect(result.qualifiedCounts[0]).toBe(2);
    expect(result.stableCounts[0]).toBe(1);
    expect(result.candidateMasks.map((v) => v[0])).toEqual([0, 0, 1]);
    expect(result.selectedRadius[0]).toBe(2);
  });
  it("retains the first radius on ties and divides angle sums by window size including self", () => {
    const radii = stages([
      [1, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
    ]);
    const result = produceStableCurvatureDirections(radii, {
      backwardSpan: 1,
      forwardSpan: 1,
      ratioMinimum: 0.7,
    });
    expect(result.selectedRadius[0]).toBe(0);
    expect(result.costs[0][0]).toBe(Math.fround(Math.fround(Math.PI / 2) / 2));
    expect(result.costs[1][0]).toBe(
      Math.fround(Math.fround(Math.fround(Math.PI / 2) * 2) / 3),
    );
  });
  it("preserves constrained and skipped face state for their separate branches", () => {
    const radii = stages([[1, 0, 0]]);
    const options = { backwardSpan: 1, forwardSpan: 1, ratioMinimum: 0.7 };
    const prior = produceStableCurvatureDirections(radii, options);
    prior.flags[0] = 13;
    prior.strengths[0] = 42;
    const result = produceStableCurvatureDirections(radii, {
      ...options,
      previous: prior,
    });
    expect(result.flags[0]).toBe(13);
    expect(result.strengths[0]).toBe(42);
    expect(result.completed[0]).toBe(0);
    const masked = produceStableCurvatureDirections(radii, {
      ...options,
      skippedFaces: new Uint8Array([1]),
    });
    expect(masked.selectedRadius[0]).toBe(-1);
    expect(masked.completed[0]).toBe(0);
  });
  it("reports the need for fallback without substituting another selection rule", () => {
    const radii = stages([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    radii[0].qualified[0] = 0;
    const result = produceStableCurvatureDirections(radii, {
      backwardSpan: 1,
      forwardSpan: 1,
      ratioMinimum: 0.7,
    });
    expect(result.selectedRadius[0]).toBe(-1);
    expect(result.completed[0]).toBe(0);
    expect(result.qualifiedCounts[0]).toBe(1);
    expect(result.stableCounts[0]).toBe(0);
    expect(Array.from(result.directions)).toEqual([0, 0, 0]);
  });
  it("handles empty stages and rejects malformed or overflowing inputs", () => {
    const options = { backwardSpan: 1, forwardSpan: 1, ratioMinimum: 0.7 };
    expect(produceStableCurvatureDirections([], options).flags.length).toBe(0);
    for (const span of [-1, 0.5, Infinity])
      expect(() =>
        produceStableCurvatureDirections(stages([[1, 0, 0]]), {
          ...options,
          backwardSpan: span,
        }),
      ).toThrow();
    const radii = stages([[1, 0, 0]]);
    radii[0].directions[0] = NaN;
    expect(() => produceStableCurvatureDirections(radii, options)).toThrow();
    const huge = stages([
      [3e38, 3e38, 3e38],
      [3e38, 3e38, 3e38],
    ]);
    expect(() => produceStableCurvatureDirections(huge, options)).toThrow();
  });
});

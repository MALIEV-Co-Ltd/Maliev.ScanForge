import { describe, expect, it } from "vitest";
import { produceFallbackCurvatureDirections } from "../src/field-curvature-fallback";
import {
  produceStableCurvatureDirections,
  type CurvatureRadiusData,
} from "../src/field-curvature-radius";
import native from "./fixtures/field-native-fallback.json";
import { produceCurvatureDirections } from "../src/field-curvature-directions";

function fixture(middle = [1, 1, 1], large = [10, 10, 10]) {
  const radii: CurvatureRadiusData[] = middle.map((v, i) => ({
    averages: new Float64Array(6),
    directions: new Float32Array([1, 0, 0]),
    middleValues: new Float32Array([v]),
    largestValues: new Float32Array([large[i]]),
    qualified: new Uint8Array(),
  }));
  const previous = produceStableCurvatureDirections(radii, {
    backwardSpan: 0,
    forwardSpan: 0,
    ratioMinimum: 0.7,
  });
  previous.directions.set([0, 1, 0]);
  previous.strengths[0] = 9;
  previous.flags[0] = 128;
  previous.qualifiedCounts[0] = 4;
  previous.stableCounts[0] = 3;
  previous.costs.forEach((v) => (v[0] = 777));
  const normals = new Float32Array([0, 0, 1]);
  const thresholds = new Float32Array(radii.length).fill(10);
  const options = {
    ratioMinimum: 0.7,
    normalThresholds: [0.1, 0.4, 0.8] as const,
  };
  const run = () =>
    produceFallbackCurvatureDirections(
      radii,
      previous,
      normals,
      thresholds,
      options,
    );
  return { radii, previous, normals, thresholds, options, run };
}

describe("fallback curvature direction production", () => {
  it("composes stable, constrained and fallback production for a mixed face batch", () => {
    const radii: CurvatureRadiusData[] = Array.from({ length: 3 }, () => ({
      averages: new Float64Array(18),
      directions: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
      middleValues: new Float32Array([1, 1, 1]),
      largestValues: new Float32Array([10, 10, 10]),
      qualified: new Uint8Array([3]),
    }));
    const previous = produceStableCurvatureDirections(radii, {
      backwardSpan: 1,
      forwardSpan: 1,
      ratioMinimum: 0.7,
      skippedFaces: new Uint8Array([7]),
    });
    previous.flags.set([128, 132, 128]);
    previous.directions.set([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const result = produceCurvatureDirections(
      radii,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      new Float32Array([10, 10, 10]),
      {
        backwardSpan: 1,
        forwardSpan: 1,
        ratioMinimum: 0.7,
        normalThresholds: [0.1, 0.4, 0.8],
        previous,
      },
    );
    expect(Array.from(result.completed)).toEqual([1, 1, 1]);
    expect(Array.from(result.selectedRadius)).toEqual([0, -1, 0]);
    expect(Array.from(result.flags)).toEqual([131, 134, 129]);
    expect(Array.from(result.directions)).toEqual([1, 0, 0, 0, 1, 0, 1, 0, 0]);
    expect(result.strengths[1]).toBe(50000);
    expect(Array.from(result.qualifiedCounts)).toEqual([3, 0, 0]);
    expect(Array.from(previous.flags)).toEqual([128, 132, 128]);
  });
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches isolated native fallback numerical case $id",
    (entry) => {
      const source = fixture(entry.middleInputs, entry.largestInputs);
      source.radii.forEach((radius, i) => {
        radius.directions.set(entry.directions[i]);
        radius.qualified = new Uint8Array([entry.qualified[i]]);
      });
      source.previous.flags[0] = entry.initialFlags;
      if (entry.initialFlags & 12) source.previous.strengths[0] = 50000;
      source.normals.set(entry.normal);
      const result = source.run();
      expect(result.selectedRadius[0]).toBe(entry.selected);
      expect(Array.from(result.directions)).toEqual(entry.outputDirection);
      expect(result.middleValues[0]).toBe(entry.middle);
      expect(result.largestValues[0]).toBe(entry.largest);
      expect(result.flags[0]).toBe(entry.flags);
      expect(result.strengths[0]).toBe(entry.strength);
    },
  );
  it("copies a winning direction and signed eigenvalues while preserving counters", () => {
    const { previous, run } = fixture();
    const result = run();
    expect(result.selectedRadius[0]).toBe(0);
    expect(Array.from(result.directions)).toEqual([1, 0, 0]);
    expect(result.middleValues[0]).toBe(1);
    expect(result.largestValues[0]).toBe(10);
    expect(result.flags[0]).toBe(129);
    expect(result.strengths[0]).toBeGreaterThan(40);
    expect(result.completed[0]).toBe(1);
    expect(result.qualifiedCounts[0]).toBe(4);
    expect(result.stableCounts[0]).toBe(3);
    expect(result.costs.map((v) => v[0])).toEqual([777, 777, 777]);
    expect(result.candidateMasks.map((v) => Array.from(v))).toEqual([
      [0],
      [0],
      [0],
    ]);
    expect(Array.from(previous.directions)).toEqual([0, 1, 0]);
    expect(previous.flags[0]).toBe(128);
  });
  it("preserves a fixed direction and assigns fixed strength on successful fallback", () => {
    const { previous, run } = fixture();
    previous.flags[0] |= 1;
    expect(Array.from(run().directions)).toEqual([0, 1, 0]);
    expect(run().strengths[0]).toBe(50000);
  });
  it("discounts the last two radii and searches ties strictly", () => {
    const { run } = fixture([1, 1, 1], [2, 2, 2]);
    expect(run().selectedRadius[0]).toBe(2);
    const tied = fixture();
    expect(tied.run().fallbackScores.map((v) => v[0])).toEqual([0, 0, 0]);
    expect(tied.run().selectedRadius[0]).toBe(0);
  });
  it("penalizes supplied unnormalized normal dots and reduces strength", () => {
    const { normals, run } = fixture();
    const baseline = run().strengths[0];
    normals.set([0.3, 0, 0]);
    const penalized = run();
    expect(penalized.strengths[0]).toBeLessThan(baseline);
    expect(penalized.fallbackScores[0][0]).toBeGreaterThan(0);
    normals.set([2, 0, 0]);
    expect(run().strengths[0]).toBe(Math.fround(1e-6));
  });
  it.each([
    { middle: [1.99, 1.99, 1.99], large: [2, 2, 2] },
    { middle: [0.001, 0.001, 0.001], large: [0.01, 0.01, 0.01] },
    { middle: [-1, -1, -1], large: [-10, -10, -10] },
  ])(
    "assigns weak strength for low ratio or signed magnitude $large",
    (entry) => {
      const { run } = fixture(entry.middle, entry.large);
      expect(run().strengths[0]).toBe(Math.fround(1e-6));
    },
  );
  it("marks a selected low-magnitude anisotropic direction as constrained", () => {
    const { run } = fixture([0.1, 0.1, 0.1], [2, 2, 2]);
    expect(run().flags[0] & 3).toBe(3);
  });
  it("retains direction and uses absolute eigenvalue means when a score is NaN", () => {
    const { previous, run } = fixture([-1], [-10]);
    const result = run();
    expect(result.selectedRadius[0]).toBe(-1);
    expect(result.middleValues[0]).toBe(1);
    expect(result.largestValues[0]).toBe(10);
    expect(Array.from(result.directions)).toEqual([0, 1, 0]);
    expect(result.flags[0]).toBe(128);
    expect(result.strengths[0]).toBe(Math.fround(1e-6));
    expect(Number.isNaN(result.fallbackScores[0][0])).toBe(true);
    previous.flags[0] |= 4;
    expect(run().strengths[0]).toBe(9);
  });
  it("weights qualifying radii by five and halves first and last mean weights", () => {
    const { radii, run } = fixture([7.1, 14.2, 21.3], [10, 20, 30]);
    // Ratios below double 0.3 have no admitted angle comparisons; all scores are NaN.
    radii[0].qualified = new Uint8Array([1]);
    const result = run();
    expect(result.selectedRadius[0]).toBe(-1);
    expect(result.largestValues[0]).toBe(15);
    expect(result.middleValues[0]).toBeCloseTo(10.65, 5);
  });
  it("skips completed and explicitly masked faces", () => {
    const { radii, previous, normals, thresholds, options, run } = fixture();
    previous.completed[0] = 1;
    expect(run().selectedRadius[0]).toBe(-1);
    expect(run().strengths[0]).toBe(9);
    previous.completed[0] = 0;
    const result = produceFallbackCurvatureDirections(
      radii,
      previous,
      normals,
      thresholds,
      { ...options, skippedFaces: new Uint8Array([1]) },
    );
    expect(result.completed[0]).toBe(0);
    expect(result.strengths[0]).toBe(9);
  });
  it("rejects invalid cache dimensions, thresholds and overflowing output", () => {
    const { previous, thresholds, options, run } = fixture();
    previous.completed = new Uint8Array();
    expect(run).toThrow(/inputs/);
    previous.completed = new Uint8Array(1);
    thresholds[0] = 0;
    expect(run).toThrow(/inputs/);
    thresholds[0] = 10;
    options.ratioMinimum = -0.2;
    expect(run).toThrow(/inputs/);
    const overflow = fixture([3e38], [3e38]);
    overflow.radii[0].qualified = new Uint8Array([1]);
    // Single-radius weights multiply to 1.25 and overflow the native float sum.
    expect(overflow.run).toThrow(/overflow/);
  });
});

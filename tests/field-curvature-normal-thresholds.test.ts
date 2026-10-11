import { describe, expect, it } from "vitest";
import { prepareCurvatureNormalThresholds } from "../src/field-curvature-normal-thresholds";
import native from "./fixtures/field-native-normal-thresholds.json";

describe("curvature owner normal-angle caches", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches isolated original sine-cache block case $id",
    (entry) => {
      const result = prepareCurvatureNormalThresholds(
        entry.angles[0],
        entry.angles[1],
        entry.angles[2],
      );
      expect(result.qualificationMaximum).toBe(entry.qualification);
      expect(result.directionPenaltyThresholds).toEqual(entry.penalties);
    },
  );
  it("computes sine of the float angle midpoint rather than mean endpoint sines", () => {
    const result = prepareCurvatureNormalThresholds(0.5, 0, Math.PI / 2);
    expect(result.directionPenaltyThresholds[0]).toBe(0);
    expect(result.directionPenaltyThresholds[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(result.directionPenaltyThresholds[2]).toBe(1);
    expect(result.directionPenaltyThresholds[1]).not.toBe(0.5);
  });
  it("preserves caller endpoint order and periodic/negative-angle behavior", () => {
    const forward = prepareCurvatureNormalThresholds(0.5, 0.4, 0.8);
    const reverse = prepareCurvatureNormalThresholds(0.5, 0.8, 0.4);
    expect(reverse.directionPenaltyThresholds).toEqual([
      forward.directionPenaltyThresholds[2],
      forward.directionPenaltyThresholds[1],
      forward.directionPenaltyThresholds[0],
    ]);
    const negative = prepareCurvatureNormalThresholds(-0.5, -0.4, -0.8);
    expect(negative.qualificationMaximum).toBe(-forward.qualificationMaximum);
    expect(negative.directionPenaltyThresholds).toEqual(
      forward.directionPenaltyThresholds.map((v) => -v),
    );
  });
  it.each([
    [Infinity, 0, 1],
    [0, NaN, 1],
    [0, 0, Infinity],
    [1e40, 0, 1],
    [0, 2e38, 2e38],
  ])(
    "rejects nonfinite float inputs or midpoint overflow %j",
    (q, low, high) => {
      expect(() => prepareCurvatureNormalThresholds(q, low, high)).toThrow(
        /finite/,
      );
    },
  );
});

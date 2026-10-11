import { describe, expect, it } from "vitest";
import { deriveExplicitCurvatureRadiusBounds } from "../src/field-curvature-bounds";
import { prepareCurvatureRadii } from "../src/field-curvature-schedule";
import native from "./fixtures/field-native-explicit-bounds.json";

describe("explicit-count curvature radius bounds", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches original numerical block case $id",
    (entry) => {
      expect(
        deriveExplicitCurvatureRadiusBounds({
          ...entry,
          combinedSurfaceArea: entry.combinedSurfaceArea ?? undefined,
        }),
      ).toEqual({
        minimum: entry.minimum,
        maximum: entry.maximum,
        ratio: entry.storedRatio,
        referenceMinimum: entry.referenceMinimum,
        count: entry.count,
      });
    },
  );
  const parameters = {
    surfaceArea: 40000,
    targetCount: 100,
    ratio: 2,
    stageCount: 3,
  };
  it("preserves the supplied stage count even for a ratio with another percentage count", () => {
    const result = deriveExplicitCurvatureRadiusBounds({
      ...parameters,
      ratio: 10,
      stageCount: 2,
    });
    expect(result).toEqual({
      minimum: 10,
      maximum: 100,
      referenceMinimum: 10,
      ratio: 10,
      count: 2,
    });
  });
  it("applies the combined-area cap before halving and multiplying by ratio", () => {
    const result = deriveExplicitCurvatureRadiusBounds({
      ...parameters,
      ratio: 10,
      combinedSurfaceArea: 24,
    });
    expect(result.minimum).toBe(0.5);
    expect(result.maximum).toBe(5);
    expect(result.ratio).toBe(10);
  });
  it("retains descending bounds and feeds them into the recovered schedule", () => {
    const bounds = deriveExplicitCurvatureRadiusBounds({
      ...parameters,
      ratio: 0.5,
    });
    const schedule = prepareCurvatureRadii(
      bounds.count,
      bounds.minimum,
      bounds.maximum,
      1,
      3.8,
    );
    expect(Array.from(schedule.radii)).toEqual([10, 7.5, 5]);
  });
  it("retains a zero stage count with positive bounds", () => {
    const result = deriveExplicitCurvatureRadiusBounds({
      ...parameters,
      stageCount: 0,
    });
    expect(result.count).toBe(0);
    expect(result.minimum).toBe(10);
  });
  it.each([
    { surfaceArea: 0 },
    { surfaceArea: Infinity },
    { ratio: 0 },
    { ratio: NaN },
    { targetCount: 0 },
    { targetCount: 0.5 },
    { targetCount: 2147483648 },
    { stageCount: -1 },
    { stageCount: 0.5 },
    { stageCount: 2147483648 },
    { combinedSurfaceArea: 0 },
    { combinedSurfaceArea: -1 },
    { combinedSurfaceArea: Infinity },
  ])("rejects independently invalid inputs %j", (invalid) => {
    expect(() =>
      deriveExplicitCurvatureRadiusBounds({ ...parameters, ...invalid }),
    ).toThrow(/inputs/);
  });
  it("rejects arithmetic underflow and upper-radius overflow", () => {
    expect(() =>
      deriveExplicitCurvatureRadiusBounds({
        ...parameters,
        surfaceArea: 1e-45,
        targetCount: 2147483647,
      }),
    ).toThrow(/underflowed/);
    expect(() =>
      deriveExplicitCurvatureRadiusBounds({
        ...parameters,
        surfaceArea: 3e38,
        targetCount: 1,
        ratio: 3e38,
      }),
    ).toThrow(/overflowed/);
  });
});

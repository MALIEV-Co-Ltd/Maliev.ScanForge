import { describe, expect, it } from "vitest";
import {
  derivePercentageCurvatureRadiusBounds,
  finalizeCurvatureRadiusBounds,
  interpolateCurvatureRadiusFactor,
} from "../src/field-curvature-bounds";
import { buildTriangleNormalCache } from "../src/field-triangle-normals";
import { prepareCurvatureRadii } from "../src/field-curvature-schedule";
import native from "./fixtures/field-native-bounds.json";
import nativeTable from "./fixtures/field-native-bounds-table.json";

describe("geometry-derived percentage radius bounds", () => {
  it.each(nativeTable.cases.map((entry, id) => ({ ...entry, id })))(
    "matches original fixed table interpolation case $id",
    (entry) => {
      expect(interpolateCurvatureRadiusFactor(entry.control, entry.upper)).toBe(
        entry.result,
      );
    },
  );
  it("scales endpoints from cached triangle area before producing the schedule", () => {
    const cache = buildTriangleNormalCache(
      new Float32Array([0, 0, 0, 200, 0, 0, 0, 400, 0]),
      new Uint32Array([0, 1, 2]),
    );
    expect(cache.surfaceArea).toBe(40000);
    const bounds = derivePercentageCurvatureRadiusBounds({
      surfaceArea: cache.surfaceArea,
      baseLength: 1,
      minimumControl: 1,
      maximumControl: 100,
      overrideScale: false,
    });
    expect(bounds.minimum).toBe(Math.fround(Math.fround(0.12) * 2));
    expect(bounds.maximum).toBe(12);
    expect(bounds.count).toBe(6);
    const schedule = prepareCurvatureRadii(
      bounds.count,
      bounds.minimum,
      bounds.maximum,
      1,
      3.8,
    );
    expect(schedule.radii[0]).toBe(bounds.minimum);
    expect(schedule.radii[5]).toBe(bounds.maximum);
  });
  it.each([false, true])("honors the scale override %s", (overrideScale) => {
    const result = derivePercentageCurvatureRadiusBounds({
      surfaceArea: 40000,
      baseLength: 1,
      minimumControl: 50,
      maximumControl: 50,
      overrideScale,
    });
    const scale = overrideScale ? 1 : 2;
    expect(result.minimum).toBe(Math.fround(Math.fround(0.33) * scale));
    expect(result.maximum).toBe(Math.fround(1.75 * scale));
  });
  it("uses the supplied base floor and caller-gated combined-area limit", () => {
    const parameters = {
      surfaceArea: 0,
      baseLength: 10,
      minimumControl: 50,
      maximumControl: 50,
      overrideScale: false,
      combinedSurfaceArea: 24,
    };
    expect(derivePercentageCurvatureRadiusBounds(parameters)).toEqual(
      finalizeCurvatureRadiusBounds(
        Math.fround(Math.fround(0.33) * 10),
        17.5,
        24,
      ),
    );
  });
  it.each([
    { surfaceArea: -1 },
    { surfaceArea: Infinity },
    { baseLength: -1 },
    { minimumControl: 0 },
    { maximumControl: NaN },
  ])("rejects independently invalid inputs %j", (invalid) => {
    expect(() =>
      derivePercentageCurvatureRadiusBounds({
        surfaceArea: 10000,
        baseLength: 1,
        minimumControl: 1,
        maximumControl: 100,
        overrideScale: false,
        ...invalid,
      }),
    ).toThrow(/inputs/);
  });
  it("rejects a zero effective scale and nonfinite standalone controls", () => {
    expect(() =>
      derivePercentageCurvatureRadiusBounds({
        surfaceArea: 0,
        baseLength: 0,
        minimumControl: 1,
        maximumControl: 100,
        overrideScale: false,
      }),
    ).toThrow(/inputs/);
    expect(() => interpolateCurvatureRadiusFactor(Infinity, false)).toThrow();
  });
});

describe("curvature owner bound finalization", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches original bound-finalization block case $id",
    (entry) => {
      const result = finalizeCurvatureRadiusBounds(
        entry.minimum,
        entry.maximum,
        entry.measure ?? undefined,
      );
      expect(result).toEqual({
        minimum: entry.low,
        maximum: entry.high,
        ratio: entry.ratio,
        referenceMinimum: entry.reference,
        count: entry.count,
      });
    },
  );
  it("limits the minimum to double eighty-percent of the maximum", () => {
    const result = finalizeCurvatureRadiusBounds(10, 10);
    expect(result.minimum).toBe(8);
    expect(result.maximum).toBe(10);
    expect(result.ratio).toBe(1.25);
    expect(result.count).toBe(2);
  });
  it.each([
    [1.25, 2],
    [1.6999, 2],
    [1.7, 3],
    [2.9999, 3],
    [3, 4],
    [3.9999, 4],
    [4, 5],
    [6.9999, 5],
    [7, 6],
  ])("uses inclusive stage-count cutoff at ratio %s", (ratio, count) => {
    expect(finalizeCurvatureRadiusBounds(1, ratio).count).toBe(count);
  });
  it("restores the initial ratio when both radii reach the limit", () => {
    const result = finalizeCurvatureRadiusBounds(10, 100, 24);
    expect(result.maximum).toBe(0.5);
    expect(result.minimum).toBe(Math.fround(0.05));
    expect(result.ratio).toBe(10);
    expect(result.referenceMinimum).toBe(result.minimum);
    expect(result.count).toBe(6);
  });
  it("retains original ratio and count when only the upper radius is limited", () => {
    const result = finalizeCurvatureRadiusBounds(0.1, 100, 24);
    expect(result.minimum).toBe(Math.fround(0.1));
    expect(result.maximum).toBe(0.5);
    expect(result.ratio).toBe(1000);
    expect(result.count).toBe(6);
  });
  it("feeds final bounds and derived stage count to the recovered schedule", () => {
    const bounds = finalizeCurvatureRadiusBounds(1, 100, 24);
    const result = prepareCurvatureRadii(
      bounds.count,
      bounds.minimum,
      bounds.maximum,
      2,
      3.8,
    );
    expect(result.radii.length).toBe(6);
    expect(result.radii[0]).toBeCloseTo(bounds.minimum, 7);
    expect(result.radii[5]).toBe(bounds.maximum);
    expect(
      Array.from(result.thresholds).every((v) => Number.isFinite(v) && v > 0),
    ).toBe(true);
  });
  it.each([
    [0, 1, undefined],
    [-1, 1, undefined],
    [1, Infinity, undefined],
    [1, 2, NaN],
    [1, 2, 0],
    [1, 2, -1],
  ])("rejects invalid supplied bounds/measure %j", (low, high, measure) => {
    expect(() => finalizeCurvatureRadiusBounds(low, high, measure)).toThrow(
      /inputs/,
    );
  });
  it("rejects ratio overflow and float underflow", () => {
    expect(() => finalizeCurvatureRadiusBounds(1e-38, 3e38)).toThrow(
      /overflowed/,
    );
    expect(() => finalizeCurvatureRadiusBounds(1, 2, 1e-45)).toThrow(
      /underflowed/,
    );
  });
});

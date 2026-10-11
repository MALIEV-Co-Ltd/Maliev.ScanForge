import { describe, expect, it } from "vitest";
import {
  type CurvatureOwnerBoundState,
  prepareCurvatureOwnerBounds,
} from "../src/field-curvature-owner-bounds";
import { prepareCurvatureRadii } from "../src/field-curvature-schedule";
import native from "./fixtures/field-native-owner-bounds.json";

function state(): CurvatureOwnerBoundState {
  return {
    geometryPresent: true,
    minimumControl: 1,
    maximumControl: 100,
    targetCount: 100,
    baseLength: 1,
    overrideScale: false,
    partCount: 1,
    areas: { baseArea: 100, contextArea: 40000 },
    previous: {
      minimum: 0.125,
      maximum: 8,
      ratio: 2,
      referenceMinimum: 0.25,
      count: 3,
    },
  };
}

describe("curvature owner bound preparation", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches original complete bound-owner function case $id",
    (entry) => {
      expect(prepareCurvatureOwnerBounds(entry.state)).toEqual(entry.result);
    },
  );
  it("preserves stored state with no geometry and returns an independent copy", () => {
    const input = state();
    input.geometryPresent = false;
    input.minimumControl = NaN;
    const result = prepareCurvatureOwnerBounds(input);
    expect(result).toEqual(input.previous);
    expect(result).not.toBe(input.previous);
    expect(input.previous.minimum).toBe(0.125);
  });
  it.each([
    [0, 100],
    [1, 0],
    [-1, 100],
    [1, -1],
  ])(
    "selects explicit bounds when either control is nonpositive %s %s",
    (minimumControl, maximumControl) => {
      const result = prepareCurvatureOwnerBounds({
        ...state(),
        minimumControl,
        maximumControl,
      });
      expect(result).toEqual({
        minimum: 0.5,
        maximum: 1,
        ratio: 2,
        referenceMinimum: 0.5,
        count: 3,
      });
    },
  );
  it("uses context area for percentage controls even when embedded area differs", () => {
    const input = state();
    input.areas.model = {
      storageMode: 2,
      indexElementCount: 3,
      embeddedArea: 900,
    };
    const result = prepareCurvatureOwnerBounds(input);
    expect(result.minimum).toBe(Math.fround(Math.fround(0.12) * 2));
    expect(result.maximum).toBe(12);
    const schedule = prepareCurvatureRadii(
      result.count,
      result.minimum,
      result.maximum,
      1,
      3.8,
    );
    expect(schedule.radii.length).toBe(6);
    expect(schedule.radii[0]).toBe(result.minimum);
    expect(schedule.radii[5]).toBe(result.maximum);
  });
  it("requires both a model and more than one part before the combined-area cap", () => {
    const input = state();
    input.minimumControl = 0;
    input.targetCount = 1;
    input.areas.contextArea = 24;
    input.partCount = 2;
    expect(prepareCurvatureOwnerBounds(input).minimum).toBe(5);
    input.areas.model = {
      storageMode: 2,
      indexElementCount: 3,
      embeddedArea: 900,
    };
    expect(prepareCurvatureOwnerBounds(input).minimum).toBe(0.5);
    input.partCount = 1;
    expect(prepareCurvatureOwnerBounds(input).minimum).toBe(15);
  });
  it.each([
    [0, 2],
    [-1, 2],
    [100, 0],
    [100, -1],
  ])(
    "preserves state when explicit target/ratio fail the native gate %s %s",
    (targetCount, ratio) => {
      const input = state();
      input.minimumControl = 0;
      input.targetCount = targetCount;
      input.previous.ratio = ratio;
      expect(prepareCurvatureOwnerBounds(input)).toEqual(input.previous);
    },
  );
  it("still recomputes percentage bounds when explicit target/ratio are nonpositive", () => {
    const input = state();
    input.targetCount = 0;
    input.previous.ratio = -1;
    const result = prepareCurvatureOwnerBounds(input);
    expect(result.maximum).toBe(12);
    expect(result.ratio).toBeGreaterThan(0);
  });
  it("rejects a missing context source when the selected branch needs it", () => {
    const input = state();
    input.areas.contextArea = undefined;
    expect(() => prepareCurvatureOwnerBounds(input)).toThrow(/context area/);
    input.minimumControl = 0;
    input.partCount = 2;
    input.areas.model = {
      storageMode: 2,
      indexElementCount: 3,
      embeddedArea: 900,
    };
    expect(() => prepareCurvatureOwnerBounds(input)).toThrow(/context area/);
  });
  it.each([
    { minimumControl: NaN },
    { maximumControl: Infinity },
    { targetCount: 0.5 },
    { targetCount: 2147483648 },
    { partCount: -1 },
    { partCount: 0.5 },
  ])("rejects independently unsafe owner inputs %j", (invalid) => {
    expect(() =>
      prepareCurvatureOwnerBounds({ ...state(), ...invalid }),
    ).toThrow(/inputs/);
  });
  it("rejects nonfinite previous state before returning unsafe stored bounds", () => {
    const input = state();
    input.previous.maximum = Infinity;
    input.geometryPresent = false;
    expect(() => prepareCurvatureOwnerBounds(input)).toThrow(/previous/);
  });
});

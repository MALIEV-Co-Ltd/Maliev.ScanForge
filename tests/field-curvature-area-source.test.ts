import { describe, expect, it } from "vitest";
import { selectExplicitCurvatureAreaSource } from "../src/field-curvature-area-source";
import { deriveExplicitCurvatureRadiusBounds } from "../src/field-curvature-bounds";
import native from "./fixtures/field-native-area-source.json";

describe("explicit curvature geometry area routing", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches original source decision and bound integration case $id",
    (entry) => {
      const selected = selectExplicitCurvatureAreaSource(entry.state);
      expect(selected).toEqual({
        source: entry.source,
        surfaceArea: entry.surfaceArea,
      });
      const run = () =>
        deriveExplicitCurvatureRadiusBounds({
          surfaceArea: selected.surfaceArea,
          targetCount: 1,
          ratio: 2,
          stageCount: 3,
        });
      if (entry.surfaceArea === 0) {
        expect(entry.minimum).toBe(0);
        expect(entry.maximum).toBe(0);
        expect(run).toThrow(/inputs/);
      } else {
        const result = run();
        expect(result.minimum).toBe(entry.minimum);
        expect(result.maximum).toBe(entry.maximum);
      }
    },
  );
  it("uses embedded geometry for an empty zero-mode array because its native count is minus one", () => {
    expect(
      selectExplicitCurvatureAreaSource({
        baseArea: 100,
        model: { storageMode: 0, indexElementCount: 0, embeddedArea: 900 },
        contextArea: 400,
      }),
    ).toEqual({ source: "embedded", surfaceArea: 900 });
  });
  it("distinguishes a present zero-area alternate from an absent alternate", () => {
    const model = { storageMode: 2, indexElementCount: 0, embeddedArea: 900 };
    expect(
      selectExplicitCurvatureAreaSource({
        baseArea: 100,
        model: { ...model, alternateArea: 0 },
        contextArea: 400,
      }),
    ).toEqual({ source: "alternate", surfaceArea: 0 });
    expect(
      selectExplicitCurvatureAreaSource({
        baseArea: 100,
        model,
        contextArea: 400,
      }),
    ).toEqual({ source: "context", surfaceArea: 400 });
  });
  it("does not fall back to base geometry when a model has no usable source", () => {
    expect(
      selectExplicitCurvatureAreaSource({
        baseArea: 100,
        model: { storageMode: 1, indexElementCount: 3, embeddedArea: 900 },
      }),
    ).toEqual({ source: "none", surfaceArea: 0 });
  });
  it("returns the selected cached area in float storage precision", () => {
    expect(
      selectExplicitCurvatureAreaSource({ baseArea: 1 / 3 }).surfaceArea,
    ).toBe(Math.fround(1 / 3));
  });
  it.each([
    { storageMode: 0.5 },
    { storageMode: 2147483648 },
    { storageMode: -2147483649 },
    { indexElementCount: -1 },
    { indexElementCount: 0.5 },
    { indexElementCount: 2147483648 },
    { embeddedArea: -1 },
    { alternateArea: NaN },
  ])("rejects independently invalid model inputs %j", (invalid) => {
    expect(() =>
      selectExplicitCurvatureAreaSource({
        baseArea: 100,
        model: {
          storageMode: 2,
          indexElementCount: 3,
          embeddedArea: 900,
          ...invalid,
        },
      }),
    ).toThrow(/inputs/);
  });
  it.each([{ baseArea: -1 }, { baseArea: Infinity }, { contextArea: NaN }])(
    "rejects independently invalid area inputs %j",
    (invalid) => {
      expect(() =>
        selectExplicitCurvatureAreaSource({ baseArea: 100, ...invalid }),
      ).toThrow(/inputs/);
    },
  );
});

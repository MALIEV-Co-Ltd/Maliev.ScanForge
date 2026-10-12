import { describe, expect, it } from "vitest";
import {
  guideQueryBoundsContain,
  guideQueryBoundsLength,
} from "../src/field-query-bounds";
import native from "./fixtures/field-native-query-bounds.json";

describe("recovered guide query bounds", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches original bounds case $id",
    (entry) => {
      const bounds = new Float32Array(entry.bounds);
      const point = new Float32Array(entry.point);
      expect(guideQueryBoundsContain(bounds, point, entry.radius)).toBe(
        entry.inside,
      );
      expect(guideQueryBoundsLength(bounds)).toBe(entry.length);
      expect([...bounds]).toEqual(entry.bounds);
      expect([...point]).toEqual(entry.point);
    },
  );
  it("uses coordinate intervals rather than spherical distance", () => {
    expect(
      guideQueryBoundsContain(
        new Float32Array(6),
        new Float32Array([1, 1, 1]),
        1,
      ),
    ).toBe(true);
  });
  it("preserves inclusive boundaries and negative-radius contraction", () => {
    const bounds = new Float32Array([0, 0, 0, 2, 2, 2]);
    expect(
      guideQueryBoundsContain(bounds, new Float32Array([0.5, 0.5, 0.5]), -0.5),
    ).toBe(true);
    expect(guideQueryBoundsContain(bounds, new Float32Array(3), -0.5)).toBe(
      false,
    );
  });
  it("rejects malformed browser inputs before native-equivalent arithmetic", () => {
    expect(() => guideQueryBoundsLength(new Float32Array(3))).toThrow();
    expect(() =>
      guideQueryBoundsContain(
        new Float32Array(6),
        new Float32Array([NaN, 0, 0]),
        1,
      ),
    ).toThrow();
    expect(() =>
      guideQueryBoundsContain(
        new Float32Array(6),
        new Float32Array(3),
        Infinity,
      ),
    ).toThrow();
  });
});

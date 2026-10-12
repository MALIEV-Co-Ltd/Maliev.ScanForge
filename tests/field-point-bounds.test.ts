import { describe, expect, it } from "vitest";
import { buildGuidePointBounds } from "../src/field-point-bounds";
import native from "./fixtures/field-native-point-bounds.json";

describe("recovered whole-point bounds", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete native bounds case $id",
    (entry) => {
      const initial = new Float32Array(entry.initial);
      const result = buildGuidePointBounds(
        new Float32Array(entry.positions),
        initial,
      );
      expect([...result]).toEqual(entry.bounds);
      expect([...initial]).toEqual(entry.initial);
      expect(result).not.toBe(initial);
    },
  );

  it("includes every stored point independently of triangle references", () => {
    expect([
      ...buildGuidePointBounds(new Float32Array([0, 0, 0, 1, 1, 0, -9, 3, 7])),
    ]).toEqual([-9, 0, 0, 1, 3, 7]);
  });

  it("preserves explicit empty bounds rather than fabricating geometry", () => {
    const initial = new Float32Array([4, 3, 2, 1, 0, -1]);
    expect([...buildGuidePointBounds(new Float32Array(), initial)]).toEqual([
      ...initial,
    ]);
  });

  it("rejects malformed browser inputs", () => {
    expect(() => buildGuidePointBounds(new Float32Array(2))).toThrow(
      /dimensions/,
    );
    expect(() =>
      buildGuidePointBounds(new Float32Array([0, Infinity, 0])),
    ).toThrow(/coordinates/);
    expect(() =>
      buildGuidePointBounds(new Float32Array(), new Float32Array(5)),
    ).toThrow(/dimensions/);
    expect(() =>
      buildGuidePointBounds(new Float32Array(), new Float32Array(6).fill(NaN)),
    ).toThrow(/coordinates/);
  });
});

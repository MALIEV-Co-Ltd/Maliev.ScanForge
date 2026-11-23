import { describe, expect, it } from "vitest";
import {
  evaluateNativeSketchLinePoint,
  prepareNativeSketchLineConversion,
} from "../src/sketch-line-conversion";

const bits = (value: number) => {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, "0");
};

describe("native sketch line conversion parameters", () => {
  it("scales the evaluated origin and length, preserving the XYZ direction", () => {
    expect(
      prepareNativeSketchLineConversion([1, 2, 3], [4, 6, 3], 0.001),
    ).toEqual({
      origin: [0.001, 0.002, 0.003],
      direction: [0.6000000000000001, 0.8, 0],
      interval: [0, 0.005],
    });
  });

  it("keeps the second reciprocal normalization, including its rounding change", () => {
    // Binary64 values independently calculated from the recovered instruction
    // order, not a native execution oracle. A single normalization gives
    // ...242a/...363e instead.
    const value = prepareNativeSketchLineConversion(
      [0, 0, 0],
      [0.1, 0.2, 0.3],
      1,
    )!;
    expect(value.direction.map(bits)).toEqual([
      "3fd11acee560242b",
      "3fe11acee560242b",
      "3fe9a83658103640",
    ]);
    expect(value.interval).toEqual([0, 0.37416573867739417]);
  });

  it("admits equality at the conversion threshold before coordinate scaling", () => {
    const value = prepareNativeSketchLineConversion(
      [0, 0, 0],
      [0, 0, 1e-8],
      0.001,
    );
    expect(value).toEqual({
      origin: [0, 0, 0],
      direction: [0, 0, 1],
      interval: [0, 1.0000000000000001e-11],
    });
    expect(
      prepareNativeSketchLineConversion([0, 0, 0], [0, 0, 0.999999e-8], 1e9),
    ).toBeUndefined();
    expect(
      prepareNativeSketchLineConversion([3, 4, 5], [3, 4, 5], 1),
    ).toBeUndefined();
  });

  it("does not substitute scaled endpoint subtraction for the source interval", () => {
    const value = prepareNativeSketchLineConversion(
      [1e16, 0, 0],
      [1e16 + 2, 0, 0],
      0.001,
    )!;
    expect(value.origin).toEqual([1e13, 0, 0]);
    expect(value.direction).toEqual([1, 0, 0]);
    expect(value.interval).toEqual([0, 0.002]);
    expect((1e16 + 2) * 0.001 - 1e16 * 0.001).not.toBe(value.interval[1]);
  });

  it("preserves negative zero in the origin and normalized direction", () => {
    const value = prepareNativeSketchLineConversion(
      [-0, 1, 0],
      [-0, 3, -0],
      0.001,
    )!;
    expect(Object.is(value.origin[0], -0)).toBe(true);
    expect(Object.is(value.direction[2], -0)).toBe(true);
    expect(Object.is(value.interval[0], 0)).toBe(true);
  });

  it("uses all three components and respects reversed evaluated endpoints", () => {
    const value = prepareNativeSketchLineConversion([4, 6, 7], [1, 2, 7], 2)!;
    expect(value).toEqual({
      origin: [8, 12, 14],
      direction: [-0.6000000000000001, -0.8, 0],
      interval: [0, 10],
    });
    expect(
      prepareNativeSketchLineConversion([0, 0, -2], [0, 0, 2], 1)?.interval,
    ).toEqual([0, 4]);
  });

  it("returns detached values and never mutates the supplied endpoints", () => {
    const first = [1, 2, 3],
      last = [4, 6, 3];
    const value = prepareNativeSketchLineConversion(first, last, 1)!;
    Object.assign(value.origin, { 0: 99 });
    Object.assign(value.direction, { 1: 88 });
    expect(first).toEqual([1, 2, 3]);
    expect(last).toEqual([4, 6, 3]);
    first[0] = 77;
    last[1] = 66;
    expect(value.interval).toEqual([0, 5]);
  });

  it("requires an explicit finite positive coordinate scale", () => {
    for (const scale of [undefined, null, "0.001", 0, -0, -1, NaN, Infinity])
      expect(() =>
        prepareNativeSketchLineConversion([0, 0, 0], [1, 0, 0], scale),
      ).toThrow(/scale/i);
  });

  it("rejects malformed endpoints without coercion", () => {
    for (const point of [
      undefined,
      null,
      {},
      [1, 2],
      [1, 2, 3, 4],
      [NaN, 0, 0],
      [Infinity, 0, 0],
      ["1", 0, 0],
      Array(3),
    ]) {
      expect(() =>
        prepareNativeSketchLineConversion(point, [1, 0, 0], 1),
      ).toThrow(/point/i);
      expect(() =>
        prepareNativeSketchLineConversion([0, 0, 0], point, 1),
      ).toThrow(/point/i);
    }
  });

  it("rejects finite-input overflow in differences, squared length, origin and interval", () => {
    for (const [first, last, scale] of [
      [[-1e308, 0, 0], [1e308, 0, 0], 1],
      [[0, 0, 0], [1e200, 0, 0], 1],
      [[1e308, 0, 0], [1e308, 1, 0], 2],
      [[0, 0, 0], [2, 0, 0], 1e308],
    ] as const)
      expect(() =>
        prepareNativeSketchLineConversion(first, last, scale),
      ).toThrow(/overflow/i);
  });

  it("does not invent body success or a new minimum scaled interval", () => {
    const value = prepareNativeSketchLineConversion(
      [0, 0, 0],
      [1e-8, 0, 0],
      Number.MIN_VALUE,
    )!;
    expect(value.interval).toEqual([0, 0]);
    expect(Object.keys(value).sort()).toEqual([
      "direction",
      "interval",
      "origin",
    ]);
  });
});

describe("native converted line point evaluation", () => {
  it("uses all prepared components and permits parameters outside an interval", () => {
    expect(evaluateNativeSketchLinePoint([1, 2, 3], [0.6, 0.8, 0], 5)).toEqual([
      4, 6, 3,
    ]);
    expect(evaluateNativeSketchLinePoint([1, 2, 3], [0.6, 0.8, 0], -5)).toEqual(
      [-2, -2, 3],
    );
  });

  it("performs the arithmetic at zero parameter instead of copying the origin", () => {
    const result = evaluateNativeSketchLinePoint([-0, -0, -0], [1, 0, -0], 0);
    expect(result.map((n) => Object.is(n, -0))).toEqual([false, false, true]);
  });

  it("does not normalize the prepared direction again", () => {
    expect(
      evaluateNativeSketchLinePoint([0, 0, 0], [1.0000000000000002, 0, 0], 2),
    ).toEqual([2.0000000000000004, 0, 0]);
  });

  it("evaluates the converted analytic endpoint rather than scaling the input endpoint", () => {
    const curve = prepareNativeSketchLineConversion(
      [0.1, 0.2, 0.3],
      [0.4, 0.6, 0.8],
      0.001,
    )!;
    expect(
      evaluateNativeSketchLinePoint(
        curve.origin,
        curve.direction,
        curve.interval[1],
      ).map(bits),
    ).toEqual(["3f3a36e2eb1c432f", "3f43a92a30553262", "3f4a36e2eb1c432e"]);
  });

  it("returns detached coordinates without changing origin or direction", () => {
    const origin = [1, 2, 3],
      direction = [0, 0, 1];
    const result = evaluateNativeSketchLinePoint(origin, direction, 0);
    Object.assign(result, { 0: 99 });
    expect(origin).toEqual([1, 2, 3]);
    expect(direction).toEqual([0, 0, 1]);
  });

  it("requires an explicit finite parameter and rejects the unset sentinel", () => {
    for (const value of [
      undefined,
      null,
      "0",
      NaN,
      Infinity,
      -Infinity,
      -31415800000000,
    ]) {
      expect(() =>
        evaluateNativeSketchLinePoint([0, 0, 0], [1, 0, 0], value),
      ).toThrow("Line evaluation requires an explicit finite, set parameter.");
    }
  });

  it("rejects malformed vectors and a zero prepared direction", () => {
    for (const value of [
      undefined,
      null,
      [1, 2],
      [1, 2, 3, 4],
      Array(3),
      [0, NaN, 0],
      [0, Infinity, 0],
      [0, "1", 0],
    ]) {
      expect(() => evaluateNativeSketchLinePoint(value, [1, 0, 0], 0)).toThrow(
        /XYZ/,
      );
      expect(() => evaluateNativeSketchLinePoint([0, 0, 0], value, 0)).toThrow(
        /XYZ/,
      );
    }
    expect(() =>
      evaluateNativeSketchLinePoint([0, 0, 0], [0, -0, 0], 0),
    ).toThrow("Line evaluation requires a nonzero prepared direction.");
  });

  it("rejects finite-input multiplication and addition overflow", () => {
    expect(() =>
      evaluateNativeSketchLinePoint([0, 0, 0], [2, 0, 0], Number.MAX_VALUE),
    ).toThrow(/overflow/);
    expect(() =>
      evaluateNativeSketchLinePoint(
        [Number.MAX_VALUE, 0, 0],
        [1, 0, 0],
        Number.MAX_VALUE,
      ),
    ).toThrow(/overflow/);
  });
});

import { describe, expect, it } from "vitest";
import {
  checkNativeSketchLineInputInterval,
  checkNativeSketchLineParameterOrder,
  projectNativeSketchLinePoint,
} from "../src/sketch-line-projection";
import { prepareNativeSketchLineConversion } from "../src/sketch-line-conversion";

describe("known native nonperiodic line input interval", () => {
  it("requires forward span strictly above the explicit parameter threshold", () => {
    expect(checkNativeSketchLineInputInterval(2, 3, 0.5)).toEqual({
      firstMinusLast: -1,
      separated: true,
      forward: true,
      usable: true,
      nativeRangeStatus: 0,
    });
    expect(checkNativeSketchLineInputInterval(2, 3, 1).usable).toBe(false);
    expect(checkNativeSketchLineInputInterval(2, 3, 2).nativeRangeStatus).toBe(
      3,
    );
    expect(checkNativeSketchLineInputInterval(3, 2, 0.5)).toMatchObject({
      firstMinusLast: 1,
      separated: true,
      forward: false,
      usable: false,
      nativeRangeStatus: 3,
    });
  });
  it("does not invent a minimum span or substitute the later order check", () => {
    expect(
      checkNativeSketchLineInputInterval(0, Number.MIN_VALUE, 0).usable,
    ).toBe(true);
    expect(
      checkNativeSketchLineInputInterval(0, Number.MIN_VALUE, Number.MIN_VALUE)
        .usable,
    ).toBe(false);
    expect(
      checkNativeSketchLineParameterOrder(0, Number.MIN_VALUE, true).ordered,
    ).toBe(true);
    expect(checkNativeSketchLineInputInterval(0, 5e-8, 1e-10).usable).toBe(
      true,
    );
    expect(checkNativeSketchLineInputInterval(0, 5e-8, 1e-6).usable).toBe(
      false,
    );
  });
  it("preserves subtraction and signed zero without epsilon repair", () => {
    const result = checkNativeSketchLineInputInterval(-0, 0, 0);
    expect(Object.is(result.firstMinusLast, -0)).toBe(true);
    expect(result.usable).toBe(false);
    expect(
      checkNativeSketchLineInputInterval(2 ** 52, 2 ** 52 + 1, 0).usable,
    ).toBe(true);
  });
  it("rejects unknown thresholds, unset parameters and reached overflow", () => {
    for (const threshold of [undefined, null, "0", NaN, Infinity, -1])
      expect(() => checkNativeSketchLineInputInterval(0, 1, threshold)).toThrow(
        /threshold/,
      );
    for (const value of [
      undefined,
      null,
      "0",
      NaN,
      Infinity,
      -31415800000000,
    ]) {
      expect(() => checkNativeSketchLineInputInterval(value, 1, 0)).toThrow(
        /parameters/,
      );
      expect(() => checkNativeSketchLineInputInterval(0, value, 0)).toThrow(
        /parameters/,
      );
    }
    expect(() => checkNativeSketchLineInputInterval(-1e308, 1e308, 0)).toThrow(
      /overflow/,
    );
  });
});

describe("native analytic line point projection", () => {
  it("projects in provider coordinates onto the infinite analytic line", () => {
    expect(
      projectNativeSketchLinePoint([7, 2, 3], [1, 2, 3], [1, 0, 0], 0.1, 0),
    ).toEqual({ point: [7, 2, 3], parameter: 6 });
    expect(
      projectNativeSketchLinePoint([-2, 2, 3], [1, 2, 3], [1, 0, 0], 0.1, 0),
    ).toEqual({ point: [-2, 2, 3], parameter: -3 });
  });

  it("accepts tolerance equality and rejects a larger perpendicular residual", () => {
    expect(
      projectNativeSketchLinePoint([4, 3, 4], [0, 0, 0], [1, 0, 0], 5, 0),
    ).toEqual({ point: [4, 0, 0], parameter: 4 });
    expect(
      projectNativeSketchLinePoint(
        [4, 3, 4],
        [0, 0, 0],
        [1, 0, 0],
        4.999999,
        0,
      ),
    ).toBeUndefined();
  });

  it("zeros each residual strictly below the threshold and retains equality", () => {
    for (const axis of [0, 1, 2]) {
      const direction = [0, 0, 0];
      direction[(axis + 1) % 3] = 1;
      const below = [0, 0, 0];
      below[axis] = 0.999;
      const equal = [0, 0, 0];
      equal[axis] = 1;
      expect(
        projectNativeSketchLinePoint(below, [0, 0, 0], direction, 0.1, 1),
      ).toEqual({ point: [0, 0, 0], parameter: 0 });
      expect(
        projectNativeSketchLinePoint(equal, [0, 0, 0], direction, 0.1, 1),
      ).toBeUndefined();
    }
    expect(
      projectNativeSketchLinePoint(
        [0.9, -0.9, 2],
        [0, 0, 0],
        [0, 0, 1],
        0.1,
        1,
      ),
    ).toEqual({ point: [0, 0, 2], parameter: 2 });
  });

  it("uses the supplied direction without another normalization", () => {
    const direction = [1.0000000000000002, 0, 0];
    expect(
      projectNativeSketchLinePoint([1, 0, 0], [0, 0, 0], direction, 1e-12, 0),
    ).toEqual({
      point: [1.0000000000000004, 0, 0],
      parameter: 1.0000000000000002,
    });
    expect(
      projectNativeSketchLinePoint([1, 0, 0], [0, 0, 0], direction, 1e-17, 0),
    ).toBeUndefined();
  });

  it("uses all coordinates and accepts the existing conversion parameters", () => {
    const converted = prepareNativeSketchLineConversion(
      [1, 2, 3],
      [4, 6, 3],
      0.001,
    )!;
    const result = projectNativeSketchLinePoint(
      [0.004, 0.006, 0.003],
      converted.origin,
      converted.direction,
      1e-12,
      1e-18,
    )!;
    expect(result.parameter).toBeCloseTo(0.005, 15);
    expect(result.point[0]).toBeCloseTo(0.004, 15);
    expect(result.point[1]).toBeCloseTo(0.006, 15);
    expect(result.point[2]).toBe(0.003);
    expect(
      projectNativeSketchLinePoint([0, 0, 5], [0, 0, 2], [0, 0, -1], 1e-8, 0),
    ).toEqual({ point: [0, 0, 5], parameter: -3 });
  });

  it("rejects nonpositive effective tolerance even for a point on the line", () => {
    for (const tolerance of [0, -0, -1]) {
      expect(
        projectNativeSketchLinePoint(
          [0, 0, 0],
          [0, 0, 0],
          [1, 0, 0],
          tolerance,
          0,
        ),
      ).toBeUndefined();
    }
  });

  it("retains squared-distance underflow rather than replacing it with hypot", () => {
    expect(
      projectNativeSketchLinePoint(
        [0, 1e-200, 0],
        [0, 0, 0],
        [1, 0, 0],
        1e-210,
        0,
      ),
    ).toEqual({ point: [0, 0, 0], parameter: 0 });
  });

  it("returns detached coordinates and does not mutate any input", () => {
    const point = [2, 3, 0],
      origin = [0, 0, 0],
      direction = [1, 0, 0];
    const result = projectNativeSketchLinePoint(
      point,
      origin,
      direction,
      4,
      0,
    )!;
    Object.assign(result.point, { 0: 99 });
    expect(point).toEqual([2, 3, 0]);
    expect(origin).toEqual([0, 0, 0]);
    expect(direction).toEqual([1, 0, 0]);
  });

  it("rejects missing or malformed settings without substituting session defaults", () => {
    for (const value of [undefined, null, "1", NaN, Infinity]) {
      expect(() =>
        projectNativeSketchLinePoint([0, 0, 0], [0, 0, 0], [1, 0, 0], value, 0),
      ).toThrow(/tolerance/i);
      expect(() =>
        projectNativeSketchLinePoint([0, 0, 0], [0, 0, 0], [1, 0, 0], 1, value),
      ).toThrow(/threshold/i);
    }
    expect(() =>
      projectNativeSketchLinePoint([0, 0, 0], [0, 0, 0], [1, 0, 0], 1, -1),
    ).toThrow(/threshold/i);
  });

  it("rejects malformed vectors and arithmetic overflow", () => {
    expect(() =>
      projectNativeSketchLinePoint([0, 0, 0], [0, 0, 0], [0, 0, 0], 1, 0),
    ).toThrow(/nonzero.*XYZ/i);
    for (const value of [
      undefined,
      [1, 2],
      [1, 2, 3, 4],
      [0, NaN, 0],
      [0, Infinity, 0],
      [0, "1", 0],
      new Array(3),
    ]) {
      for (const slot of [0, 1, 2]) {
        const args: unknown[] = [
          [0, 0, 0],
          [0, 0, 0],
          [1, 0, 0],
        ];
        args[slot] = value;
        expect(() =>
          projectNativeSketchLinePoint(args[0], args[1], args[2], 1, 0),
        ).toThrow(/XYZ/i);
      }
    }
    expect(() =>
      projectNativeSketchLinePoint(
        [Number.MAX_VALUE, 0, 0],
        [-Number.MAX_VALUE, 0, 0],
        [1, 0, 0],
        1,
        0,
      ),
    ).toThrow(/overflow/i);
    expect(() =>
      projectNativeSketchLinePoint([0, 1e200, 0], [0, 0, 0], [1, 0, 0], 1, 0),
    ).toThrow(/overflow/i);
    expect(() =>
      projectNativeSketchLinePoint(
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
        Number.MAX_VALUE,
        0,
      ),
    ).toThrow(/overflow/i);
  });
});

describe("native nonperiodic line parameter order", () => {
  it("accepts strictly increasing forward parameters, including negative values", () => {
    expect(checkNativeSketchLineParameterOrder(-3, -1, true)).toEqual({
      orientedSpan: 2,
      ordered: true,
    });
  });

  it("accepts decreasing parameters for reverse orientation", () => {
    expect(checkNativeSketchLineParameterOrder(4, -2, false)).toEqual({
      orientedSpan: 6,
      ordered: true,
    });
  });

  it("rejects equal parameters and preserves the signed span", () => {
    for (const value of [-3, 0, 2]) {
      expect(
        checkNativeSketchLineParameterOrder(value, value, true).ordered,
      ).toBe(false);
      expect(
        checkNativeSketchLineParameterOrder(value, value, false).ordered,
      ).toBe(false);
    }
    expect(
      Object.is(
        checkNativeSketchLineParameterOrder(0, -0, true).orientedSpan,
        -0,
      ),
    ).toBe(true);
    expect(
      Object.is(
        checkNativeSketchLineParameterOrder(0, 0, false).orientedSpan,
        -0,
      ),
    ).toBe(true);
  });

  it("rejects an endpoint order opposite to the explicit orientation", () => {
    expect(checkNativeSketchLineParameterOrder(2, 1, true)).toEqual({
      orientedSpan: -1,
      ordered: false,
    });
    expect(checkNativeSketchLineParameterOrder(1, 2, false)).toEqual({
      orientedSpan: -1,
      ordered: false,
    });
  });

  it("has no invented minimum span or magnitude-relative tolerance", () => {
    expect(
      checkNativeSketchLineParameterOrder(0, Number.MIN_VALUE, true),
    ).toEqual({ orientedSpan: Number.MIN_VALUE, ordered: true });
    expect(
      checkNativeSketchLineParameterOrder(Number.MIN_VALUE, 0, false),
    ).toEqual({ orientedSpan: Number.MIN_VALUE, ordered: true });
    expect(
      checkNativeSketchLineParameterOrder(2 ** 52, 2 ** 52 + 1, true),
    ).toEqual({ orientedSpan: 1, ordered: true });
  });

  it("requires an explicit boolean orientation", () => {
    for (const value of [undefined, null, 0, 1, "+", "forward", {}, []]) {
      expect(() => checkNativeSketchLineParameterOrder(0, 1, value)).toThrow(
        /orientation/i,
      );
    }
  });

  it("rejects malformed or nonfinite parameters", () => {
    for (const value of [
      undefined,
      null,
      "1",
      NaN,
      Infinity,
      -Infinity,
      {},
      [],
    ]) {
      expect(() => checkNativeSketchLineParameterOrder(value, 1, true)).toThrow(
        "Line order requires finite endpoint parameters.",
      );
      expect(() =>
        checkNativeSketchLineParameterOrder(0, value, false),
      ).toThrow("Line order requires finite endpoint parameters.");
    }
  });

  it("rejects canonical arithmetic overflow", () => {
    expect(() =>
      checkNativeSketchLineParameterOrder(
        -Number.MAX_VALUE,
        Number.MAX_VALUE,
        true,
      ),
    ).toThrow(/overflow/i);
    expect(() =>
      checkNativeSketchLineParameterOrder(
        Number.MAX_VALUE,
        -Number.MAX_VALUE,
        false,
      ),
    ).toThrow(/overflow/i);
  });
});

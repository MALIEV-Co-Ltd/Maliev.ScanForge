import { describe, expect, it } from "vitest";
import {
  checkNativeSketchLineBoundsEnvelope,
  prepareNativeSketchLineVertexBounds,
} from "../src/sketch-line-bounds";

describe("native fresh analytic-line vertex bounds", () => {
  it("bounds the attached vertex coordinates on every axis", () => {
    expect(prepareNativeSketchLineVertexBounds([3, -2, 5], [-1, 8, 4])).toEqual(
      {
        minimum: [-1, -2, 4],
        maximum: [3, 8, 5],
      },
    );
  });

  it("keeps a coincident pair as a point box without admitting a body", () => {
    expect(prepareNativeSketchLineVertexBounds([1, 2, 3], [1, 2, 3])).toEqual({
      minimum: [1, 2, 3],
      maximum: [1, 2, 3],
    });
  });

  it("retains the first coordinate's signed zero on equal comparisons", () => {
    for (const first of [
      [-0, 0, -0],
      [0, -0, 0],
    ]) {
      const last = first.map((n) => (Object.is(n, -0) ? 0 : -0));
      const box = prepareNativeSketchLineVertexBounds(first, last);
      for (let axis = 0; axis < 3; axis++) {
        expect(Object.is(box.minimum[axis], first[axis])).toBe(true);
        expect(Object.is(box.maximum[axis], first[axis])).toBe(true);
      }
    }
  });

  it("has the same ordinary bounds when the two vertices are reversed", () => {
    const first = [-7, 4, -3],
      last = [2, -5, 11];
    expect(prepareNativeSketchLineVertexBounds(first, last)).toEqual(
      prepareNativeSketchLineVertexBounds(last, first),
    );
  });

  it("replaces all bounds when the initial X bound is the unset sentinel", () => {
    expect(
      prepareNativeSketchLineVertexBounds([-31415800000000, 9, -8], [1, 2, 3]),
    ).toEqual({
      minimum: [1, 2, 3],
      maximum: [1, 2, 3],
    });
    // The native empty-box test uses X maximum only, not the other axes.
    expect(
      prepareNativeSketchLineVertexBounds([0, -31415800000000, 9], [1, 2, 3]),
    ).toEqual({
      minimum: [0, -31415800000000, 3],
      maximum: [1, 2, 9],
    });
  });

  it("does not reinterpret a sentinel coordinate added to an initialized box", () => {
    expect(
      prepareNativeSketchLineVertexBounds([1, 2, 3], [-31415800000000, 9, -8]),
    ).toEqual({
      minimum: [-31415800000000, 2, -8],
      maximum: [1, 9, 3],
    });
  });

  it("compares large finite coordinates without length or squared-distance overflow", () => {
    expect(
      prepareNativeSketchLineVertexBounds(
        [Number.MAX_VALUE, 0, -Number.MAX_VALUE],
        [-Number.MAX_VALUE, 1, Number.MAX_VALUE],
      ),
    ).toEqual({
      minimum: [-Number.MAX_VALUE, 0, -Number.MAX_VALUE],
      maximum: [Number.MAX_VALUE, 1, Number.MAX_VALUE],
    });
  });

  it("returns independent bounds without changing either vertex", () => {
    const first = [1, 2, 3],
      last = [4, 5, 6];
    const box = prepareNativeSketchLineVertexBounds(first, last);
    Object.assign(box.minimum, { 0: 88 });
    Object.assign(box.maximum, { 1: 99 });
    expect(first).toEqual([1, 2, 3]);
    expect(last).toEqual([4, 5, 6]);
    expect(box.minimum).toEqual([88, 2, 3]);
    expect(box.maximum).toEqual([4, 99, 6]);
    const reset = prepareNativeSketchLineVertexBounds(
      [-31415800000000, 0, 0],
      last,
    );
    Object.assign(reset.minimum, { 0: 77 });
    expect(reset.maximum).toEqual([4, 5, 6]);
  });

  it("rejects malformed and nonfinite vertex points", () => {
    for (const value of [
      undefined,
      null,
      {},
      new Float64Array(3),
      [],
      [1, 2],
      [1, 2, 3, 4],
      new Array(3),
      [0, "1", 0],
      [0, NaN, 0],
      [0, Infinity, 0],
      [0, -Infinity, 0],
    ]) {
      expect(() =>
        prepareNativeSketchLineVertexBounds(value, [0, 0, 0]),
      ).toThrow("Line bounds require finite XYZ vertex points.");
      expect(() =>
        prepareNativeSketchLineVertexBounds([0, 0, 0], value),
      ).toThrow("Line bounds require finite XYZ vertex points.");
    }
  });
});

describe("native line bounds coordinate envelope", () => {
  it("accepts equality at all six signed half-envelope boundaries", () => {
    expect(
      checkNativeSketchLineBoundsEnvelope(
        { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
        2,
        0,
      ),
    ).toEqual({ halfExtent: 1, inside: true });
  });

  it("accepts relative-tolerance equality and rejects the next larger residual on each side", () => {
    const axes = ["x", "y", "z"];
    for (let axis = 0; axis < 3; axis++) {
      for (const side of ["minimum", "maximum"] as const) {
        const box = { minimum: [0, 0, 0], maximum: [0, 0, 0] };
        const sign = side === "minimum" ? -1 : 1;
        box[side][axis] = sign * (1 + Number.EPSILON);
        expect(
          checkNativeSketchLineBoundsEnvelope(box, 2, Number.EPSILON),
        ).toEqual({ halfExtent: 1, inside: true });
        box[side][axis] = sign * (1 + 2 * Number.EPSILON);
        expect(
          checkNativeSketchLineBoundsEnvelope(box, 2, Number.EPSILON),
        ).toEqual({
          halfExtent: 1,
          inside: false,
          failure: {
            axis: axes[axis],
            side,
            coordinate: box[side][axis],
            relativeDifference: 2 * Number.EPSILON,
          },
        });
      }
    }
  });

  it("uses one minus boundary/value rather than normalizing absolute distance by the boundary", () => {
    const box = { minimum: [-2, 0, 0], maximum: [2, 0, 0] };
    expect(checkNativeSketchLineBoundsEnvelope(box, 2, 0.5)).toEqual({
      halfExtent: 1,
      inside: true,
    });
    expect(checkNativeSketchLineBoundsEnvelope(box, 2, 0.499)).toEqual({
      halfExtent: 1,
      inside: false,
      failure: {
        axis: "x",
        side: "minimum",
        coordinate: -2,
        relativeDifference: 0.5,
      },
    });
  });

  it("reports the first failing coordinate in native interleaved axis order", () => {
    const box = { minimum: [-2, -3, -4], maximum: [5, 6, 7] };
    const expected = [
      ["x", "minimum", -2],
      ["x", "maximum", 5],
      ["y", "minimum", -3],
      ["y", "maximum", 6],
      ["z", "minimum", -4],
      ["z", "maximum", 7],
    ] as const;
    for (const [axis, side, coordinate] of expected) {
      const result = checkNativeSketchLineBoundsEnvelope(box, 2, 0);
      expect(result.inside).toBe(false);
      if (!result.inside)
        expect(result.failure).toMatchObject({ axis, side, coordinate });
      box[side][["x", "y", "z"].indexOf(axis)] = 0;
    }
    expect(checkNativeSketchLineBoundsEnvelope(box, 2, 0).inside).toBe(true);
  });

  it("uses explicit envelope units with the recovered vertex-box calculation", () => {
    const box = prepareNativeSketchLineVertexBounds([-2, 3, 4], [1, -2, -4]);
    expect(checkNativeSketchLineBoundsEnvelope(box, 8, 0)).toEqual({
      halfExtent: 4,
      inside: true,
    });
    expect(checkNativeSketchLineBoundsEnvelope(box, 6, 0).inside).toBe(false);
  });

  it("retains half-envelope underflow and signed-zero boundary equality", () => {
    expect(
      checkNativeSketchLineBoundsEnvelope(
        { minimum: [-0, -0, -0], maximum: [0, 0, 0] },
        Number.MIN_VALUE,
        0,
      ),
    ).toEqual({ halfExtent: 0, inside: true });
    expect(
      checkNativeSketchLineBoundsEnvelope(
        { minimum: [0, 0, 0], maximum: [Number.MIN_VALUE, 0, 0] },
        Number.MIN_VALUE,
        0,
      ),
    ).toEqual({
      halfExtent: 0,
      inside: false,
      failure: {
        axis: "x",
        side: "maximum",
        coordinate: Number.MIN_VALUE,
        relativeDifference: 1,
      },
    });
  });

  it("does not invent an upper restriction on the explicit relative tolerance", () => {
    expect(
      checkNativeSketchLineBoundsEnvelope(
        {
          minimum: [-Number.MAX_VALUE, 0, 0],
          maximum: [Number.MAX_VALUE, 0, 0],
        },
        2,
        1,
      ),
    ).toEqual({ halfExtent: 1, inside: true });
  });

  it("does not overflow by forming an absolute coordinate difference", () => {
    expect(
      checkNativeSketchLineBoundsEnvelope(
        {
          minimum: [-Number.MAX_VALUE, 0, 0],
          maximum: [Number.MAX_VALUE, 0, 0],
        },
        Number.MAX_VALUE,
        0.5,
      ),
    ).toEqual({ halfExtent: Number.MAX_VALUE * 0.5, inside: true });
  });

  it("uses historical session settings only when explicitly supplied", () => {
    const envelope = 1000.0000000000001,
      tolerance = 1.5987211554602254e-14;
    const close = prepareNativeSketchLineVertexBounds(
      [0, 0, 0],
      [500 + 1e-12, 0, 0],
    );
    const far = prepareNativeSketchLineVertexBounds(
      [0, 0, 0],
      [500 + 1e-11, 0, 0],
    );
    expect(
      checkNativeSketchLineBoundsEnvelope(close, envelope, tolerance).inside,
    ).toBe(true);
    expect(
      checkNativeSketchLineBoundsEnvelope(far, envelope, tolerance).inside,
    ).toBe(false);
  });

  it("returns detached diagnostics without modifying the bounds", () => {
    const box = { minimum: [-2, 0, 0], maximum: [2, 0, 0] };
    const result = checkNativeSketchLineBoundsEnvelope(box, 2, 0);
    if (result.inside) throw new Error("Expected outside envelope");
    Object.assign(result.failure, { coordinate: 99 });
    expect(box).toEqual({ minimum: [-2, 0, 0], maximum: [2, 0, 0] });
  });

  it("requires finite explicit settings with a positive envelope and nonnegative relative tolerance", () => {
    const box = { minimum: [0, 0, 0], maximum: [0, 0, 0] };
    for (const value of [undefined, null, "2", 0, -0, -1, NaN, Infinity]) {
      expect(() => checkNativeSketchLineBoundsEnvelope(box, value, 0)).toThrow(
        "Line envelope requires an explicit finite positive coordinate envelope.",
      );
    }
    for (const value of [undefined, null, "0", -1, NaN, Infinity]) {
      expect(() => checkNativeSketchLineBoundsEnvelope(box, 2, value)).toThrow(
        "Line envelope requires an explicit finite nonnegative relative tolerance.",
      );
    }
  });

  it("rejects malformed, nonfinite, extra-field and inverted boxes", () => {
    for (const value of [
      undefined,
      null,
      [],
      {},
      { minimum: [0, 0, 0] },
      { minimum: [0, 0, 0], maximum: [0, 0, 0], extra: 1 },
      { minimum: [0, 0], maximum: [0, 0, 0] },
      { minimum: [0, 0, 0], maximum: [0, Infinity, 0] },
      { minimum: [0, 1, 0], maximum: [0, 0, 0] },
    ]) {
      expect(() => checkNativeSketchLineBoundsEnvelope(value, 2, 0)).toThrow(
        /Line (envelope|bounds)/,
      );
    }
  });
});

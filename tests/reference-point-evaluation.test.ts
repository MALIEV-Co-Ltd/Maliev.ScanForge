import { describe, expect, it } from "vitest";
import {
  evaluateNativeReferencePoint,
  type ResolvedReferencePrimitive,
  type NativeReferencePointState,
} from "../src/reference-point-evaluation";

const prior: NativeReferencePointState = {
  geometry: { kind: "point", position: [9, -0, 7] },
  completionWord: 0x37,
};
const point = (
  x: number,
  y: number,
  z: number,
): ResolvedReferencePrimitive => ({ kind: "point", position: [x, y, z] });
const axis: ResolvedReferencePrimitive = {
  kind: "axis",
  start: [1, 2, 3],
  end: [5, 2, 3],
};
const plane: ResolvedReferencePrimitive = {
  kind: "plane",
  origin: [0, 0, 5],
  normal: [0, 0, 1],
  offset: -5,
};
const unavailable: ResolvedReferencePrimitive = { kind: "unavailable" };

// Analytic examples from the static outcome contract, not native execution fixtures.
describe("native point evaluator state and stored coordinates", () => {
  it("skips both geometry and completion stores when the native guard is false", () => {
    const result = evaluateNativeReferencePoint("center", [axis], prior, false);
    expect(result).toEqual({
      ...prior,
      outcome: "unchanged",
      reason: "evaluation-disabled",
    });
    expect(result.geometry).not.toBe(prior.geometry);
  });
  it("retains stored coordinates but performs the ordinary completion-word store", () => {
    expect(evaluateNativeReferencePoint("stored", [], prior)).toEqual({
      geometry: prior.geometry,
      completionWord: 0x100,
      outcome: "unchanged",
      reason: "stored-coordinates",
    });
  });
  it("uses the first resolved axis midpoint and ignores later inputs", () => {
    expect(
      evaluateNativeReferencePoint("center", [axis, point(99, 99, 99)], prior),
    ).toMatchObject({
      geometry: { position: [3, 2, 3] },
      completionWord: 0x100,
      outcome: "updated",
    });
  });
  it("copies a resolved point or sphere center without losing negative zero", () => {
    expect(
      evaluateNativeReferencePoint("center", [point(-0, 2, 3)], prior).geometry
        .position,
    ).toEqual([-0, 2, 3]);
  });
  it.each([[], [unavailable], [plane]].map((inputs) => ({ inputs })))(
    "writes origin for failed center extraction %#",
    ({ inputs }) => {
      expect(
        evaluateNativeReferencePoint("center", inputs, prior),
      ).toMatchObject({
        geometry: { position: [0, 0, 0] },
        completionWord: 0x100,
        outcome: "origin",
      });
    },
  );
});

describe("point pair branches", () => {
  it("retains cancellation-sensitive sequential plane subtractions", () => {
    const inputs: ResolvedReferencePrimitive[] = [
      { kind: "axis", start: [2 ** 54, 1, 1], end: [2 ** 54 + 4, 1, 1] },
      {
        kind: "plane",
        origin: [2 ** 54, 0, 0],
        normal: [1, 1, 1],
        offset: -(2 ** 54),
      },
    ];
    expect(
      evaluateNativeReferencePoint("pair", inputs, prior).geometry.position,
    ).toEqual([2 ** 54 - 2, 1, 1]);
  });

  it.each([
    { x: 0.9998476951563913 - Number.EPSILON, outcome: "updated" },
    { x: 0.9998476951563913, outcome: "updated" },
    { x: 0.9998476951563913 + Number.EPSILON, outcome: "fallback" },
  ])(
    "uses the inclusive cosine boundary for axis pairs ($x)",
    ({ x, outcome }) => {
      const y = Math.sqrt(1 - x * x);
      expect(Math.sqrt(x * x + y * y)).toBe(1);
      const inputs: ResolvedReferencePrimitive[] = [
        { kind: "axis", start: [0, 0, 0], end: [1, 0, 0] },
        { kind: "axis", start: [0, 0, 2], end: [x, y, 2] },
      ];
      expect(evaluateNativeReferencePoint("pair", inputs, prior).outcome).toBe(
        outcome,
      );
    },
  );

  it("uses the first two sources and writes their midpoint", () => {
    expect(
      evaluateNativeReferencePoint(
        "pair",
        [point(2, 4, 6), point(4, 8, 12), point(100, 100, 100)],
        prior,
      ).geometry.position,
    ).toEqual([3, 6, 9]);
  });
  it.each([false, true])(
    "projects onto a non-unit axis in either order (%s)",
    (reverse) => {
      const inputs = [point(9, 6, 7), axis];
      expect(
        evaluateNativeReferencePoint(
          "pair",
          reverse ? inputs.reverse() : inputs,
          prior,
        ).geometry.position,
      ).toEqual([9, 2, 3]);
    },
  );
  it.each([false, true])(
    "uses stored plane equation without dividing by normal squared (%s)",
    (reverse) => {
      const inputs: ResolvedReferencePrimitive[] = [
        point(1, 2, 4),
        { kind: "plane", origin: [0, 0, 999], normal: [0, 0, 2], offset: -6 },
      ];
      expect(
        evaluateNativeReferencePoint(
          "pair",
          reverse ? inputs.reverse() : inputs,
          prior,
        ).geometry.position,
      ).toEqual([1, 2, 0]);
    },
  );
  it.each([false, true])(
    "intersects axis with the plane origin/normal, not its offset (%s)",
    (reverse) => {
      const inputs: ResolvedReferencePrimitive[] = [
        { kind: "axis", start: [1, 2, 0], end: [1, 2, 10] },
        { ...plane, offset: -999 } as ResolvedReferencePrimitive,
      ];
      expect(
        evaluateNativeReferencePoint(
          "pair",
          reverse ? inputs.reverse() : inputs,
          prior,
        ).geometry.position,
      ).toEqual([1, 2, 5]);
    },
  );
  it.each([false, true])(
    "retains geometry and completion word for a parallel axis/plane (%s)",
    (reverse) => {
      const inputs = [axis, plane];
      expect(
        evaluateNativeReferencePoint(
          "pair",
          reverse ? inputs.reverse() : inputs,
          prior,
        ),
      ).toEqual({
        ...prior,
        outcome: "unchanged",
        reason: "axis-plane-nearly-parallel",
      });
    },
  );
  it("admits only strict greater-than at the axis/plane angular threshold", () => {
    const vertical: ResolvedReferencePrimitive = {
      kind: "axis",
      start: [0, 0, 0],
      end: [0, 0, 1],
    };
    const makePlane = (z: number): ResolvedReferencePrimitive => ({
      kind: "plane",
      origin: [0, 0, 5],
      normal: [0, 0, z],
      offset: -5 * z,
    });
    expect(
      evaluateNativeReferencePoint("pair", [vertical, makePlane(0.01)], prior)
        .outcome,
    ).toBe("unchanged");
    expect(
      evaluateNativeReferencePoint(
        "pair",
        [vertical, makePlane(0.01 + Number.EPSILON)],
        prior,
      ).outcome,
    ).toBe("updated");
  });
  it("returns midpoint of distinct closest points on skew axes", () => {
    const a: ResolvedReferencePrimitive = {
      kind: "axis",
      start: [0, 0, 0],
      end: [2, 0, 0],
    };
    const b: ResolvedReferencePrimitive = {
      kind: "axis",
      start: [1, 3, 2],
      end: [1, 5, 2],
    };
    expect(evaluateNativeReferencePoint("pair", [a, b], prior)).toMatchObject({
      geometry: { position: [1, 0, 1] },
      outcome: "updated",
      completionWord: 0x100,
    });
  });
  it("falls back to midpoint of segment midpoints for parallel axes", () => {
    const b: ResolvedReferencePrimitive = {
      kind: "axis",
      start: [7, 4, 9],
      end: [3, 4, 9],
    };
    expect(
      evaluateNativeReferencePoint("pair", [axis, b], prior),
    ).toMatchObject({
      geometry: { position: [4, 3, 6] },
      outcome: "fallback",
      reason: "axis-midpoints",
      completionWord: 0x100,
    });
  });
  it("uses midpoint fallback when closest-line determinant is too small", () => {
    const a: ResolvedReferencePrimitive = {
      kind: "axis",
      start: [0, 0, 0],
      end: [1e-4, 0, 0],
    };
    const b: ResolvedReferencePrimitive = {
      kind: "axis",
      start: [0, 0, 2],
      end: [0, 1e-4, 2],
    };
    expect(evaluateNativeReferencePoint("pair", [a, b], prior)).toMatchObject({
      geometry: { position: [0.000025, 0.000025, 1] },
      outcome: "fallback",
    });
  });
  it.each(
    [[], [axis], [plane, plane], [unavailable, axis]].map((inputs) => ({
      inputs,
    })),
  )("writes origin for unextractable pairs %#", ({ inputs }) => {
    expect(evaluateNativeReferencePoint("pair", inputs, prior)).toMatchObject({
      geometry: { position: [0, 0, 0] },
      outcome: "origin",
      completionWord: 0x100,
    });
  });
});

describe("three-plane point branch", () => {
  const planes: ResolvedReferencePrimitive[] = [
    { kind: "plane", origin: [2, 0, 0], normal: [1, 0, 0], offset: -2 },
    { kind: "plane", origin: [0, 3, 0], normal: [0, 1, 0], offset: -3 },
    { kind: "plane", origin: [0, 0, 4], normal: [0, 0, 1], offset: -4 },
  ];
  it("intersects the first plane equations then the third plane origin", () => {
    expect(
      evaluateNativeReferencePoint("threePlanes", planes, prior),
    ).toMatchObject({
      geometry: { position: [2, 3, 4] },
      outcome: "updated",
      completionWord: 0x100,
    });
  });
  it.each(
    [
      planes.slice(0, 2),
      [...planes, planes[0]],
      [planes[0], planes[0], planes[2]],
      [planes[0], planes[1], planes[0]],
      [planes[0], unavailable, planes[2]],
    ].map((inputs) => ({ inputs })),
  )(
    "writes origin and completion when the three-plane branch fails %#",
    ({ inputs }) => {
      expect(
        evaluateNativeReferencePoint("threePlanes", inputs, prior),
      ).toMatchObject({
        geometry: { position: [0, 0, 0] },
        outcome: "origin",
        completionWord: 0x100,
      });
    },
  );
  it("does not mutate input geometry or prior state", () => {
    const before = structuredClone({ planes, prior });
    evaluateNativeReferencePoint("threePlanes", planes, prior);
    expect({ planes, prior }).toEqual(before);
  });
  it("uses third-plane origin even when the stored offset differs", () => {
    const third: ResolvedReferencePrimitive = {
      kind: "plane",
      origin: [0, 0, 4],
      normal: [0, 0, 1],
      offset: -999,
    };
    expect(
      evaluateNativeReferencePoint(
        "threePlanes",
        [planes[0], planes[1], third],
        prior,
      ).geometry.position,
    ).toEqual([2, 3, 4]);
  });
  it("writes origin and completion at third-plane angular threshold equality", () => {
    const third: ResolvedReferencePrimitive = {
      kind: "plane",
      origin: [0, 0, 4],
      normal: [0, 0, 0.01],
      offset: -0.04,
    };
    expect(
      evaluateNativeReferencePoint(
        "threePlanes",
        [planes[0], planes[1], third],
        prior,
      ),
    ).toEqual({
      geometry: { kind: "point", position: [0, 0, 0] },
      completionWord: 0x100,
      outcome: "origin",
      reason: "three-plane-intersection-failed",
    });
  });
});

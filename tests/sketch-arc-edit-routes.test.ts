import { describe, expect, it } from "vitest";
import {
  prepareNativeSketchArcRebuild,
  prepareNativeSketchArcTransform,
  prepareNativeSketchArcCollectionRebuild,
} from "../src/sketch-arc-rebuild";

const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
const identity = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
];
const points = [
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
];
const initial = () =>
  prepareNativeSketchArcRebuild(
    points,
    frame,
    { radius: undefined, closed: false, sourceRecords: [] },
    false,
  );

describe("native arc local transform and collection rebuild", () => {
  it("transforms internal local points and refits while preserving stored placement", () => {
    const prior = initial(),
      matrix = [
        [1, 0, 0, 3],
        [0, 1, 0, 4],
        [0, 0, 1, 100],
      ];
    const result = prepareNativeSketchArcTransform(matrix, prior);
    expect(result.points).toEqual([
      [4, 4, 0],
      [3, 5, 0],
      [2, 4, 0],
    ]);
    expect(result.center).toEqual([3, 4, 0]);
    expect(result.frame).toEqual(frame);
    expect(result.radius).toBe(1);
    expect(result.fitSucceeded).toBe(true);
    matrix[0][3] = 99;
    expect(result.frame).not.toBe(prior.frame);
    expect(prior).toEqual(initial());
  });

  it("refits a circle through nonuniformly transformed points rather than converting it into an ellipse", () => {
    const result = prepareNativeSketchArcTransform(
      [
        [2, 0, 0, 0],
        [0, 3, 0, 0],
        [0, 0, 1, 0],
      ],
      initial(),
    );
    expect(result.points).toEqual([
      [2, 0, 0],
      [0, 3, 0],
      [-2, 0, 0],
    ]);
    expect(result.center[0]).toBe(0);
    expect(result.center[1]).toBeCloseTo(5 / 6, 14);
    expect(result.radius).toBeCloseTo(13 / 6, 14);
    expect(result.backendRequest?.kind).toBe("arc");
  });

  it("retains the prior radius/backend request omission when transform plus flattening collapses the fit", () => {
    const result = prepareNativeSketchArcTransform(
      [
        [1, 0, 0, 0],
        [0, 0, -1, 0],
        [0, 1, 0, 0],
      ],
      initial(),
    );
    expect(result.points).toEqual([
      [1, 0, 0],
      [0, 0, 0],
      [-1, 0, 0],
    ]);
    expect(result.fitSucceeded).toBe(false);
    expect(result.radius).toBe(1);
    expect(result.backendRequest).toBeUndefined();
  });

  it("reads internal endpoints after closure instead of old retained source endpoints", () => {
    const prior = prepareNativeSketchArcRebuild(
      points,
      frame,
      { radius: 1, closed: false, sourceRecords: [] },
      true,
    );
    const result = prepareNativeSketchArcTransform(identity, prior);
    expect(result.sourceRecords[0]).toEqual([-1, 0, 0]);
    expect(result.closed).toBe(true);
    expect(result.fitSucceeded).toBe(false);
  });

  it("passes existing closure into successful transformed refits", () => {
    const result = prepareNativeSketchArcTransform(
      [
        [1, 0, 0, 3],
        [0, 1, 0, 4],
        [0, 0, 1, 0],
      ],
      { ...initial(), closed: true },
    );
    expect(result.closed).toBe(true);
    expect(result.sourceRecords[0]).toEqual([4, 4, 0]);
    expect(result.points[0]).toEqual([2, 4, 0]);
    expect(result.fitSucceeded).toBe(true);
  });

  it("retains forward multiplication order before the builder flattens Z", () => {
    const prior = {
      ...initial(),
      points: [
        [1e16, 1, -1e16],
        [0, 1, 0],
        [-1, 0, 0],
      ] as const,
    };
    const result = prepareNativeSketchArcTransform(
      [
        [1, 1, 1, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
      ],
      prior,
    );
    expect(result.sourceRecords[0][0]).toBe(0);
    expect(1e16 + -1e16 + 1).toBe(1);
  });

  it("always refits the first three collection records, including near replacements with a fourth point", () => {
    const input = [
      [1, 0, 9],
      [0.001, 1, 9],
      [-1, 0, 9],
      [999, 999, 999],
    ];
    const result = prepareNativeSketchArcCollectionRebuild(input, initial());
    expect(result.fitSucceeded).toBe(true);
    expect(result.points[1]).toEqual([0.001, 1, 0]);
    expect(result.sourceRecords[3]).not.toEqual(input[3]);
    expect(result.frame).toEqual(frame);
    input[1][0] = 99;
    expect(result.points[1][0]).toBe(0.001);
  });

  it("carries closure through collection rebuilding instead of clearing it like replacement", () => {
    const result = prepareNativeSketchArcCollectionRebuild(
      [...points, [9, 9, 9]],
      { ...initial(), closed: true },
    );
    expect(result.closed).toBe(true);
    expect(result.sourceRecords[0]).toEqual([1, 0, 0]);
    expect(result.points[0]).toEqual([-1, 0, 0]);
    expect(result.backendRequest?.points[0]).toEqual([-1, 0, 0]);
  });

  it("retains early-failure radius and fourth source state when rebuilding a collection", () => {
    const prior = initial();
    const result = prepareNativeSketchArcCollectionRebuild(
      [
        [0, 0, 9],
        [1, 0, 9],
        [3, 0, 9],
        [99, 99, 99],
      ],
      prior,
    );
    expect(result.fitSucceeded).toBe(false);
    expect(result.radius).toBe(1);
    expect(result.center).toEqual([1, 0, 0]);
    expect(result.sourceRecords[3]).toEqual(prior.sourceRecords[3]);
    expect(result.backendRequest).toBeUndefined();
  });

  it("does not invent radius on unsuccessful transform or collection rebuilding", () => {
    const prior = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
      ],
      frame,
      { radius: undefined, closed: false, sourceRecords: [] },
      false,
    );
    expect(
      prepareNativeSketchArcTransform(identity, prior).radius,
    ).toBeUndefined();
    expect(
      prepareNativeSketchArcCollectionRebuild(prior.points, prior).radius,
    ).toBeUndefined();
  });

  it("rejects malformed/nonfinite transform and overflow before changing previous state", () => {
    const prior = initial(),
      before = structuredClone(prior);
    for (const bad of [
      null,
      [],
      [[1]],
      [[NaN, 0, 0, 0], identity[1], identity[2]],
      [[Number.MAX_VALUE, 0, 0, Number.MAX_VALUE], identity[1], identity[2]],
    ])
      expect(() => prepareNativeSketchArcTransform(bad, prior)).toThrow();
    expect(prior).toEqual(before);
  });

  it("rejects short, sparse, nonfinite or excessive collections without changing previous state", () => {
    const prior = initial(),
      before = structuredClone(prior);
    for (const bad of [
      null,
      [],
      points.slice(0, 2),
      new Array(3),
      [...points, [NaN, 0, 0]],
      new Array(32769).fill([0, 0, 0]),
    ])
      expect(() =>
        prepareNativeSketchArcCollectionRebuild(bad, prior),
      ).toThrow();
    expect(prior).toEqual(before);
  });
});

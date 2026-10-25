import { describe, expect, it } from "vitest";
import {
  prepareNativeSketchArcRebuild,
  prepareNativeSketchArcPlacedReplacement,
  prepareNativeSketchArcPointEdit,
} from "../src/sketch-arc-rebuild";

const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
const points = [
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
];
const initial = (closed = false) =>
  prepareNativeSketchArcRebuild(
    points,
    frame,
    { radius: undefined, closed: false, sourceRecords: [] },
    closed,
  );

describe("native arc individual point edit", () => {
  it.each([0, 1, 2])(
    "refits defining point %i and preserves the other internal points",
    (index) => {
      const prior = initial(),
        target = [...points[index]];
      target[1] += 0.25;
      target[2] = 9;
      const result = prepareNativeSketchArcPointEdit(index, target, prior);
      expect(result.route).toBe("refit");
      const expected = structuredClone(points);
      expected[index] = [target[0], target[1], 0];
      expect(result.preparation.points).toEqual(expected);
      expect(result.preparation.fitSucceeded).toBe(true);
      expect(result.preparation.frame).toEqual(frame);
      target[0] = 99;
      expect(prior).toEqual(initial());
    },
  );

  it("moves the center and all defining points in local XY, ignoring requested Z", () => {
    const result = prepareNativeSketchArcPointEdit(3, [4, 5, 99], initial());
    expect(result.route).toBe("translate");
    expect(result.preparation.points).toEqual([
      [5, 5, 0],
      [4, 6, 0],
      [3, 5, 0],
    ]);
    expect(result.preparation.center).toEqual([4, 5, 0]);
    expect(result.preparation.sourceRecords).toEqual([
      [5, 5, 0],
      [4, 6, 0],
      [3, 5, 0],
      [4, 5, 0],
    ]);
    expect(result.preparation.radius).toBe(1);
    expect(result.preparation.fitSucceeded).toBeUndefined();
    expect(result.preparation.backendRequest?.points).toEqual(
      result.preparation.points,
    );
  });

  it("preserves existing nonzero Z on center movement, while defining-point edits flatten it", () => {
    const moved = prepareNativeSketchArcPlacedReplacement(
      [
        [11, 20, 30],
        [10, 21, 30],
        [9, 20, 30],
        [14, 25, 37],
      ],
      frame,
      initial(),
    ).preparation;
    const result = prepareNativeSketchArcPointEdit(3, [8, 9, -500], moved);
    expect(result.preparation.center).toEqual([8, 9, 7]);
    expect(result.preparation.points.map((p) => p[2])).toEqual([7, 7, 7]);
    const refit = prepareNativeSketchArcPointEdit(1, [4, 6.25, 123], moved);
    expect(refit.route).toBe("refit");
    expect(refit.preparation.points.map((p) => p[2])).toEqual([0, 0, 0]);
    expect(refit.preparation.center[2]).toBe(0);
  });

  it("carries closure through a defining-point refit, preserving the distinct retained source endpoint", () => {
    const prior = initial(true);
    const result = prepareNativeSketchArcPointEdit(0, [2, 0, 99], prior);
    expect(result.preparation.closed).toBe(true);
    expect(result.preparation.points[0]).toEqual([-1, 0, 0]);
    expect(result.preparation.sourceRecords[0]).toEqual([2, 0, 0]);
    expect(result.preparation.backendRequest?.points[0]).toEqual([-1, 0, 0]);
    expect(prior).toEqual(initial(true));
  });

  it("preserves closure on center translation instead of using replacement's clear rule", () => {
    const result = prepareNativeSketchArcPointEdit(3, [4, 5, 9], initial(true));
    expect(result.preparation.closed).toBe(true);
    expect(result.preparation.points[0]).toEqual([3, 5, 0]);
    expect(result.preparation.points[2]).toEqual([3, 5, 0]);
    expect(result.preparation.sourceRecords[0]).toEqual([3, 5, 0]);
    expect(result.preparation.fitSucceeded).toBeUndefined();
  });

  it("uses internal points rather than retained source points after closure", () => {
    const result = prepareNativeSketchArcPointEdit(1, [0, 2, 0], initial(true));
    expect(result.preparation.sourceRecords[0]).toEqual([-1, 0, 0]);
    expect(result.preparation.fitSucceeded).toBe(false);
    expect(result.preparation.backendRequest).toBeUndefined();
    expect(result.preparation.closed).toBe(true);
  });

  it("preserves early-failure radius and the previous fourth source record during defining-point edits", () => {
    const prior = initial();
    const result = prepareNativeSketchArcPointEdit(1, [0, 0, 9], prior);
    expect(result.preparation.fitSucceeded).toBe(false);
    expect(result.preparation.radius).toBe(1);
    expect(result.preparation.backendRequest).toBeUndefined();
    expect(result.preparation.sourceRecords[3]).toEqual(prior.sourceRecords[3]);
  });

  it("regenerates a stale fourth record and issues a backend request when moving a failed arc's center", () => {
    const prior = initial();
    const failed = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
      ],
      frame,
      {
        radius: prior.radius,
        closed: prior.closed,
        sourceRecords: prior.sourceRecords,
      },
      false,
    );
    const result = prepareNativeSketchArcPointEdit(3, [5, 6, 0], failed);
    expect(result.preparation.sourceRecords[3]).toEqual([5, 6, 0]);
    expect(result.preparation.points).toEqual([
      [4, 6, 0],
      [5, 6, 0],
      [7, 6, 0],
    ]);
    expect(result.preparation.backendRequest).toBeDefined();
    expect(result.preparation.radius).toBe(1);
  });

  it("preserves unknown radius and literal +0 additions on untranslated Z", () => {
    const prior = {
      ...initial(),
      radius: undefined,
      center: [0, 0, -0] as const,
      points: [
        [1, 0, -0],
        [0, 1, -0],
        [-1, 0, -0],
      ] as const,
    };
    const result = prepareNativeSketchArcPointEdit(3, [0, 0, 99], prior);
    expect(result.preparation.radius).toBeUndefined();
    expect(result.preparation.center[2]).toBe(0);
    expect(result.preparation.points[0][2]).toBe(0);
    expect(Object.is(prior.center[2], -0)).toBe(true);
  });

  it("applies an XY delta rather than directly overwriting the old center", () => {
    const prior = {
      ...initial(),
      radius: 2,
      center: [1e16, 0, 0] as const,
      points: [
        [1e16 + 2, 0, 0],
        [1e16, 2, 0],
        [1e16 - 2, 0, 0],
      ] as const,
    };
    const result = prepareNativeSketchArcPointEdit(3, [1, 0, 0], prior);
    expect(result.preparation.center).toEqual([0, 0, 0]);
    expect(result.preparation.points).toEqual([
      [2, 0, 0],
      [0, 2, 0],
      [-2, 0, 0],
    ]);
  });

  it("rejects invalid indices, malformed points and overflow without changing prior state", () => {
    const prior = initial(),
      before = structuredClone(prior);
    for (const index of [-1, 4, 1.5, NaN, Infinity, "1", undefined])
      expect(() =>
        prepareNativeSketchArcPointEdit(index, [0, 0, 0], prior),
      ).toThrow();
    for (const point of [null, [], [1, 2], [1, 2, NaN], new Array(3)])
      expect(() => prepareNativeSketchArcPointEdit(3, point, prior)).toThrow();
    expect(() =>
      prepareNativeSketchArcPointEdit(3, [Number.MAX_VALUE, 0, 0], {
        ...prior,
        center: [-Number.MAX_VALUE, 0, 0],
      }),
    ).toThrow();
    expect(prior).toEqual(before);
  });
});

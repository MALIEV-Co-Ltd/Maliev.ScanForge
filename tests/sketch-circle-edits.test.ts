import { describe, expect, it } from "vitest";
import {
  prepareNativeSketchCircleRebuild as rebuild,
  prepareNativeSketchCirclePointEdit as edit,
  prepareNativeSketchCircleTransform as transform,
} from "../src/sketch-circle-rebuild";

const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
const points = [
  [1, 0, 9],
  [0, 1, 8],
  [-1, 0, 7],
];
const initial = () => rebuild(points, frame);

describe("native circle child edits", () => {
  it.each([0, 1, 2])("refits defining point %s and flattens Z", (index) => {
    const prior = initial();
    const replacement = [2, 3, 50];
    const expected = points.map((p, i) => (i === index ? replacement : p));
    expect(edit(index, replacement, prior)).toEqual(rebuild(expected, frame));
    expect(prior).toEqual(initial());
  });

  it("translates center XY, preserves radius and reports no fit", () => {
    const prior = initial();
    const moved = edit(3, [5, 6, 900], prior);
    expect(moved.backendRequest).toEqual({
      kind: "circle",
      center: [5, 6, 0],
      radius: 1,
    });
    expect(moved.sourceRecords).toEqual([
      [6, 6, 0],
      [5, 7, 0],
      [4, 6, 0],
      [5, 6, 0],
    ]);
    expect(moved.fitSucceeded).toBeUndefined();
    expect(moved.frame).toEqual(frame);
    expect(moved.frame).not.toBe(prior.frame);
    expect(prior).toEqual(initial());
  });

  it("preserves a failed fit radius during center translation", () => {
    const prior = rebuild(
      [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
      ],
      frame,
    );
    const moved = edit(3, [7, 8, 42], prior);
    expect(moved.backendRequest.radius).toBe(-Number.MAX_VALUE);
    expect(moved.backendRequest.center).toEqual([7, 8, 0]);
    expect(moved.sourceRecords.slice(0, 3)).toEqual([
      [6, 8, 0],
      [7, 8, 0],
      [9, 8, 0],
    ]);
    expect(moved.fitSucceeded).toBeUndefined();
  });

  it("adds the computed delta rather than assigning the requested center", () => {
    const prior = initial();
    const center = [1e16, 0, -0] as const;
    const staged = {
      ...prior,
      sourceRecords: [
        prior.sourceRecords[0],
        prior.sourceRecords[1],
        prior.sourceRecords[2],
        center,
      ] as typeof prior.sourceRecords,
      backendRequest: { ...prior.backendRequest, center },
    };
    const moved = edit(3, [1, 0, 99], staged);
    expect(moved.backendRequest.center[0]).toBe(0);
    expect(Object.is(moved.backendRequest.center[2], 0)).toBe(true);
  });

  it("transforms local points then refits while retaining owner placement", () => {
    const moved = transform(
      [
        [1, 0, 0, 5],
        [0, 1, 0, 6],
        [0, 0, 1, 90],
      ],
      initial(),
    );
    expect(moved.backendRequest).toEqual({
      kind: "circle",
      center: [5, 6, 0],
      radius: 1,
    });
    expect(moved.frame).toEqual(frame);
    expect(moved.sourceRecords.every((p) => p[2] === 0)).toBe(true);
  });

  it("refits a circle through scaled points instead of producing an ellipse", () => {
    const moved = transform(
      [
        [2, 0, 0, 0],
        [0, 3, 0, 0],
        [0, 0, 1, 0],
      ],
      initial(),
    );
    expect(moved.backendRequest.center[1]).toBeCloseTo(5 / 6, 14);
    expect(moved.backendRequest.radius).toBeCloseTo(13 / 6, 14);
  });

  it("emits the failed-fit backend request when transformed Z flattening collapses the points", () => {
    const moved = transform(
      [
        [1, 0, 0, 0],
        [0, 0, -1, 0],
        [0, 1, 0, 0],
      ],
      initial(),
    );
    expect(moved.fitSucceeded).toBe(false);
    expect(moved.backendRequest.radius).toBe(-Number.MAX_VALUE);
    expect(moved.backendRequest.center).toEqual([0, 0, 0]);
  });

  it("preserves forward X/Y/Z/translation accumulation", () => {
    const moved = transform(
      [
        [1e16, -1e16, 1, 1],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
      ],
      rebuild(
        [
          [1, 1, 0],
          [0, 1, 0],
          [-1, 0, 0],
        ],
        frame,
      ),
    );
    expect(moved.sourceRecords[0][0]).toBe(1);
  });

  it("rejects malformed, nonfinite and overflowing input without mutating prior state", () => {
    const prior = initial();
    for (const index of [-1, 4, 0.5, NaN, "0", undefined])
      expect(() => edit(index, [0, 0, 0], prior)).toThrow();
    for (const point of [[0, 0], [0, 0, NaN], [0, 0, Infinity], null])
      expect(() => edit(3, point, prior)).toThrow();
    for (const matrix of [
      [],
      null,
      [[Infinity, 0, 0, 0], ...frame.slice(1)],
      [[Number.MAX_VALUE, 0, 0, Number.MAX_VALUE], ...frame.slice(1)],
    ])
      expect(() => transform(matrix, prior)).toThrow();
    expect(prior).toEqual(initial());
  });
});

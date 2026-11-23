import { expect, it } from "vitest";
import {
  prepareNativeSketchLineCollectionRebuild as collection,
  prepareNativeSketchLineLocalReplacement as local,
  prepareNativeSketchLinePlacedReplacement as placed,
  completeNativeSketchLineRebuild as complete,
  type NativeSketchLineState,
} from "../src/sketch-line-rebuild";
const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
const initial = (): NativeSketchLineState => ({
  frame: [
    [1, 0, 0, 10],
    [0, 1, 0, 20],
    [0, 0, 1, 30],
  ],
  start: [0, 0, 0],
  middle: [1, 0, 0],
  end: [2, 0, 0],
  sourceRecords: [
    [0, 0, 0],
    [2, 0, 0],
  ],
});
it("collection rebuilding uses the first two records and flattens their Z", () => {
  const p = collection(
    [
      [1, 2, 30],
      [5, 6, 40],
      [100, 200, 300],
    ],
    initial(),
  );
  expect(p.backendRequest).toEqual({
    kind: "line",
    points: [
      [1, 2, 0],
      [5, 6, 0],
    ],
  });
  expect(p.state.middle).toEqual([3, 4, 0]);
  expect(p.state.sourceRecords).toEqual(initial().sourceRecords);
});
it("collection coincidence admission uses length >= Number.EPSILON", () => {
  const prior = initial();
  for (const length of [0, Number.EPSILON / 2]) {
    const p = collection(
      [
        [0, 0, 5],
        [length, 0, 9],
      ],
      prior,
    );
    expect(p.backendRequest).toBeUndefined();
    expect(p.state).toEqual(prior);
    expect(p.state).not.toBe(prior);
  }
  expect(
    collection(
      [
        [0, 0, 5],
        [Number.EPSILON, 0, 9],
      ],
      prior,
    ).backendRequest,
  ).toBeDefined();
});
it("local replacement uses first/last XYZ without the collection coincidence gate", () => {
  const p = local(
    [
      [1, 2, 3],
      [100, 200, 300],
      [5, 6, 7],
    ],
    initial(),
  );
  expect(p.backendRequest?.points).toEqual([
    [1, 2, 3],
    [5, 6, 7],
  ]);
  expect(p.state.middle).toEqual([3, 4, 5]);
  expect(local([[1, 2, 3]], initial()).backendRequest?.points).toEqual([
    [1, 2, 3],
    [1, 2, 3],
  ]);
});
it("failed backend preserves prior source records while retaining proposed fields", () => {
  const p = local(
    [
      [1, 2, 3],
      [5, 6, 7],
    ],
    initial(),
  );
  const result = complete(p, false);
  expect(result.builderSucceeded).toBe(false);
  expect(result.state.start).toEqual([1, 2, 3]);
  expect(result.state.end).toEqual([5, 6, 7]);
  expect(result.state.middle).toEqual([3, 4, 5]);
  expect(result.state.sourceRecords).toEqual(initial().sourceRecords);
});
it("successful backend supplies middle XY, flattens fields and replaces two child records", () => {
  const p = local(
    [
      [1, 2, 3],
      [5, 6, 7],
    ],
    initial(),
  );
  const result = complete(p, true, [9, 10, 11]);
  expect(result.builderSucceeded).toBe(true);
  expect(result.state.start).toEqual([1, 2, 0]);
  expect(result.state.end).toEqual([5, 6, 0]);
  expect(result.state.middle).toEqual([9, 10, 0]);
  expect(result.state.sourceRecords).toEqual([
    [1, 2, 0],
    [5, 6, 0],
  ]);
  expect(p.state.sourceRecords).toEqual(initial().sourceRecords);
  expect(p.backendRequest?.points).toEqual([
    [1, 2, 3],
    [5, 6, 7],
  ]);
});
it("a rejected collection request cannot be reported as a completed backend build", () => {
  const p = collection(
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
    initial(),
  );
  expect(complete(p, false).state).toEqual(initial());
  expect(() => complete(p, true, [0, 0, 0])).toThrow();
  expect(() => complete(local([[1, 2, 3]], initial()), true)).toThrow();
});
it("placed replacement adopts the supplied frame before backend outcome and preserves inverse XYZ", () => {
  const supplied = [
    [0, -1, 0, 5],
    [1, 0, 0, 6],
    [0, 0, 1, 7],
  ];
  const prior = initial(),
    p = placed(
      [
        [4, 8, 10],
        [1, 1, 1],
        [2, 10, 12],
      ],
      supplied,
      prior,
    );
  expect(p.backendRequest?.points).toEqual([
    [2, 1, 3],
    [4, 3, 5],
  ]);
  expect(p.state.middle).toEqual([3, 2, 4]);
  expect(p.state.frame).toEqual(supplied);
  expect(complete(p, false).state.frame).toEqual(supplied);
  expect(complete(p, false).state.sourceRecords).toEqual(prior.sourceRecords);
  expect(prior).toEqual(initial());
});
it("retains transpose arithmetic for raw frames and distinct midpoint additions", () => {
  const supplied = [
    [2, 0, 0, 0],
    [0, 3, 0, 0],
    [0, 0, 4, 0],
  ];
  expect(
    placed(
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      supplied,
      initial(),
    ).backendRequest?.points,
  ).toEqual([
    [2, 6, 12],
    [8, 15, 24],
  ]);
  const p = local(
    [
      [-0, -0, -0],
      [-0, -0, -0],
    ],
    initial(),
  );
  expect(p.state.middle).toEqual([-0, -0, -0]);
  expect(complete(p, true, [-0, -0, -0]).state.middle).toEqual([-0, -0, 0]);
});
it("rejects malformed inputs and arithmetic overflow without changing previous state", () => {
  const prior = initial();
  for (const records of [
    [],
    [[1, 2, 3]],
    [
      [NaN, 0, 0],
      [1, 2, 3],
    ],
    Array(2),
  ])
    expect(() => collection(records, prior)).toThrow();
  expect(() => local([], prior)).toThrow();
  expect(() => local([[1, 2]], prior)).toThrow();
  expect(() =>
    local(
      [
        [1e308, 0, 0],
        [1e308, 0, 0],
      ],
      prior,
    ),
  ).toThrow(/overflow/);
  expect(() =>
    placed([[1, 2, 3]], [[Infinity, 0, 0, 0], frame[1], frame[2]], prior),
  ).toThrow();
  expect(() =>
    complete(local([[1, 2, 3]], prior), true, [NaN, 0, 0]),
  ).toThrow();
  expect(prior).toEqual(initial());
});

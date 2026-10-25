import { expect, it } from "vitest";
import {
  prepareNativeSketchLinePointEdit as edit,
  prepareNativeSketchLinePointRecovery as recovery,
  prepareNativeSketchLineTransform as transform,
  completeNativeSketchLineRebuild as complete,
  type NativeSketchLineState,
} from "../src/sketch-line-rebuild";

const initial = (): NativeSketchLineState => ({
  frame: [
    [1, 0, 0, 10],
    [0, 1, 0, 20],
    [0, 0, 1, 30],
  ],
  start: [1, 2, 3],
  middle: [3, 4, 5],
  end: [5, 6, 7],
  sourceRecords: [
    [10, 20, 0],
    [30, 40, 0],
  ],
});

it("point handles replace the corresponding XYZ endpoint and retain old sources", () => {
  for (const index of [0, 1]) {
    const p = edit(index, [9, 8, 7], initial());
    expect(p.admitted).toBe(true);
    expect(p.candidate.backendRequest?.points).toEqual(
      index === 0
        ? [
            [9, 8, 7],
            [5, 6, 7],
          ]
        : [
            [1, 2, 3],
            [9, 8, 7],
          ],
    );
    expect(p.candidate.state.sourceRecords).toEqual(initial().sourceRecords);
    expect(p.candidate.state.frame).toEqual(initial().frame);
  }
});

it("point admission checks candidate line length, admitting equality at 0.0001", () => {
  const prior = initial();
  prior.start = [0, 0, 0];
  for (const length of [0, 0.0001 / 2]) {
    const p = edit(1, [length, 0, 0], prior);
    expect(p.admitted).toBe(false);
    expect(p.candidate.backendRequest).toBeUndefined();
    expect(p.candidate.state).toEqual(prior);
    expect(() => recovery(p)).toThrow();
  }
  expect(edit(1, [0.0001, 0, 0], prior).admitted).toBe(true);
  expect(edit(1, [0, 0, 0.0001], prior).admitted).toBe(true);
});

it("an unchanged endpoint still requests rebuilding when the line is long enough", () => {
  const prior = initial();
  expect(edit(0, prior.start, prior).admitted).toBe(true);
  expect(edit(1, prior.end, prior).candidate.backendRequest).toBeDefined();
});

it("failed candidate recovery repeats the OLD START for both endpoints", () => {
  for (const index of [0, 1]) {
    const prior = initial(),
      p = edit(index, [8, 9, 10], prior);
    const failed = complete(p.candidate, false);
    expect(failed.state.sourceRecords).toEqual(prior.sourceRecords);
    const retry = recovery(p);
    expect(retry.backendRequest?.points).toEqual([
      [1, 2, 3],
      [1, 2, 3],
    ]);
    expect(retry.state.start).toEqual(prior.start);
    expect(retry.state.end).toEqual(prior.start);
    expect(retry.state.middle).toEqual(prior.start);
    expect(retry.state.sourceRecords).toEqual(prior.sourceRecords);
    expect(complete(retry, false).builderSucceeded).toBe(false);
    expect(p.admitted).toBe(true);
  }
});

it("successful point build uses the backend midpoint and has no implicit recovery", () => {
  const p = edit(1, [9, 10, 11], initial());
  const r = complete(p.candidate, true, [4.5, 5.5, 6.5]);
  expect(r.state.start).toEqual([1, 2, 0]);
  expect(r.state.end).toEqual([9, 10, 0]);
  expect(r.state.middle).toEqual([4.5, 5.5, 0]);
  expect(r.state.sourceRecords).toEqual([
    [1, 2, 0],
    [9, 10, 0],
  ]);
});

it("recovery arithmetic is deferred until recovery is actually requested", () => {
  const prior = initial();
  prior.start = [1e308, 0, 0];
  prior.end = [0, 1, 0];
  const p = edit(0, [0, 0, 0], prior);
  expect(p.admitted).toBe(true);
  expect(p.candidate.state.middle).toEqual([0, 0.5, 0]);
  expect(() => recovery(p)).toThrow(/overflow/);
});

it("point preparation and recovery own detached records", () => {
  const prior = initial(),
    target = [8, 9, 10],
    p = edit(0, target, prior);
  target[0] = 99;
  Object.assign(prior.start, { 0: 99 });
  Object.assign(prior.sourceRecords[0], { 0: 99 });
  expect(p.candidate.state.start).toEqual([8, 9, 10]);
  expect(recovery(p).backendRequest?.points).toEqual([
    [1, 2, 3],
    [1, 2, 3],
  ]);
  const retry = recovery(p);
  Object.assign(retry.state.start, { 0: 77 });
  expect(recovery(p).state.start).toEqual([1, 2, 3]);
});

it("transform uses both internal XYZ endpoints, ignores old source coordinates, and retains stored frame", () => {
  const matrix = [
    [0, -1, 0, 5],
    [1, 0, 0, 6],
    [0, 0, 2, 7],
  ];
  const p = transform(matrix, initial());
  expect(p.backendRequest?.points).toEqual([
    [3, 7, 13],
    [-1, 11, 21],
  ]);
  expect(p.state.middle).toEqual([1, 9, 17]);
  expect(p.state.frame).toEqual(initial().frame);
  expect(p.state.sourceRecords).toEqual(initial().sourceRecords);
});

it("collapsed transform requests the backend without a line-length precheck", () => {
  const p = transform(
    [
      [0, 0, 0, 2],
      [0, 0, 0, 3],
      [0, 0, 0, 4],
    ],
    initial(),
  );
  expect(p.backendRequest?.points).toEqual([
    [2, 3, 4],
    [2, 3, 4],
  ]);
  expect(complete(p, false).state.sourceRecords).toEqual(
    initial().sourceRecords,
  );
});

it("transform completion flattens child fields only after successful rebuilding", () => {
  const p = transform(
    [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 9],
    ],
    initial(),
  );
  expect(complete(p, false).state.end).toEqual([5, 6, 16]);
  expect(complete(p, true, [3, 4, 14]).state.end).toEqual([5, 6, 0]);
  expect(p.backendRequest?.points[1]).toEqual([5, 6, 16]);
});

it("rejects malformed indices, points and transforms without changing supplied state", () => {
  const prior = initial();
  for (const index of [-1, 2, 0.5, NaN])
    expect(() => edit(index, [1, 2, 3], prior)).toThrow();
  expect(() => edit(0, [NaN, 1, 2], prior)).toThrow();
  expect(() => transform([[1, 0, 0, 0]], prior)).toThrow();
  expect(() =>
    transform(
      [
        [1e308, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
      ],
      prior,
    ),
  ).toThrow(/overflow/);
  expect(prior).toEqual(initial());
});

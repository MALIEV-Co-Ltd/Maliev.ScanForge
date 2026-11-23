import { expect, it } from "vitest";
import {
  prepareNativeSketchCircleRebuild as rebuild,
  prepareNativeSketchCirclePlacedReplacement as replace,
} from "../src/sketch-circle-rebuild";
const frame = [
  [0, 0, 1, 10],
  [1, 0, 0, 20],
  [0, 1, 0, 30],
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
const world = [
  [10, 21, 30],
  [10, 20, 31],
  [10, 19, 30],
];
const initial = () => rebuild(points, identity);
it("moves local XYZ from fourth world point while retaining stored frame and radius", () => {
  const prior = initial();
  const result = replace([...world, [17, 25, 36]], frame, prior);
  expect(result.route).toBe("translate");
  expect(result.preparation.frame).toEqual(identity);
  expect(result.preparation.backendRequest).toEqual({
    kind: "circle",
    center: [5, 6, 7],
    radius: 1,
  });
  expect(result.preparation.sourceRecords).toEqual([
    [6, 6, 7],
    [5, 7, 7],
    [4, 6, 7],
    [5, 6, 7],
  ]);
  expect(result.preparation.fitSucceeded).toBeUndefined();
  expect(prior).toEqual(initial());
});
it("refits exactly three inverse-transformed points using supplied frame and flattening Z", () => {
  const result = replace(
    [
      [109, 22, 30],
      [109, 20, 32],
      [109, 18, 30],
    ],
    frame,
    initial(),
  );
  expect(result.route).toBe("refit");
  expect(result.preparation.frame).toEqual(frame);
  expect(result.preparation.sourceRecords).toEqual([
    [2, 0, 0],
    [0, 2, 0],
    [-2, 0, 0],
    [0, 0, 0],
  ]);
  expect(result.preparation.backendRequest.radius).toBe(2);
});
it.each([0, 1, 2])("compares world record %s independently", (index) => {
  const input = [...world.map((p) => [...p]), [999, 999, 999]];
  input[index][0] += 0.01;
  const result = replace(input, frame, initial());
  expect(result.route).toBe("refit");
  expect(result.preparation.backendRequest.center).toEqual([0, 0, 0]);
});
it("uses strict squared world threshold", () => {
  const input = [...points.map((p) => [...p]), [5, 6, 7]];
  input[1][0] = 0.001;
  input[1][2] = 0.003;
  expect(replace(input, identity, initial()).route).toBe("refit");
  input[1][2] = 0.0029999999999999996;
  expect(replace(input, identity, initial()).route).toBe("translate");
});
it("preserves inverse Y/X/Z product accumulation", () => {
  const result = replace(
    [
      [1, 1, 1],
      [0, 1, 0],
      [-1, 0, 0],
    ],
    [
      [1, 0, 0, 0],
      [1e16, 1, 0, 0],
      [-1e16, 0, 1, 0],
    ],
    initial(),
  );
  expect(result.preparation.sourceRecords[0][0]).toBe(0);
});
it("applies delta instead of direct center assignment and preserves failed radius", () => {
  const prior = initial();
  const staged = {
    ...prior,
    backendRequest: {
      ...prior.backendRequest,
      center: [1e16, 0, 0] as const,
      radius: -Number.MAX_VALUE,
    },
  };
  const result = replace([...points, [1, 0, 0]], identity, staged);
  expect(result.preparation.backendRequest.center[0]).toBe(0);
  expect(result.preparation.backendRequest.radius).toBe(-Number.MAX_VALUE);
});
it("rejects malformed records, frame and arithmetic before mutation", () => {
  const prior = initial();
  for (const input of [
    [],
    null,
    points.slice(0, 2),
    [...world, [Infinity, 0, 0]],
    Array(4),
  ])
    expect(() => replace(input, frame, prior)).toThrow();
  for (const matrix of [
    [],
    null,
    [[NaN, 0, 0, 0], ...frame.slice(1)],
    [[Number.MAX_VALUE, 0, 0, Number.MAX_VALUE], ...frame.slice(1)],
  ])
    expect(() => replace([...world, [1, 2, 3]], matrix, prior)).toThrow();
  expect(prior).toEqual(initial());
});

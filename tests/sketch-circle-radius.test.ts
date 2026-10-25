import { expect, it } from "vitest";
import {
  prepareNativeSketchCircleRebuild as rebuild,
  prepareNativeSketchCircleRadiusEdit as resize,
} from "../src/sketch-circle-rebuild";
const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
const initial = () =>
  rebuild(
    [
      [1, 0, 0],
      [0, 1, 0],
      [-1, 0, 0],
    ],
    frame,
  );
it.each([2, -2])(
  "uses the magnitude of radius %s without fitting",
  (radius) => {
    const result = resize(radius, initial());
    expect(result.backendRequest).toEqual({
      kind: "circle",
      center: [0, 0, 0],
      radius: 2,
    });
    expect(result.sourceRecords).toEqual([
      [2, 0, 0],
      [0, 2, 0],
      [-2, 0, 0],
      [0, 0, 0],
    ]);
    expect(result.fitSucceeded).toBeUndefined();
    expect(result.frame).toEqual(frame);
  },
);
it.each([
  0,
  -0,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  2 ** -23 * (1 - Number.EPSILON),
])("replaces sub-threshold radius %s with 0.01", (radius) => {
  expect(resize(radius, initial()).backendRequest.radius).toBe(0.01);
});
it("admits exact radius threshold", () => {
  expect(resize(2 ** -23, initial()).backendRequest.radius).toBe(2 ** -23);
});
it("uses +Y only for a near-center middle point and keeps zero endpoint directions", () => {
  const prior = rebuild(
    [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    frame,
  );
  const result = resize(2, prior);
  expect(result.sourceRecords).toEqual([
    [0, 0, 0],
    [0, 2, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]);
  expect(result.backendRequest.radius).toBe(2);
});
it("includes equality in the middle squared-distance normalization branch", () => {
  const prior = initial();
  for (const [distance, expected] of [
    [Math.sqrt(Number.EPSILON), [2, 0, 0]],
    [Math.sqrt(Number.EPSILON) / 2, [0, 2, 0]],
  ] as const) {
    const staged = {
      ...prior,
      sourceRecords: [
        prior.sourceRecords[0],
        [distance, 0, 0],
        prior.sourceRecords[2],
        prior.sourceRecords[3],
      ] as typeof prior.sourceRecords,
    };
    expect(resize(2, staged).sourceRecords[1]).toEqual(expected);
  }
});
it("preserves center and nonzero defining Z instead of flattening", () => {
  const prior = initial();
  const staged = {
    ...prior,
    sourceRecords: [
      [0, 0, 2],
      [0, 3, 0],
      [-4, 0, 0],
      [0, 0, 0],
    ] as const,
  };
  expect(resize(5, staged).sourceRecords).toEqual([
    [0, 0, 5],
    [0, 5, 0],
    [-5, 0, 0],
    [0, 0, 0],
  ]);
});
it("rejects invalid radius and overflowing normalization without mutation", () => {
  const prior = initial();
  for (const radius of [NaN, Infinity, -Infinity, "2", null])
    expect(() => resize(radius, prior)).toThrow();
  const staged = {
    ...prior,
    sourceRecords: [
      [Number.MAX_VALUE, 0, 0],
      prior.sourceRecords[1],
      prior.sourceRecords[2],
      prior.sourceRecords[3],
    ] as typeof prior.sourceRecords,
  };
  expect(() => resize(2, staged)).toThrow();
  expect(prior).toEqual(initial());
});

import { expect, it } from "vitest";
import {
  nativeReferenceCircleInputPoints,
  nativeReferenceCircumcenter,
} from "../src/reference-geometry-numerics";

// Analytic checks of the recovered input helper, not native geometry replay.
it("orders center-radius inputs as positive X, positive Y, negative X", () => {
  expect(nativeReferenceCircleInputPoints([3, -4, 7], 2)).toEqual([
    [5, -4, 7],
    [3, -2, 7],
    [1, -4, 7],
  ]);
});

it.each([-2, -0, 0, Number.MIN_VALUE, 2 ** -23 - 2 ** -76])(
  "rejects radius %s without converting its sign or substituting a default",
  (radius) => {
    expect(nativeReferenceCircleInputPoints([1, 2, 3], radius)).toBeUndefined();
  },
);

it.each([2 ** -23, 2 ** -23 + 2 ** -75])(
  "admits input points at or immediately above the radius threshold: %s",
  (radius) => {
    expect(nativeReferenceCircleInputPoints([0, 0, 0], radius)).toEqual([
      [radius, 0, 0],
      [0, radius, 0],
      [-radius, 0, 0],
    ]);
  },
);

it("preserves signed-zero differences between addition and subtraction", () => {
  expect(nativeReferenceCircleInputPoints([-0, -0, -0], 1)).toEqual([
    [1, 0, 0],
    [0, 1, 0],
    [-1, -0, -0],
  ]);
});

it("returns detached point records without changing the supplied center", () => {
  const center = Object.freeze([2, 4, 6]);
  const first = nativeReferenceCircleInputPoints(center, 3)!;
  first[0][0] = 99;
  expect(center).toEqual([2, 4, 6]);
  expect(first[1]).toEqual([2, 7, 6]);
  expect(nativeReferenceCircleInputPoints(center, 3)).toEqual([
    [5, 4, 6],
    [2, 7, 6],
    [-1, 4, 6],
  ]);
});

it("leaves local-plane projection and provider admission to the next stage", () => {
  const points = nativeReferenceCircleInputPoints([0, 0, 9], 2 ** -23)!;
  expect(points.map((point) => point[2])).toEqual([9, 9, 9]);
  expect(nativeReferenceCircumcenter(...points).nondegenerate).toBe(false);
});

it("retains binary64 center offsets before a subsequent circle fit", () => {
  const points = nativeReferenceCircleInputPoints([1e8, -1e8, 0], 0.25)!;
  expect(points).toEqual([
    [100000000.25, -100000000, 0],
    [100000000, -99999999.75, 0],
    [99999999.75, -100000000, 0],
  ]);
  expect(nativeReferenceCircumcenter(...points)).toEqual({
    center: [1e8, -1e8, 0],
    nondegenerate: true,
  });
});

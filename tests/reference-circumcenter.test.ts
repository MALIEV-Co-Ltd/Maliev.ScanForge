import { expect, it } from "vitest";
import { nativeReferenceCircumcenter } from "../src/reference-geometry-numerics";

// Analytic fixtures for recovered arithmetic, not original-native execution.
it("finds the center in the triangle's 3D plane and detaches its result", () => {
  const a = Object.freeze([1, 2, 3]);
  const b = Object.freeze([3, 2, 3]);
  const c = Object.freeze([1, 2, 7]);
  const result = nativeReferenceCircumcenter(a, b, c);
  expect(result).toEqual({ center: [2, 2, 5], nondegenerate: true });
  expect(result.center).not.toBe(a);
  expect(a).toEqual([1, 2, 3]);
  expect(b).toEqual([3, 2, 3]);
  expect(c).toEqual([1, 2, 7]);
});

it.each([
  [
    [0, 0, 0],
    [4, 0, 0],
    [1, 1, 0],
  ],
  [
    [1, 1, 0],
    [0, 0, 0],
    [4, 0, 0],
  ],
  [
    [4, 0, 0],
    [1, 1, 0],
    [0, 0, 0],
  ],
])(
  "retains the outside center of an obtuse triangle in each cyclic order",
  (a, b, c) => {
    expect(nativeReferenceCircumcenter(a, b, c)).toEqual({
      center: [2, -1, 0],
      nondegenerate: true,
    });
  },
);

it.each([
  [2 ** -14, false],
  [2 ** -13, true],
  [2 ** -12, true],
])("uses the inclusive determinant threshold for x=%s", (x, accepted) => {
  const y = 2 ** -13;
  expect(nativeReferenceCircumcenter([0, 0, 0], [x, 0, 0], [0, y, 0])).toEqual({
    center: accepted ? [x / 2, y / 2, 0] : [x / 3, y / 3, 0],
    nondegenerate: accepted,
  });
});

it("returns the centroid with failure status for collinear input", () => {
  expect(nativeReferenceCircumcenter([0, 0, 0], [1, 2, 3], [2, 4, 6])).toEqual({
    center: [1, 2, 3],
    nondegenerate: false,
  });
});

it("retains duplicate-point weighting in the degenerate centroid", () => {
  expect(nativeReferenceCircumcenter([3, 6, 9], [3, 6, 9], [6, 9, 12])).toEqual(
    {
      center: [4, 7, 10],
      nondegenerate: false,
    },
  );
});

it("preserves signed zero in the degenerate centroid", () => {
  expect(
    nativeReferenceCircumcenter([-0, -0, -0], [-0, -0, -0], [-0, -0, -0]),
  ).toEqual({
    center: [-0, -0, -0],
    nondegenerate: false,
  });
});

it("retains the recovered determinant grouping and barycentric accumulation", () => {
  expect(
    nativeReferenceCircumcenter(
      [-12.46098732623922, -49.14740166664515, -14.837328435830926],
      [49.47373555420674, 76.1628679026621, -28.18210474969713],
      [19.533105692032166, -61.27125871641943, -38.13560079409124],
    ),
  ).toEqual({
    center: [26.764209349467766, 8.748856686449756, -27.87095859390238],
    nondegenerate: true,
  });
});

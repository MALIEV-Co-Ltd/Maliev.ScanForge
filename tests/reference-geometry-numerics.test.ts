import { expect, it } from "vitest";
import {
  nativeReferenceClosestLines,
  nativeReferenceNormalize,
  nativeReferencePlaneIntersection,
} from "../src/reference-geometry-numerics";

it("retains signed-zero anchor components when orthogonal plane order reverses", () => {
  expect(
    nativeReferencePlaneIntersection([0, 0, 1], 0, [0, 1, 0], 0, 0.001),
  ).toEqual({
    point: [-0, -0, -0],
    direction: [-1, 0, 0],
  });
});

// Analytic boundary cases; these are not captures of original-code execution.
it("returns distinct closest points for skew lines with non-unit directions", () => {
  const a = Object.freeze([1, 2, 3]);
  const u = Object.freeze([2, 0, 0]);
  const b = Object.freeze([4, 5, 6]);
  const v = Object.freeze([0, 3, 0]);
  const result = nativeReferenceClosestLines(a, u, b, v, 2 ** -23);
  expect(result).toEqual({ first: [4, 2, 3], second: [4, 2, 6] });
  expect(result!.first).not.toBe(a);
  expect(result!.second).not.toBe(b);
});

it.each([
  ["parallel", [1, 0, 0], [2, 0, 0]],
  ["opposite", [1, 0, 0], [-2, 0, 0]],
  ["zero", [0, 0, 0], [0, 1, 0]],
] as const)(
  "rejects %s directions without manufacturing a point",
  (_, u, v) => {
    expect(
      nativeReferenceClosestLines([0, 0, 0], u, [1, 2, 3], v, 2 ** -23),
    ).toBeUndefined();
  },
);

it("uses the strict determinant threshold, including exact equality", () => {
  const a = [0, 0, 0],
    u = [1, 0, 0],
    b = [2, 3, 4],
    v = [0, 1, 0];
  expect(nativeReferenceClosestLines(a, u, b, v, 1)).toBeUndefined();
  expect(
    nativeReferenceClosestLines(a, u, b, v, 1 - Number.EPSILON / 2),
  ).toEqual({ first: [2, 0, 0], second: [2, 0, 4] });
  expect(
    nativeReferenceClosestLines(a, u, b, v, 1 + Number.EPSILON),
  ).toBeUndefined();
});

it("returns the shared intersection when the lines cross", () => {
  expect(
    nativeReferenceClosestLines(
      [0, 2, 3],
      [1, 0, 0],
      [4, 0, 3],
      [0, 1, 0],
      2 ** -23,
    ),
  ).toEqual({ first: [4, 2, 3], second: [4, 2, 3] });
});

it("normalizes at machine epsilon but preserves smaller vectors", () => {
  const input = Object.freeze([Number.EPSILON, 0, 0]);
  expect(nativeReferenceNormalize(input)).toEqual([1, 0, 0]);
  expect(nativeReferenceNormalize([Number.EPSILON / 2, 0, 0])).toEqual([
    Number.EPSILON / 2,
    0,
    0,
  ]);
  expect(nativeReferenceNormalize(input)).not.toBe(input);
  expect(input).toEqual([Number.EPSILON, 0, 0]);
  expect(nativeReferenceNormalize([-0, 0, -0])).toEqual([-0, 0, -0]);
});

it("intersects non-unit planes and retains the native signed-zero anchor", () => {
  const n1 = Object.freeze([2, 0, 0]),
    n2 = Object.freeze([0, 3, 0]);
  expect(nativeReferencePlaneIntersection(n1, 4, n2, 9, 0.001)).toEqual({
    point: [-2, -3, -0],
    direction: [0, 0, 1],
  });
  expect(n1).toEqual([2, 0, 0]);
  expect(n2).toEqual([0, 3, 0]);
});

it("admits equality at the plane cross-product threshold", () => {
  expect(
    nativeReferencePlaneIntersection([1, 0, 0], -2, [0, 1, 0], -3, 1),
  ).toEqual({ point: [2, 3, 0], direction: [0, 0, 1] });
  expect(
    nativeReferencePlaneIntersection(
      [1, 0, 0],
      -2,
      [0, 1, 0],
      -3,
      1 + Number.EPSILON,
    ),
  ).toBeUndefined();
});

it("admits determinant equality but rejects values below the separate threshold", () => {
  const epsilon = 2 ** -23;
  expect(
    nativeReferencePlaneIntersection(
      [epsilon, 0, 0],
      -2 * epsilon,
      [0, 1, 0],
      -3,
      0,
    ),
  ).toEqual({ point: [2, 3, 0], direction: [0, 0, 1] });
  expect(
    nativeReferencePlaneIntersection(
      [epsilon / 2, 0, 0],
      -epsilon,
      [0, 1, 0],
      -3,
      0,
    ),
  ).toBeUndefined();
});

it("chooses X when all normalized cross-product components tie", () => {
  const reciprocal = 1 / Math.sqrt(3);
  expect(
    nativeReferencePlaneIntersection([1, 0, 1], -4, [0, 1, 1], -6, 0.001),
  ).toEqual({
    point: [2, 4, 2],
    direction: [-reciprocal, -reciprocal, reciprocal],
  });
});

it("chooses Y ahead of Z when X is smaller and the other components tie", () => {
  const reciprocal = 1 / Math.sqrt(2);
  expect(
    nativeReferencePlaneIntersection([1, 0, 0], -2, [0, 1, 1], -6, 0.001),
  ).toEqual({
    point: [2, 3, 3],
    direction: [0, -reciprocal, reciprocal],
  });
});

it("rejects parallel and zero-normal planes even with a zero cross threshold", () => {
  expect(
    nativeReferencePlaneIntersection([1, 0, 0], -2, [2, 0, 0], -6, 0),
  ).toBeUndefined();
  expect(
    nativeReferencePlaneIntersection([0, 0, 0], 0, [0, 1, 0], -3, 0),
  ).toBeUndefined();
});

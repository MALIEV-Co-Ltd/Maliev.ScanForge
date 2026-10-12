import { expect, it } from "vitest";
import { morphTriangleSelection } from "../src/selection-morphology";

// Four adjacent triangles in a strip; only edge neighbors qualify, not vertices.
const strip = new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 2, 0, 0, 1, 1,
  0, 2, 0, 0, 2, 1, 0, 1, 1, 0,
]);
it("grows exactly one edge ring without mutating the input", () => {
  const mask = new Uint8Array([1, 0, 0, 0]);
  expect([...morphTriangleSelection(strip, mask, "grow")]).toEqual([
    1, 1, 0, 0,
  ]);
  expect([...mask]).toEqual([1, 0, 0, 0]);
  expect([
    ...morphTriangleSelection(strip, new Uint8Array([1, 1, 0, 0]), "grow"),
  ]).toEqual([1, 1, 1, 0]);
});
it("shrinks the selected frontier by one edge ring", () => {
  expect([
    ...morphTriangleSelection(strip, new Uint8Array([1, 1, 0, 0]), "shrink"),
  ]).toEqual([1, 0, 0, 0]);
  expect([
    ...morphTriangleSelection(strip, new Uint8Array([1, 1, 1, 1]), "shrink"),
  ]).toEqual([1, 1, 1, 1]);
});
it("does not select or cross hidden triangles", () => {
  expect([
    ...morphTriangleSelection(strip, new Uint8Array([1, 1, 0, 0]), "grow", [1]),
  ]).toEqual([1, 0, 0, 0]);
  expect([
    ...morphTriangleSelection(
      strip,
      new Uint8Array([1, 1, 0, 0]),
      "shrink",
      [1],
    ),
  ]).toEqual([0, 0, 0, 0]);
});
it("finds open edges and boundaries exposed by hiding faces of a closed tetrahedron", () => {
  const p = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const tetra = new Float32Array(
    [
      [0, 2, 1],
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3],
    ].flatMap((face) => face.flatMap((i) => p[i])),
  );
  const mask = new Uint8Array(4);
  expect([...morphTriangleSelection(tetra, mask, "boundary")]).toEqual([
    0, 0, 0, 0,
  ]);
  expect([...morphTriangleSelection(tetra, mask, "boundary", [0])]).toEqual([
    0, 1, 1, 1,
  ]);
  expect([...morphTriangleSelection(strip, mask, "boundary")]).toEqual([
    1, 1, 1, 1,
  ]);
});
it("rejects malformed masks and invalid hidden indices and honors cancellation", () => {
  expect(() =>
    morphTriangleSelection(strip, new Uint8Array(3), "grow"),
  ).toThrow(/one byte/);
  expect(() =>
    morphTriangleSelection(strip, new Uint8Array([2, 0, 0, 0]), "grow"),
  ).toThrow(/zero or one/);
  expect(() =>
    morphTriangleSelection(strip, new Uint8Array(4), "grow", [4]),
  ).toThrow(/out of range/);
  expect(() =>
    morphTriangleSelection(strip, new Uint8Array(4), "grow", [], {
      signal: AbortSignal.abort(),
    }),
  ).toThrow(/cancelled/);
});

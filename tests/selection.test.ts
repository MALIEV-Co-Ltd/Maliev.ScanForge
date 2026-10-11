import { describe, expect, it } from "vitest";
import {
  partitionTriangles,
  selectTriangles,
  selectionCount,
} from "../src/selection";

const left = [0, 0, 0, 3, 0, 0, 0, 3, 0];
const right = [9, 0, 0, 12, 0, 0, 9, 3, 0];

describe("spherical centroid mesh brush", () => {
  it("selects centroids within radius including the boundary", () => {
    const mesh = new Float32Array([...left, ...right]);
    expect(Array.from(selectTriangles(mesh, [1, 1, 0], 1))).toEqual([1, 0]);
    expect(Array.from(selectTriangles(mesh, [1, 1, 1], 1))).toEqual([1, 0]);
    expect(Array.from(selectTriangles(mesh, [1, 1, 1.01], 1))).toEqual([0, 0]);
    // A vertex inside the brush is insufficient when the centroid is outside.
    expect(selectionCount(selectTriangles(mesh, [0, 0, 0], 0.5))).toBe(0);
  });

  it("adds and removes brush triangles without mutating existing selection", () => {
    const mesh = [...left, ...right];
    const previous = new Uint8Array([1, 0]);
    const added = selectTriangles(mesh, [10, 1, 0], 1, previous);
    expect(Array.from(added)).toEqual([1, 1]);
    expect(Array.from(previous)).toEqual([1, 0]);
    const removed = selectTriangles(mesh, [1, 1, 0], 1, added, "remove");
    expect(Array.from(removed)).toEqual([0, 1]);
    expect(Array.from(added)).toEqual([1, 1]);
    expect(selectionCount(removed)).toBe(1);
  });

  it("partitions in original triangle order and preserves winding without mutation", () => {
    const mesh = new Float32Array([...left, ...right, ...left]);
    const mask = new Uint8Array([1, 0, 1]);
    const { selected, remainder } = partitionTriangles(mesh, mask);
    expect(selected).toBeInstanceOf(Float32Array);
    expect(Array.from(selected)).toEqual([...left, ...left]);
    expect(Array.from(remainder)).toEqual(right);
    expect(Array.from(mesh)).toEqual([...left, ...right, ...left]);
    expect(Array.from(mask)).toEqual([1, 0, 1]);
    expect(partitionTriangles(mesh, new Uint8Array(3)).selected).toHaveLength(
      0,
    );
    expect(
      partitionTriangles(mesh, new Uint8Array([1, 1, 1])).remainder,
    ).toHaveLength(0);
  });

  it("accepts empty meshes and rejects malformed coordinates, masks and brush values", () => {
    expect(selectTriangles([], [0, 0, 0], 1)).toHaveLength(0);
    expect(partitionTriangles([], new Uint8Array()).remainder).toHaveLength(0);
    expect(() => selectTriangles([0, 0, 0], [0, 0, 0], 1)).toThrow(
      "complete triangle",
    );
    expect(() =>
      selectTriangles([...left.slice(0, 8), NaN], [0, 0, 0], 1),
    ).toThrow("finite triangle");
    expect(() => selectTriangles(left, [0, 0, Infinity], 1)).toThrow(
      "Brush requires",
    );
    expect(() => selectTriangles(left, [0, 0, 0], 0)).toThrow(
      "positive radius",
    );
    expect(() =>
      selectTriangles(left, [0, 0, 0], 1, new Uint8Array(2)),
    ).toThrow("one byte per triangle");
    expect(() => selectionCount(new Uint8Array([2]))).toThrow("zero or one");
    expect(() => partitionTriangles(left, new Uint8Array([255]))).toThrow(
      "zero or one",
    );
    expect(() =>
      partitionTriangles([...left.slice(0, 8), 1e100], new Uint8Array([1])),
    ).toThrow("Float32 representation");
  });
});

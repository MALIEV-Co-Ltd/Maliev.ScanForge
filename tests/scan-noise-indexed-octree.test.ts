import { expect, it } from "vitest";
import native from "./fixtures/noise-octree-trees.json";
import {
  packNoiseOctree,
  prepareNoiseOctree,
  prepareIndexedNoiseOctree,
} from "../src/scan-noise-octree";
it.each(native.cases)(
  "retains indexed buffers with original subdivision: $name",
  (c) => {
    const packed = packNoiseOctree(c.points, c.minextent, c.maxdepth);
    const indices = Uint32Array.from(
      { length: packed.points.length / 3 },
      (_, i) => i,
    );
    const input = {
      coordinates: packed.points,
      indices,
      triangleBounds: packed.triangleBounds,
    };
    const before = input.coordinates.slice(),
      bounds = input.triangleBounds.slice();
    const result = prepareIndexedNoiseOctree(input, c.minextent, c.maxdepth);
    expect(result.root).toEqual(
      prepareNoiseOctree(c.points, c.minextent, c.maxdepth).root,
    );
    expect(result.coordinates).toBe(input.coordinates);
    expect(result.indices).toBe(indices);
    expect(result.triangleBounds).toBe(input.triangleBounds);
    expect("points" in result).toBe(false);
    expect(input.coordinates).toEqual(before);
    expect(input.triangleBounds).toEqual(bounds);
  },
);
const surface = () => ({
  coordinates: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0),
  indices: Uint32Array.of(0, 1, 2, 2, 1, 3),
  triangleBounds: Float32Array.of(0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0),
});
it("borrows bounds through original face IDs without compacting the bounds buffer", () => {
  const s = surface(),
    boundsIds = Uint32Array.of(1),
    indices = s.indices.subarray(3);
  const result = prepareIndexedNoiseOctree({ ...s, indices, boundsIds });
  expect(result.triangleBounds).toBe(s.triangleBounds);
  expect(result.boundsIds).toBe(boundsIds);
  expect(result.root).toEqual(
    prepareNoiseOctree({ coordinates: s.coordinates, indices }).root,
  );
});
it("accepts shared immutable carriers and validates borrowed geometry", () => {
  const s = surface(),
    copy = <T extends Float32Array | Uint32Array>(v: T) => {
      const n = new (v.constructor as { new (b: ArrayBufferLike): T })(
        new SharedArrayBuffer(v.byteLength),
      );
      n.set(v);
      return n;
    };
  const shared = {
    coordinates: copy(s.coordinates),
    indices: copy(s.indices),
    triangleBounds: copy(s.triangleBounds),
  };
  expect(prepareIndexedNoiseOctree(shared).coordinates).toBe(
    shared.coordinates,
  );
  for (const invalid of [
    { ...s, indices: Uint32Array.of(0, 1) },
    { ...s, indices: Uint32Array.of(0, 1, 99) },
    { ...s, triangleBounds: new Float32Array(6) },
    { ...s, boundsIds: Uint32Array.of(0, 9) },
    {
      ...s,
      triangleBounds: Float32Array.of(-1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0),
    },
    { ...s, coordinates: Float32Array.of(NaN, 0, 0) },
  ])
    expect(() => prepareIndexedNoiseOctree(invalid)).toThrow();
  for (const limits of [
    [-1, 10],
    [0.5, 11],
    [NaN, 10],
  ])
    expect(() =>
      prepareIndexedNoiseOctree(s, ...(limits as [number, number])),
    ).toThrow();
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    prepareIndexedNoiseOctree(s, 0.5, 10, { signal: controller.signal }),
  ).toThrow(/cancelled/);
});

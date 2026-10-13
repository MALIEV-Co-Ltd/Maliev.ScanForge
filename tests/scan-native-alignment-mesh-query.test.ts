import { expect, it } from "vitest";
import native from "./fixtures/alignment-query-worker.json";
import {
  createNativeAlignmentSurfaceQuery,
  type NativeAlignmentQuerySurface,
} from "../src/scan-native-alignment-mesh-query";
import { nativeAlignmentQueryWorker } from "../src/scan-native-alignment-query";

const target = (): NativeAlignmentQuerySurface => ({
  root: {
    bounds: [-3, -3, -3, 3, 3, 3],
    center: [0, 0, 0],
    mode: 0,
    triangles: [0],
    children: {},
  },
  points: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
  triangleBounds: new Float32Array([0, 0, 0, 2, 2, 0]),
  normals: new Float32Array([0, 0, 1]),
  neighbors: new Uint8Array([1, 1, 1]),
});

it.each(native.samples)(
  "matches original worker through the mesh query adapter: $name",
  (sample) => {
    const surface = target();
    if (!sample.neighbors) surface.neighbors.fill(0);
    const result = nativeAlignmentQueryWorker(
      sample.points.map((point, i) => ({
        point,
        normal: sample.normals[i],
        flags: 4,
      })),
      createNativeAlignmentSurfaceQuery(surface),
      { ...sample, transform: [1, 0, 0, sample.shift, 0, 1, 0, 0, 0, 0, 1, 0] },
    );
    expect(result).toEqual({
      error: sample.error,
      maximum: sample.maximum,
      minimum: sample.minimum,
      flags: sample.flags,
      closest: sample.closest,
    });
  },
);
it("uses edge masks rather than treating every point touching a border as an open-boundary match", () => {
  const surface = target();
  surface.neighbors.fill(0);
  const query = createNativeAlignmentSurfaceQuery(surface);
  expect(query([0, 0.5, 0.125], 10)?.openBoundary).toBe(false);
  expect(query([-0.125, 0.5, 0.125], 10)?.openBoundary).toBe(true);
  surface.neighbors[2] = 1;
  expect(query([-0.125, 0.5, 0.125], 10)?.openBoundary).toBe(false);
});
it("filters hidden triangles only when the target's visibility filter is enabled", () => {
  const surface = target();
  surface.triangleFlags = new Uint8Array([1]);
  const query = createNativeAlignmentSurfaceQuery(surface);
  expect(query([0.5, 0.5, 0.125], 10)).toBeDefined();
  surface.filterHidden = true;
  expect(query([0.5, 0.5, 0.125], 10)).toBeUndefined();
});
it("rejects mismatched immutable target arrays", () => {
  const surface = target();
  surface.normals = new Float32Array(0);
  expect(() => createNativeAlignmentSurfaceQuery(surface)).toThrow(
    "same triangles",
  );
});
it("uses the cached triangle normal for signed distance and orientation", () => {
  const surface = target();
  surface.normals[2] = -1;
  const hit = createNativeAlignmentSurfaceQuery(surface)([0.5, 0.5, 0.125], 10);
  expect(hit?.distance).toBe(-0.125);
  expect(hit?.normal).toEqual([0, 0, -1]);
  expect(hit?.closest).toEqual([0.5, 0.5, 0]);
});

it("keeps returned hits independent when subsequent queries reuse leaf scratch", () => {
  const query = createNativeAlignmentSurfaceQuery(target());
  const point = Object.freeze([0.5, 0.5, 0.125]);
  const first = query(point, 10);
  const saved = structuredClone(first);
  expect(query([1, 0.25, -0.5], 10)?.closest).toEqual([1, 0.25, 0]);
  expect(query([100, 100, 100], 0.01)).toBeUndefined();
  expect(first).toEqual(saved);
  expect(point).toEqual([0.5, 0.5, 0.125]);
});

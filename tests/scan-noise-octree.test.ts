import { expect, it } from "vitest";
import native from "./fixtures/noise-octree-trees.json";
import {
  buildNoiseOctree,
  prepareNoiseOctree,
  packNoiseOctree,
  partitionNoiseRoot,
  refineNoiseOctant,
} from "../src/scan-noise-octree";
import {
  queryNoiseOctree,
  type NoiseBounds,
} from "../src/scan-noise-octree-query";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";

it("independent octant tasks reject invalid input and respect cancellation", () => {
  const capture = native.cases[0];
  const prepared = packNoiseOctree(capture.points);
  expect(() => refineNoiseOctant(prepared, 0)).toThrow("partitioned");
  partitionNoiseRoot(prepared);
  for (const octant of [-1, 8, 0.5, NaN])
    expect(() => refineNoiseOctant(prepared, octant)).toThrow("octant");
  expect(() => refineNoiseOctant(prepared, 0, -1)).toThrow("limits");
  expect(() => refineNoiseOctant(prepared, 0, 0.5, 11)).toThrow("limits");
  expect(() => refineNoiseOctant(prepared, 0, 0.5, 10, {}, 100000, 0)).toThrow(
    "membership budget",
  );
  const controller = new AbortController();
  controller.abort();
  const before = structuredClone(prepared.root);
  expect(() =>
    refineNoiseOctant(prepared, 0, 0.5, 10, { signal: controller.signal }),
  ).toThrow("cancelled");
  expect(() =>
    partitionNoiseRoot(prepared, { signal: controller.signal }),
  ).toThrow("cancelled");
  expect(prepared.root).toEqual(before);
});

it("task membership limits stop overlapping expansion before publication", () => {
  let checked = false;
  for (const capture of native.cases) {
    const prepared = packNoiseOctree(
      capture.points,
      capture.minextent,
      capture.maxdepth,
    );
    partitionNoiseRoot(prepared);
    const octant = Object.values(prepared.root.children).findIndex(
      (node) =>
        node &&
        node.triangles.length >= 25 &&
        node.depth < capture.maxdepth &&
        node.bounds[3] - node.bounds[0] > Math.fround(capture.minextent),
    );
    if (octant < 0) continue;
    expect(() =>
      refineNoiseOctant(
        prepared,
        octant,
        capture.minextent,
        capture.maxdepth,
        {},
        100000,
        1,
      ),
    ).toThrow("membership budget");
    checked = true;
    break;
  }
  expect(checked).toBe(true);
});

it.each(native.cases)(
  "matches native subdivision and signed queries: $name",
  (capture) => {
    const root = buildNoiseOctree(
      capture.points,
      capture.minextent,
      capture.maxdepth,
    );
    const withoutMode = (key: string, value: unknown) =>
      key === "mode" ? undefined : value;
    expect(JSON.parse(JSON.stringify(root, withoutMode))).toEqual(capture.root);
    const packed = prepareNoiseOctree(
      {
        coordinates: Float32Array.from(capture.points.flat(2)),
        indices: Uint32Array.from(
          { length: capture.points.length * 3 },
          (_, id) => id,
        ),
      },
      capture.minextent,
      capture.maxdepth,
    );
    expect(packed.root).toEqual(root);
    const independent = packNoiseOctree(
      capture.points,
      capture.minextent,
      capture.maxdepth,
    );
    partitionNoiseRoot(independent);
    expect(Object.keys(independent.root.children)).toHaveLength(8);
    let nodes = 8;
    // Complete in reverse task order; octant addresses and triangle order stay fixed.
    for (let octant = 7; octant >= 0; octant--)
      nodes += refineNoiseOctant(
        independent,
        octant,
        capture.minextent,
        capture.maxdepth,
      ).descendants;
    expect(nodes).toBeLessThanOrEqual(100000);
    expect(independent.root).toEqual(root);
    expect(independent.points).toEqual(packed.points);
    expect(independent.triangleBounds).toEqual(packed.triangleBounds);
    const triangles = capture.points.map((t) => ({
      bounds: [
        Math.min(...t.map((p) => p[0])),
        Math.min(...t.map((p) => p[1])),
        Math.min(...t.map((p) => p[2])),
        Math.max(...t.map((p) => p[0])),
        Math.max(...t.map((p) => p[1])),
        Math.max(...t.map((p) => p[2])),
      ] as NoiseBounds,
    }));
    for (const sample of capture.samples) {
      const hit = queryNoiseOctree(
        root,
        sample.point,
        sample.radius,
        triangles,
        (id, radius) => {
          const [a, b, c] = capture.points[id];
          return noiseTriangleDistance(sample.point, a, b, c, radius);
        },
      );
      expect(hit?.triangle ?? null).toBe(sample.winner);
      expect(hit?.distance ?? null).toBe(sample.distance);
      const packedHit = queryNoiseOctree(
        packed.root,
        sample.point,
        sample.radius,
        packed.triangleBounds,
        (id, radius) => {
          const a = Array.from(packed.points.subarray(id * 9, id * 9 + 3));
          const b = Array.from(packed.points.subarray(id * 9 + 3, id * 9 + 6));
          const c = Array.from(packed.points.subarray(id * 9 + 6, id * 9 + 9));
          return noiseTriangleDistance(sample.point, a, b, c, radius);
        },
      );
      expect(packedHit?.triangle ?? null).toBe(sample.winner);
      expect(packedHit?.distance ?? null).toBe(sample.distance);
      const independentHit = queryNoiseOctree(
        independent.root,
        sample.point,
        sample.radius,
        independent.triangleBounds,
        (id, radius) => {
          const [a, b, c] = capture.points[id];
          return noiseTriangleDistance(sample.point, a, b, c, radius);
        },
      );
      expect(independentHit?.triangle ?? null).toBe(sample.winner);
      expect(independentHit?.distance ?? null).toBe(sample.distance);
    }
  },
);

it("rejects invalid indexed buffers and cancellation without changing source coordinates", () => {
  const coordinates = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const before = Float64Array.from(coordinates);
  expect(() =>
    prepareNoiseOctree({ coordinates, indices: new Uint32Array([0, 1, 99]) }),
  ).toThrow("index");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    prepareNoiseOctree(
      { coordinates, indices: new Uint32Array([0, 1, 2]) },
      0.5,
      10,
      { signal: controller.signal },
    ),
  ).toThrow("cancelled");
  expect(coordinates).toEqual(before);
});

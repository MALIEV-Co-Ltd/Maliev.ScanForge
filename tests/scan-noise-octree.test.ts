import { expect, it } from "vitest";
import native from "./fixtures/noise-octree-trees.json";
import { buildNoiseOctree, prepareNoiseOctree } from "../src/scan-noise-octree";
import {
  queryNoiseOctree,
  type NoiseBounds,
} from "../src/scan-noise-octree-query";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";

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

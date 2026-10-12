import { expect, it } from "vitest";
import native from "./fixtures/noise-octree-trees.json";
import { buildNoiseOctree } from "../src/scan-noise-octree";
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
    }
  },
);

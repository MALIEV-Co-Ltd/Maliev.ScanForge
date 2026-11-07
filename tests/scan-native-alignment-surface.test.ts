import { expect, it } from "vitest";
import native from "./fixtures/alignment-prepared-surface.json";
import { prepareNativeAlignmentSurface } from "../src/scan-native-alignment-surface";
import { createNativeAlignmentSurfaceQuery } from "../src/scan-native-alignment-mesh-query";

it.each(native.cases)(
  "optionally identifies the winning triangle for UV projection: $name",
  (sample) => {
    const prepared = prepareNativeAlignmentSurface(
      sample.vertices.flat(),
      sample.triangles,
    )!;
    const query = createNativeAlignmentSurfaceQuery(prepared.surface, {
      includeTriangle: true,
    });
    for (const point of sample.samples) {
      const hit = query(point.point, point.radius);
      if (point.winner === null) {
        expect(hit).toBeUndefined();
        continue;
      }
      expect(hit!.triangle).toBe(point.winner);
      expect(hit!.closest).toEqual(point.closest);
      expect(prepared.query(point.point, point.radius)).not.toHaveProperty(
        "triangle",
      );
    }
  },
);

it.each(native.cases)(
  "matches original prepared surface queries: $name",
  (sample) => {
    const prepared = prepareNativeAlignmentSurface(
      sample.vertices.flat(),
      sample.triangles,
    )!;
    expect(Array.from(prepared.adjacency.neighbors)).toEqual(sample.neighbors);
    for (const point of sample.samples) {
      const hit = prepared.query(point.point, point.radius);
      if (point.winner === null) {
        expect(hit).toBeUndefined();
        continue;
      }
      expect(hit).toBeDefined();
      expect(hit!.distance).toBe(point.distance);
      expect(hit!.normal).toEqual(point.normal);
      expect(hit!.openBoundary).toBe(point.openBoundary);
      expect(hit!.closest).toEqual(point.closest);
    }
  },
);

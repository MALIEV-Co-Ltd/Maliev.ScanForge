import { expect, it } from "vitest";
import native from "./fixtures/alignment-prepared-surface.json";
import { prepareNativeAlignmentSurface } from "../src/scan-native-alignment-surface";

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

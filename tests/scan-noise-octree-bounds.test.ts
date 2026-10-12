import { expect, it } from "vitest";
import native from "./fixtures/noise-octree-construction.json";
import { noiseOctantBox } from "../src/scan-noise-octree-bounds";
import type { NoiseBounds } from "../src/scan-noise-octree-query";

it("matches original native child bounds, centers and reciprocal extents", () => {
  for (const sample of native.children) {
    const b = sample.bounds;
    const bounds: NoiseBounds = [b[0], b[1], b[2], b[3], b[4], b[5]];
    const actual = noiseOctantBox(bounds, sample.child);
    expect([...actual.bounds, ...actual.center, ...actual.inverse]).toEqual(
      sample.output,
    );
  }
  expect(native.children).toHaveLength(320);
});

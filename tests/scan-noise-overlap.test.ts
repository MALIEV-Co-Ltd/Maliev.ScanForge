import { expect, it } from "vitest";
import native from "./fixtures/noise-octree-construction.json";
import { noiseTriangleCubeOverlap } from "../src/scan-noise-overlap";

it("matches the original native normalized triangle and cube intersection", () => {
  expect(native.overlap).toHaveLength(3134);
  for (const sample of native.overlap) {
    const [a, b, c] = sample.points;
    expect(
      noiseTriangleCubeOverlap(a, b, c),
      JSON.stringify(sample.points),
    ).toBe(sample.expected);
  }
});

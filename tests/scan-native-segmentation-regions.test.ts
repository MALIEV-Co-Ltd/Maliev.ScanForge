import { expect, it } from "vitest";
import native from "./fixtures/alignment-segmentation-regions-native.json";
import { nativeSegmentationRegions } from "../src/scan-native-segmentation-regions";

it.each(native.cases.map((sample, index) => ({ sample, index })))(
  "matches original flags, labels and exact region traversal for capture $index",
  ({ sample }) => {
    const scores = Float64Array.from(sample.scores);
    const triangles = Uint32Array.from(sample.faceVertices.flat());
    const neighbors = Int32Array.from(
      sample.neighbors.flat().map((value) => value ?? -1),
    );
    const faceFlags = Uint8Array.from(sample.faceFlags),
      vertexFlags = Uint32Array.from(sample.vertexFlags);
    const result = nativeSegmentationRegions(scores, triangles, neighbors, {
      threshold: sample.threshold,
      faceFlags,
      vertexFlags,
    });
    const regions = Array.from(result.regionOffsets.slice(1), (end, i) =>
      Array.from(result.traversal.slice(result.regionOffsets[i], end)),
    );
    expect(Array.from(result.labels)).toEqual(sample.native.labels);
    expect(Array.from(result.faceFlags)).toEqual(sample.native.faceFlags);
    expect(Array.from(result.vertexFlags)).toEqual(sample.native.vertexFlags);
    expect(result.maxRegionIndex).toBe(sample.native.maxRegionIndex);
    expect(regions).toEqual(sample.native.regions);
    expect(Array.from(faceFlags)).toEqual(sample.faceFlags);
    expect(Array.from(vertexFlags)).toEqual(sample.vertexFlags);
    expect(Array.from(scores)).toEqual(sample.scores);
  },
);
it("rejects malformed adjacency before traversal", () => {
  expect(() =>
    nativeSegmentationRegions(
      new Float64Array(3),
      new Uint32Array([0, 1, 2]),
      new Int32Array([1, -1, -1]),
      { threshold: 0.5 },
    ),
  ).toThrow("Neighbor index");
});
it("cancels before classification", () => {
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeSegmentationRegions(
      new Float64Array(3),
      new Uint32Array([0, 1, 2]),
      new Int32Array([-1, -1, -1]),
      { threshold: 0.5, signal: controller.signal },
    ),
  ).toThrow("cancelled");
});

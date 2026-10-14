import { expect, it } from "vitest";
import { nativeSegmentationScores } from "../src/scan-native-segmentation-scores";

const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
const triangle = new Uint32Array([0, 1, 2]);
it("requires native caller compaction rather than assigning scores to orphan vertices", () => {
  expect(() =>
    nativeSegmentationScores(new Float32Array([...normals, 0, 1, 0]), triangle),
  ).toThrow("compacted vertices");
});
it("accepts an empty compacted mesh", () => {
  expect(
    nativeSegmentationScores(new Float32Array(), new Uint32Array()),
  ).toEqual(new Float64Array());
});
it("rejects invalid indices and nonfinite normals", () => {
  expect(() =>
    nativeSegmentationScores(normals, new Uint32Array([0, 1, 3])),
  ).toThrow("outside");
  expect(() =>
    nativeSegmentationScores(
      new Float32Array([NaN, ...normals.slice(1)]),
      triangle,
    ),
  ).toThrow("finite");
});
it("honors cancellation before numerical work", () => {
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeSegmentationScores(normals, triangle, { signal: controller.signal }),
  ).toThrow("cancelled");
});

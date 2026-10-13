import { expect, it } from "vitest";
import native from "./fixtures/alignment-adjacency-bucket.json";
import { nativeLinkAlignmentBucket } from "../src/scan-native-alignment-adjacency";

it.each(native.cases)("matches original adjacency bucket: $name", (sample) => {
  const result = nativeLinkAlignmentBucket(
    sample.triangles,
    sample.vertexBuckets,
    sample.bucket,
  );
  expect(Array.from(result.neighbors)).toEqual(sample.neighbors);
  expect(Array.from(result.neighborEdges)).toEqual(sample.neighborEdges);
  expect(Array.from(result.triangleFlags)).toEqual(sample.triangleFlags);
  expect(result.recordCount).toBe(sample.recordCount);
});

it("rejects malformed indices and cancelled preparation", () => {
  expect(() => nativeLinkAlignmentBucket([0, 1, 2], [0], 0)).toThrow("index");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeLinkAlignmentBucket([0, 0, 0], [0], 0, { signal: controller.signal }),
  ).toThrow("cancelled");
});

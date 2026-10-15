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

it.each([4, 94906265, 100000001])(
  "retains first-edge and consumed-edge behavior for vertex range %i",
  (count) => {
    // Sparse metadata exercises very large valid IDs without allocating a scan.
    const a = count - 1,
      b = count - 2;
    const buckets = { length: count, [a]: 0, [b]: 0, 0: 0, 1: 0 };
    const result = nativeLinkAlignmentBucket(
      [a, b, 0, b, a, 1, a, b, 0, b, a, 1],
      buckets,
      0,
    );
    expect([0, 3, 6, 9].map((edge) => result.neighbors[edge])).toEqual([
      1, 0, -1, -1,
    ]);
    expect(result.neighborEdges[9]).toBe(255);
  },
);

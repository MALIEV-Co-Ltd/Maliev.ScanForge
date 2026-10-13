import { expect, it } from "vitest";
import native from "./fixtures/alignment-query-worker.json";
import {
  nativeAlignmentQueryWorker,
  ALIGNMENT_QUERY_SENTINEL,
} from "../src/scan-native-alignment-query";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";
it.each(native.samples)(
  "matches original worker on the same triangle mesh: $name",
  (sample) => {
    const transform = [1, 0, 0, sample.shift, 0, 1, 0, 0, 0, 0, 1, 0];
    const result = nativeAlignmentQueryWorker(
      sample.points.map((point, i) => ({
        point,
        normal: sample.normals[i],
        flags: 4,
      })),
      (point, radius) => {
        const closest: number[] = [];
        const distance = noiseTriangleDistance(
          [...point],
          [0, 0, 0],
          [2, 0, 0],
          [0, 2, 0],
          radius,
          closest,
        );
        if (!Number.isFinite(distance) || Math.abs(distance) >= radius)
          return undefined;
        return {
          distance,
          closest,
          normal: [0, 0, 1],
          openBoundary: !sample.neighbors && point[0] < 0,
        };
      },
      { ...sample, transform },
    );
    expect(result).toEqual({
      error: sample.error,
      maximum: sample.maximum,
      minimum: sample.minimum,
      flags: sample.flags,
      closest: sample.closest,
    });
  },
);
it("does not query hidden or unmarked vertices and preserves output slots", () => {
  let calls = 0;
  const result = nativeAlignmentQueryWorker(
    [0, 1, 5].map((flags) => ({ point: [0, 0, 0], normal: [0, 0, 1], flags })),
    () => {
      calls++;
      return undefined;
    },
    { output: true },
  );
  expect(calls).toBe(0);
  expect(result.closest).toEqual(
    Array(3).fill([ALIGNMENT_QUERY_SENTINEL, 0, 0]),
  );
});

import { expect, it } from "vitest";
import native from "./fixtures/alignment-multi-controller.json";
import {
  nativeAlignmentOrientationWorker,
  nativeAlignmentOrientationSign,
  nativeAlignmentQueryWorker,
  nativeAlignmentQueryError,
} from "../src/scan-native-alignment-query";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";

it.each(native.samples)(
  "matches original multi-worker controller: $name",
  (sample) => {
    const lanes = sample.lanes.map((heights, lane) =>
      heights.map((height) => ({
        point: [0.5, 0.5, height],
        normal: [0, 0, sample.normals[lane]],
        flags: 4,
      })),
    );
    const query = (point: readonly number[], radius: number) => {
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
      return { distance, closest, normal: [0, 0, 1], openBoundary: false };
    };
    if (sample.cancelled) {
      expect(nativeAlignmentQueryError([], true)).toBe(sample.error);
      expect(sample.dispatch).toEqual([]);
      return;
    }
    const votes = lanes.map((vertices) =>
      nativeAlignmentOrientationWorker(vertices, query),
    );
    const sign = sample.initializing
      ? nativeAlignmentOrientationSign(votes)
      : 1;
    const workers = lanes.map((vertices, lane) => {
      const result = nativeAlignmentQueryWorker(vertices, query, {
        initializing: sample.initializing,
        sign,
        radius: 1e30,
        best: 1e30,
      });
      expect(result.error).toBe(sample.workers[lane].error);
      expect(result.maximum).toBe(sample.workers[lane].maximum);
      expect(sign).toBe(sample.workers[lane].sign);
      // Captured counters are zeroed by the distance pass after vote reduction.
      // Compare the consumed orientation sign above; voting has its own fixtures.
      return result;
    });
    expect(nativeAlignmentQueryError(workers)).toBe(sample.error);
  },
);

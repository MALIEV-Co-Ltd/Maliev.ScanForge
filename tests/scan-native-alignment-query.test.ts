import { expect, it } from "vitest";
import native from "./fixtures/alignment-query-worker.json";
import arithmetic from "./fixtures/alignment-orientation-arithmetic.json";
import controller from "./fixtures/alignment-controller-worker.json";
import {
  nativeAlignmentQueryWorker,
  ALIGNMENT_QUERY_SENTINEL,
  nativeAlignmentOrientationWorker,
  nativeAlignmentOrientationSign,
  nativeAlignmentQueryError,
} from "../src/scan-native-alignment-query";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";
it.each(controller.samples)(
  "matches original controller result: $name",
  (sample) => {
    const vertices = sample.points.map((point, i) => ({
      point,
      normal: sample.normals[i],
      flags: 4,
    }));
    const transform = [1, 0, 0, sample.shift, 0, 1, 0, 0, 0, 0, 1, 0];
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
      return {
        distance,
        closest,
        normal: [0, 0, 1],
        openBoundary: !sample.neighbors && point[0] < 0,
      };
    };
    const sign = sample.initializing
      ? nativeAlignmentOrientationSign([
          nativeAlignmentOrientationWorker(vertices, query, { transform }),
        ])
      : sample.sign;
    const worker = nativeAlignmentQueryWorker(vertices, query, {
      ...sample,
      transform,
      sign,
    });
    expect(sign).toBe(sample.controllerSign);
    expect(nativeAlignmentQueryError([worker])).toBe(sample.controllerError);
    expect(worker.flags).toEqual(sample.flags);
    expect(worker.closest).toEqual(sample.closest);
  },
);
it("rejects empty workers and cancellation rather than treating them as perfect matches", () => {
  const valid = { maximum: 1, error: 2 };
  expect(
    nativeAlignmentQueryError([
      valid,
      { maximum: -ALIGNMENT_QUERY_SENTINEL, error: 0 },
    ]),
  ).toBe(ALIGNMENT_QUERY_SENTINEL);
  expect(nativeAlignmentQueryError([])).toBe(ALIGNMENT_QUERY_SENTINEL);
  expect(nativeAlignmentQueryError([valid], true)).toBe(
    ALIGNMENT_QUERY_SENTINEL,
  );
  expect(nativeAlignmentQueryError([valid, valid])).toBe(4);
});
it.each(native.samples)(
  "matches original orientation votes on the same triangle mesh: $name",
  (sample) => {
    const result = nativeAlignmentOrientationWorker(
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
        return { distance, closest, normal: [0, 0, 1], openBoundary: false };
      },
      { transform: [1, 0, 0, sample.shift, 0, 1, 0, 0, 0, 0, 1, 0] },
    );
    expect(result).toEqual(sample.votes);
  },
);
it("reduces orientation votes across workers with negative ties", () => {
  expect(
    nativeAlignmentOrientationSign([
      [3, 1],
      [0, 1],
    ]),
  ).toBe(1);
  expect(
    nativeAlignmentOrientationSign([
      [3, 1],
      [0, 2],
    ]),
  ).toBe(-1);
  expect(nativeAlignmentOrientationSign([])).toBe(-1);
});
it.each(arithmetic.samples)(
  "matches native normal dot cancellation: $name",
  (sample) => {
    const votes = nativeAlignmentOrientationWorker(
      sample.points.map((point, i) => ({
        point,
        normal: sample.normals[i],
        flags: 4,
      })),
      () => ({
        distance: 0.125,
        closest: [0.5, 0.5, 0],
        normal: arithmetic.targetNormal,
        openBoundary: false,
      }),
    );
    expect(votes).toEqual(sample.votes);
  },
);
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

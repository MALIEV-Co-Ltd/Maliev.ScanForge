import { expect, it } from "vitest";
import native from "./fixtures/alignment-target-group-native.json";
import { nativeAlignmentTargetGroupQuery } from "../src/scan-native-alignment-target-group";
import { prepareNativeAlignmentSurface } from "../src/scan-native-alignment-surface";
import { createNativeAlignmentObjective } from "../src/scan-native-alignment-objective";
it.each(native.samples)(
  "matches original target-group controller and workers: $name",
  (sample) => {
    const targets = sample.targetPlanes.map(([height, normal]) => {
      const target = prepareNativeAlignmentSurface(
        new Float32Array([0, 0, height, 2, 0, height, 0, 2, height]),
        new Uint32Array([0, 1, 2]),
      )!;
      target.surface.normals[2] = normal;
      return target.query;
    });
    const lanes = sample.lanes.map((heights, lane) =>
      heights.map((height) => ({
        point: [0.5, 0.5, height],
        normal: [0, 0, sample.normals[lane]],
        flags: 4,
      })),
    );
    const evaluate = createNativeAlignmentObjective(
      lanes,
      nativeAlignmentTargetGroupQuery(targets),
      { radius: 1e30, best: 1e30 },
    );
    const result = evaluate(
      [10, 10, 10, Math.PI / 2, Math.PI / 2, Math.PI / 2],
      { initializing: sample.initializing },
    );
    expect(result.error).toBe(sample.error);
    expect(result.workers.map((worker) => worker.error)).toEqual(
      sample.workers.map((worker) => worker.error),
    );
    expect(result.workers.map((worker) => worker.maximum)).toEqual(
      sample.workers.map((worker) => worker.maximum),
    );
    expect(result.workers.map(() => result.sign)).toEqual(
      sample.workers.map((worker) => worker.sign),
    );
  },
);
it("preserves the original radius across candidates and skips missing or nonfinite hits", () => {
  const radii: number[] = [];
  const hit = {
    distance: -2,
    closest: [0, 0, 0],
    normal: [0, 0, 1],
    openBoundary: false,
  };
  const query = nativeAlignmentTargetGroupQuery([
    (_point, radius) => {
      radii.push(radius);
      return hit;
    },
    (_point, radius) => {
      radii.push(radius);
      return { ...hit, distance: NaN };
    },
    () => undefined,
  ]);
  expect(query([0, 0, 0], 5)).toBe(hit);
  expect(radii).toEqual([5, 5]);
});

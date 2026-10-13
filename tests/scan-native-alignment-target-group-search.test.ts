import { expect, it } from "vitest";
import native from "./fixtures/alignment-target-group-search-native.json";
import dispatched from "./fixtures/alignment-native-dispatch.json";
import { nativeAlignmentTargetGroupQuery } from "../src/scan-native-alignment-target-group";
import { prepareNativeAlignmentSurface } from "../src/scan-native-alignment-surface";
import { nativeRefineAlignmentSurface } from "../src/scan-native-alignment-surface-search";
import { nativeAlignmentSixTransform } from "../src/scan-native-alignment-transform";
it.each([...native.samples, ...dispatched.samples])(
  "matches the original complete target-group search: $name",
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
        // The original vertex records store coordinates as Float32 before transforms.
        point: [0.5, 0.5, Math.fround(height)],
        normal: [0, 0, sample.normals[lane]],
        flags: 4,
      })),
    );
    const result = nativeRefineAlignmentSurface(
      sample.search.initial,
      lanes,
      nativeAlignmentTargetGroupQuery(targets),
      { budget: 1000, step: sample.search.step, initialRadius: 1e30 },
    );
    expect(result.initialError).toBe(sample.search.initialError);
    expect(result.best).toBe(sample.search.best);
    expect(result.parameters).toEqual(sample.search.parameters);
    expect(result.converged).toBe(sample.search.accepted);
    if ("flags" in sample.search)
      expect(result.flags).toEqual(sample.search.flags);
    expect(nativeAlignmentSixTransform(result.parameters)).toEqual(
      sample.search.matrix,
    );
  },
);

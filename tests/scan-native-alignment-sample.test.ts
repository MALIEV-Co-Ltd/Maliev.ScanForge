import { expect, it } from "vitest";
import native from "./fixtures/alignment-sample-representative.json";
import {
  nativeAlignmentSampleRepresentative,
  nativeSampleAlignmentVertices,
} from "../src/scan-native-alignment-sample";
import sampler from "./fixtures/alignment-source-sampler.json";

it.each(sampler.samples)("matches original source sampler: $name", (sample) => {
  const vertices = sample.points.map((point, i) => ({
    point,
    flags: sample.flags[i],
  }));
  const result = nativeSampleAlignmentVertices(vertices, sample.budget);
  expect(result.flags).toEqual(sample.resultFlags);
  expect(result.levelCounts).toEqual(sample.levelCounts);
  expect(result.nodes).toBe(sample.nodes);
  expect(vertices.map((vertex) => vertex.flags)).toEqual(sample.flags);
});

it("rejects an unseparable sampling request without modifying selection", () => {
  const vertices = [
    { point: [1, 2, 3], flags: 4 },
    { point: [1, 2, 3], flags: 20 },
  ];
  expect(() => nativeSampleAlignmentVertices(vertices, 1)).toThrow(
    "coincident",
  );
  expect(vertices.map((vertex) => vertex.flags)).toEqual([4, 20]);
});
it("honors cancellation before source preparation", () => {
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeSampleAlignmentVertices([], 1, { signal: controller.signal }),
  ).toThrow("cancelled");
});
it.each([-1, 1.5, 0x100000000, Infinity])(
  "rejects invalid sample count %s",
  (budget) => {
    expect(() => nativeSampleAlignmentVertices([], budget)).toThrow("unsigned");
  },
);

it.each(native.samples)(
  "matches original sample-node accumulation: $name",
  (sample) => {
    expect(
      nativeAlignmentSampleRepresentative(
        sample.points.map((point, i) => ({ point, flags: sample.flags[i] })),
        sample.center,
      ),
    ).toEqual({
      nearestIndex: sample.nearestIndex,
      preferredIndex: sample.preferredIndex,
      nearestDistance: sample.nearestDistance,
      preferredDistance: sample.preferredDistance,
    });
  },
);

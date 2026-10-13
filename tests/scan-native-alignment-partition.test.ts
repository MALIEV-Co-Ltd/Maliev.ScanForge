import { expect, it } from "vitest";
import { partitionNativeAlignmentVertices } from "../src/scan-native-alignment-partition";

const vertices = (flags: number[]) =>
  flags.map((flag, i) => ({
    point: [i, 0, 0],
    normal: [0, 0, 1],
    flags: flag,
  }));

it("carries round-robin assignment across mesh boundaries and skips hidden/unmarked vertices", () => {
  const groups = [vertices([4, 0, 5, 4]), vertices([1, 4, 4, 4])];
  const lanes = partitionNativeAlignmentVertices(groups, 3);
  expect(lanes.map((lane) => lane.indices)).toEqual([[0, 6], [3, 7], [5]]);
  expect(lanes[0].vertices[0]).toBe(groups[0][0]);
  expect(groups.map((group) => group.map((vertex) => vertex.flags))).toEqual([
    [4, 0, 5, 4],
    [1, 4, 4, 4],
  ]);
});
it("preserves empty lanes instead of changing the native controller's error policy", () => {
  expect(
    partitionNativeAlignmentVertices([vertices([4])], 3).map(
      (lane) => lane.indices,
    ),
  ).toEqual([[0], [], []]);
  expect(
    partitionNativeAlignmentVertices([], 2).map((lane) => lane.indices),
  ).toEqual([[], []]);
});
it.each([0, -1, 1.5, NaN, Infinity])(
  "rejects invalid worker count %s",
  (count) => {
    expect(() => partitionNativeAlignmentVertices([], count)).toThrow(
      "positive integer",
    );
  },
);

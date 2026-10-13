import { expect, it } from "vitest";
import {
  nativeAlignmentCandidateStride,
  nativeAlignmentCandidateTriplets,
} from "../src/scan-native-alignment-candidates";
import fixture from "./fixtures/alignment-candidate-stride-native.json";

it.each(fixture.cases)(
  "matches original sampling stride for $count points",
  ({ count, stride }) => {
    expect(nativeAlignmentCandidateStride(count)).toBe(stride);
  },
);
it.each([0, 1, 2])(
  "does not initialize with fewer than three pairs: %i",
  (count) => {
    expect(nativeAlignmentCandidateTriplets(count)).toEqual([]);
  },
);
it("retains the first and middle anchors and original third-point order", () => {
  expect(nativeAlignmentCandidateTriplets(3)).toEqual([[0, 1, 2]]);
  expect(nativeAlignmentCandidateTriplets(6)).toEqual([
    [0, 3, 1],
    [0, 3, 2],
    [0, 3, 4],
    [0, 3, 5],
  ]);
});
it.each([999, 1000, 1999, 2000, 100001, 0x7fffffff])(
  "samples %i points without duplicating anchors",
  (count) => {
    const stride = nativeAlignmentCandidateStride(count);
    const candidates = nativeAlignmentCandidateTriplets(count);
    expect(candidates.length).toBeLessThan(2000);
    for (let id = 0; id < candidates.length; id++) {
      const [first, middle, third] = candidates[id];
      expect(first).toBe(0);
      expect(middle).toBe(Math.floor(count / 2));
      expect(third).toBeGreaterThan(0);
      expect(third).toBeLessThan(count);
      expect(third).not.toBe(middle);
      expect(third % stride).toBe(0);
      if (id) expect(third).toBeGreaterThan(candidates[id - 1][2]);
    }
  },
);
it("rejects invalid counts and the independently guarded counter-overflow range", () => {
  for (const count of [-1, 1.5, NaN, Infinity, 0x100000000])
    expect(() => nativeAlignmentCandidateStride(count)).toThrow(
      "unsigned 32-bit",
    );
  expect(() => nativeAlignmentCandidateTriplets(0xffffffff)).toThrow(
    "safe candidate range",
  );
});

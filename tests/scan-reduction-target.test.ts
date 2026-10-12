import { expect, it } from "vitest";
import capture from "./fixtures/reduction-percentage.json";
import { reductionPercentageTarget } from "../src/scan-reduction-target";

it("matches original x64 percentage arithmetic across accepted integer inputs", () => {
  expect(capture.provenance.meshCollapseParity).toBe(false);
  expect(capture.cases).toHaveLength(143);
  for (const sample of capture.cases) {
    expect(sample.onlyExpectedFieldsChanged).toBe(true);
    expect(sample.clampedPercentage).toBe(
      Math.max(1, Math.min(100, sample.percentage)),
    );
    if (sample.count && sample.percentage >= 1 && sample.percentage <= 100)
      expect(reductionPercentageTarget(sample.count, sample.percentage)).toBe(
        Math.max(1, sample.target),
      );
  }
  expect(reductionPercentageTarget(95, 50)).toBe(47);
  expect(reductionPercentageTarget(500003, 33)).toBe(165000);
});

it("preserves nonempty output, fractional API input, and explicit validation", () => {
  expect(reductionPercentageTarget(3, 1)).toBe(1);
  expect(reductionPercentageTarget(95, 50.5)).toBe(47);
  for (const percentage of [0, -1, 101, NaN, Infinity])
    expect(() => reductionPercentageTarget(95, percentage)).toThrow(RangeError);
  for (const count of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => reductionPercentageTarget(count, 50)).toThrow(RangeError);
});

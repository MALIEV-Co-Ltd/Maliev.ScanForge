import { expect, it } from "vitest";
import { runFiniteSplitCandidate } from "../src/scan-split-finite-candidate";

it("keeps both sides of a plane cut that passes near a source corner", () => {
  const source = new Float32Array([-0.0004, 0, 0, 1, 0, 0, 1, 1, 0]);
  const cutter = new Float32Array([0, -2, -2, 0, 4, -2, 0, -2, 4]);
  const result = runFiniteSplitCandidate(source, cutter, undefined, {
    preciseCoordinates: true,
  });
  expect(result.diagnostics.cutEdges).toBeGreaterThan(0);
  expect(result.segments).toHaveLength(2);
  const ranges = result.segments.map((part) => {
    const x = Array.from(part).filter((_, index) => index % 3 === 0);
    return [Math.min(...x), Math.max(...x)];
  });
  expect(ranges.every(([min, max]) => max <= 1e-8 || min >= -1e-8)).toBe(true);
  expect(ranges.some(([, max]) => max <= 1e-8)).toBe(true);
  expect(ranges.some(([min]) => min >= -1e-8)).toBe(true);
});

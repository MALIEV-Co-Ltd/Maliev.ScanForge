import { describe, it, expect } from "vitest";
import { shiftShrinkwrapTriangles } from "../src/scan-shrinkwrap-field";
import { ShrinkwrapSurface } from "../src/scan-shrinkwrap-surface";
describe("continuous finite-facet capsule field", () => {
  it("keeps the captured plane fixed while retaining finite inward backing", () => {
    const p = new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, 0]);
    const shifted = shiftShrinkwrapTriangles(p, 0.375, {});
    const surface = new ShrinkwrapSurface(shifted, {});
    try {
      expect(surface.distance([1, 1, 0]) - 0.375).toBeCloseTo(0);
      expect(surface.distance([1, 1, -0.75]) - 0.375).toBeCloseTo(0);
      expect(surface.distance([1, 1, -0.3]) - 0.375).toBeLessThan(0);
      expect(surface.distance([1, 1, 0.2]) - 0.575).toBeCloseTo(0);
      expect(Array.from(p).filter((_, i) => i % 3 === 2)).toEqual([0, 0, 0]);
    } finally {
      surface.dispose();
    }
  });
});

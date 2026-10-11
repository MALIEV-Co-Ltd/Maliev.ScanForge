import { describe, expect, it } from "vitest";
import {
  alignmentTriangleMask,
  sampleAlignmentRegion,
} from "../src/registration-selection";
import { applyRigidTransform, registerIcp } from "../src/registration";

const scan = new Float32Array([
  0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 4, 1, 2, 3, -2, 0, 1, 100, 100, 100, 101,
  100, 100, 100, 101, 100,
]);
describe("priority-region fine alignment", () => {
  it("uses selected visible triangles and otherwise all visible triangles", () => {
    const selection = new Uint8Array([1, 1, 0]);
    expect([...alignmentTriangleMask(3, selection, [1])!]).toEqual([1, 0, 0]);
    expect([...alignmentTriangleMask(3, new Uint8Array(3), [2])!]).toEqual([
      1, 1, 0,
    ]);
    expect(alignmentTriangleMask(3, new Uint8Array(3))).toBeUndefined();
    expect([...selection]).toEqual([1, 1, 0]);
  });
  it("samples the region uniformly within the cap without copying the full mesh", () => {
    expect([
      ...sampleAlignmentRegion(scan, new Uint8Array([1, 1, 0]), 4),
    ]).toEqual([0, 0, 0, 3, 0, 0, 0, 0, 4, 1, 2, 3]);
    expect(
      sampleAlignmentRegion(scan, new Uint8Array([0, 0, 1]), 100),
    ).toHaveLength(9);
  });
  it("derives a rigid fit only from the region and moves unselected triangles too", () => {
    const target = Array.from(
      scan.slice(0, 18),
      (value, index) => value + [0.05, -0.04, 0.03][index % 3],
    );
    const result = registerIcp(scan, target, {
      sourceTriangleMask: new Uint8Array([1, 1, 0]),
      trimFraction: 1,
      maxDistance: 1,
      tolerance: 1e-8,
      sampleSize: 100,
      targetSampleSize: 100,
    });
    expect(result.pairs).toBe(6);
    expect(result.rms).toBeLessThan(1e-7);
    const output = applyRigidTransform(scan, result.transform);
    expect(output).toHaveLength(scan.length);
    output.forEach((value, index) =>
      expect(value).toBeCloseTo(
        scan[index] + [0.05, -0.04, 0.03][index % 3],
        4,
      ),
    );
    expect(scan[18]).toBe(100);
    expect(target[0]).toBe(0.05);
  });
  it("rejects stale, malformed and invisible regions", () => {
    expect(() => alignmentTriangleMask(3, new Uint8Array(2))).toThrow(
      "does not match",
    );
    expect(() => sampleAlignmentRegion(scan, new Uint8Array(3), 10)).toThrow(
      "No visible",
    );
    expect(() =>
      sampleAlignmentRegion(scan, new Uint8Array([1, 2, 0]), 10),
    ).toThrow("Invalid");
    expect(() =>
      sampleAlignmentRegion(scan, new Uint8Array([1, 0, 0]), 2),
    ).toThrow("at least three");
  });
});

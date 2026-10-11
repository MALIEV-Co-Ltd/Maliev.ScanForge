import { describe, expect, it } from "vitest";
import { deriveTriangleFieldCenters } from "../src/field-face-centers";

describe("recovered triangle face centers", () => {
  it("promotes coordinates and averages in double before storing float", () => {
    const positions = new Float32Array([1e10, 0, 0, -1e10, 3, 0, 3, 0, 6]);
    const result = deriveTriangleFieldCenters(
      positions,
      new Uint32Array([0, 1, 2]),
    );
    expect([...result]).toEqual([1, 1, 2]);
    result.fill(9);
    expect(positions[1]).toBe(0);
  });
  it("handles finite large vertices without overflowing float intermediate sums", () => {
    const positions = new Float32Array([3e38, 0, 0, 3e38, 0, 0, 3e38, 0, 0]);
    expect(
      deriveTriangleFieldCenters(positions, new Uint32Array([0, 1, 2]))[0],
    ).toBe(positions[0]);
    expect(
      deriveTriangleFieldCenters(new Float32Array(), new Uint32Array()).length,
    ).toBe(0);
  });
  it("rejects invalid geometry", () => {
    expect(() =>
      deriveTriangleFieldCenters(new Float32Array([0]), new Uint32Array()),
    ).toThrow(/dimensions/);
    expect(() =>
      deriveTriangleFieldCenters(
        new Float32Array(3),
        new Uint32Array([0, 0, 1]),
      ),
    ).toThrow(/vertex/);
    expect(() =>
      deriveTriangleFieldCenters(
        new Float32Array([Infinity, 0, 0]),
        new Uint32Array([0, 0, 0]),
      ),
    ).toThrow(/finite/);
  });
});

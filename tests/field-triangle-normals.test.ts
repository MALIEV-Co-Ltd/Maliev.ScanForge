import { describe, expect, it } from "vitest";
import { buildTriangleNormalCache } from "../src/field-triangle-normals";
import { deriveTriangleFieldNormals } from "../src/field-face-normals";
import { buildTriangleFieldFrames } from "../src/field-triangle-frames";

describe("recovered triangle-storage normal cache", () => {
  it("produces ordered normals, cross lengths and area for both windings", () => {
    const result = buildTriangleNormalCache(
      new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
      new Uint32Array([0, 1, 2, 0, 2, 1]),
    );
    expect(Array.from(result.normals)).toEqual([0, 0, 1, 0, 0, -1]);
    expect(Array.from(result.crossLengths)).toEqual([6, 6]);
    expect(result.surfaceArea).toBe(6);
  });
  it("uses double normalization for a tilted face and feeds field frames", () => {
    const positions = new Float32Array([0, 0, 0, 1, -1, 0, 1, 0, -1]);
    const triangles = new Uint32Array([0, 1, 2]);
    const result = buildTriangleNormalCache(positions, triangles);
    expect(Array.from(result.normals)).toEqual(
      Array(3).fill(Math.fround(1 / Math.sqrt(3))),
    );
    expect(result.crossLengths[0]).toBe(Math.fround(Math.sqrt(3)));
    expect(result.surfaceArea).toBe(
      Math.fround(Math.fround(Math.sqrt(3)) * 0.5),
    );
    const frames = buildTriangleFieldFrames(
      positions,
      triangles,
      result.normals,
    );
    expect(frames.edgeLengths[0]).toBe(Math.fround(Math.sqrt(2)));
    expect(frames.bitangents.every(Number.isFinite)).toBe(true);
  });
  it("normalizes tiny nonzero faces even when stored cross lengths underflow", () => {
    const positions = new Float32Array([0, 0, 0, 1e-40, 0, 0, 0, 1e-40, 0]);
    const result = buildTriangleNormalCache(
      positions,
      new Uint32Array([0, 1, 2, 0, 0, 0]),
    );
    expect(Array.from(result.normals)).toEqual([0, 0, 1, 0, 0, 0]);
    expect(Array.from(result.crossLengths)).toEqual([0, 0]);
    expect(result.surfaceArea).toBe(0);
  });
  it("handles a scale where the polygon path's float squared length overflows", () => {
    const positions = new Float32Array([0, 0, 0, 1e10, 0, 0, 0, 1e10, 0]);
    const triangles = new Uint32Array([0, 1, 2]);
    expect(() => deriveTriangleFieldNormals(positions, triangles)).toThrow(
      /overflow/,
    );
    const result = buildTriangleNormalCache(positions, triangles);
    expect(Array.from(result.normals)).toEqual([0, 0, 1]);
    expect(result.crossLengths[0]).toBe(Math.fround(1e20));
  });
  it("rounds each face contribution before sequential float accumulation", () => {
    const result = buildTriangleNormalCache(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 16777216, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2, 0, 1, 3]),
    );
    expect(Array.from(result.crossLengths)).toEqual([16777216, 1]);
    expect(result.surfaceArea).toBe(8388608);
  });
  it("owns empty outputs and rejects malformed, nonfinite, invalid or overflowing inputs", () => {
    const positions = new Float32Array();
    const result = buildTriangleNormalCache(positions, new Uint32Array());
    expect(result.normals).not.toBe(positions);
    expect(result.surfaceArea).toBe(0);
    expect(() =>
      buildTriangleNormalCache(new Float32Array(2), new Uint32Array()),
    ).toThrow(/dimensions/);
    expect(() =>
      buildTriangleNormalCache(
        new Float32Array([Infinity, 0, 0]),
        new Uint32Array(),
      ),
    ).toThrow(/finite/);
    expect(() =>
      buildTriangleNormalCache(new Float32Array(3), new Uint32Array([0, 0, 1])),
    ).toThrow(/vertex/);
    expect(() =>
      buildTriangleNormalCache(
        new Float32Array([0, 0, 0, 1e20, 0, 0, 0, 1e20, 0]),
        new Uint32Array([0, 1, 2]),
      ),
    ).toThrow(/overflow/);
  });
});

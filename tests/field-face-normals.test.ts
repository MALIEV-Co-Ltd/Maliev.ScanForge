import { describe, expect, it } from "vitest";
import { deriveTriangleFieldNormals } from "../src/field-face-normals";
import { buildTriangleFieldFrames } from "../src/field-triangle-frames";

describe("recovered triangle face normals", () => {
  it("respects winding and keeps faces separate", () => {
    const result = deriveTriangleFieldNormals(
      new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
      new Uint32Array([0, 1, 2, 0, 2, 1]),
    );
    expect(Array.from(result.normals)).toEqual([0, 0, 1, 0, 0, -1]);
    expect(Array.from(result.degenerateFaces)).toEqual([0, 0]);
  });
  it("normalizes a tilted plane using a float length and double reciprocal", () => {
    const result = deriveTriangleFieldNormals(
      new Float32Array([0, 0, 0, 1, -1, 0, 1, 0, -1]),
      new Uint32Array([0, 1, 2]),
    );
    const component = Math.fround(1 / Math.fround(Math.sqrt(3)));
    expect(Array.from(result.normals)).toEqual([
      component,
      component,
      component,
    ]);
  });
  it("retains tiny unnormalized normals and marks degenerate faces", () => {
    const positions = new Float32Array([0, 0, 0, 1e-15, 0, 0, 0, 1e-15, 0]);
    const result = deriveTriangleFieldNormals(
      positions,
      new Uint32Array([0, 1, 2, 0, 0, 0]),
    );
    expect(result.normals[2]).toBe(Math.fround(positions[3] * positions[7]));
    expect(Array.from(result.degenerateFaces)).toEqual([1, 1]);
    expect(Array.from(result.normals.slice(3))).toEqual([0, 0, 0]);
  });
  it("feeds recovered field frames for a scan translated far from the origin", () => {
    const positions = new Float32Array([
      1e6,
      2e6,
      3e6,
      1e6 + 2,
      2e6,
      3e6,
      1e6,
      2e6 + 3,
      3e6,
    ]);
    const triangles = new Uint32Array([0, 1, 2]);
    const normals = deriveTriangleFieldNormals(positions, triangles).normals;
    const frames = buildTriangleFieldFrames(positions, triangles, normals);
    expect(Array.from(normals)).toEqual([0, 0, 1]);
    expect(Array.from(frames.tangents)).toEqual([1, 0, 0]);
    expect(Array.from(frames.bitangents)).toEqual([0, 1, 0]);
    expect(Array.from(frames.edgeLengths)).toEqual([2]);
  });
  it("handles empty inputs without aliasing and rejects malformed or overflowing geometry", () => {
    const positions = new Float32Array();
    const result = deriveTriangleFieldNormals(positions, new Uint32Array());
    expect(result.normals).not.toBe(positions);
    expect(result.normals.length).toBe(0);
    expect(() =>
      deriveTriangleFieldNormals(new Float32Array(2), new Uint32Array()),
    ).toThrow(/dimensions/);
    expect(() =>
      deriveTriangleFieldNormals(
        new Float32Array([NaN, 0, 0]),
        new Uint32Array(),
      ),
    ).toThrow(/finite/);
    expect(() =>
      deriveTriangleFieldNormals(
        new Float32Array(3),
        new Uint32Array([0, 0, 1]),
      ),
    ).toThrow(/vertex/);
    expect(() =>
      deriveTriangleFieldNormals(
        new Float32Array([0, 0, 0, 1e20, 0, 0, 0, 1e20, 0]),
        new Uint32Array([0, 1, 2]),
      ),
    ).toThrow(/overflow/);
  });
});

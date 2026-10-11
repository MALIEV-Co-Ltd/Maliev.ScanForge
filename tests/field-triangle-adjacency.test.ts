import { describe, expect, it } from "vitest";
import { buildTriangleAdjacency } from "../src/field-triangle-adjacency";
import { buildTriangleNormalCache } from "../src/field-triangle-normals";
import { buildTriangleFieldFrames } from "../src/field-triangle-frames";
import { deriveFieldTransportAngles } from "../src/field-angle-transport";

describe("recovered triangle adjacency", () => {
  it("numbers edges by ascending vertex rather than face traversal", () => {
    const result = buildTriangleAdjacency(3, new Uint32Array([2, 0, 1]));
    expect(Array.from(result.vertexOffsets)).toEqual([0, 1, 2, 3]);
    expect(Array.from(result.vertexHalfedges)).toEqual([1, 2, 0]);
    expect(Array.from(result.faceEdges)).toEqual([1, 0, 2]);
    expect(Array.from(result.edgeVertices)).toEqual([0, 1, 0, 2, 1, 2]);
    expect(Array.from(result.halfedges)).toEqual([1, 0, 2]);
  });
  it("retains shared edge IDs and ascending halfedge incidence", () => {
    const result = buildTriangleAdjacency(
      4,
      new Uint32Array([0, 1, 2, 2, 1, 3]),
    );
    expect(Array.from(result.faceEdges)).toEqual([0, 2, 1, 2, 3, 4]);
    expect(Array.from(result.edgeVertices)).toEqual([
      0, 1, 0, 2, 1, 2, 1, 3, 2, 3,
    ]);
    expect(Array.from(result.edgeOffsets)).toEqual([0, 1, 2, 4, 5, 6]);
    expect(Array.from(result.halfedges)).toEqual([0, 2, 1, 3, 4, 5]);
  });
  it("keeps next-before-previous order and supports unused vertices", () => {
    const result = buildTriangleAdjacency(7, new Uint32Array([2, 5, 4]));
    expect(Array.from(result.edgeVertices)).toEqual([2, 5, 2, 4, 4, 5]);
    expect(Array.from(result.faceEdges)).toEqual([0, 2, 1]);
    expect(Array.from(result.vertexOffsets)).toEqual([0, 0, 0, 1, 1, 2, 3, 3]);
  });
  it("retains nonmanifold incidence instead of collapsing duplicate faces", () => {
    const result = buildTriangleAdjacency(
      3,
      new Uint32Array([0, 1, 2, 0, 1, 2, 0, 1, 2]),
    );
    expect(Array.from(result.edgeOffsets)).toEqual([0, 3, 6, 9]);
    expect(Array.from(result.halfedges)).toEqual([0, 3, 6, 2, 5, 8, 1, 4, 7]);
  });
  it("preserves self-edge sentinels and the zero-filled unused incidence tail", () => {
    const result = buildTriangleAdjacency(2, new Uint32Array([0, 0, 1]));
    expect(Array.from(result.faceEdges)).toEqual([-1, 0, 0]);
    expect(Array.from(result.edgeVertices)).toEqual([0, 1]);
    expect(Array.from(result.edgeOffsets)).toEqual([0, 2]);
    expect(Array.from(result.halfedges)).toEqual([1, 2, 0]);
    const collapsed = buildTriangleAdjacency(1, new Uint32Array([0, 0, 0]));
    expect(Array.from(collapsed.faceEdges)).toEqual([-1, -1, -1]);
    expect(Array.from(collapsed.edgeOffsets)).toEqual([0]);
  });
  it("feeds scan-derived normals and frames into adjacent-face angle transport", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1]);
    const triangles = new Uint32Array([0, 1, 2, 2, 1, 3]);
    const adjacency = buildTriangleAdjacency(4, triangles);
    const { normals } = buildTriangleNormalCache(positions, triangles);
    const { tangents } = buildTriangleFieldFrames(
      positions,
      triangles,
      normals,
    );
    const angles = deriveFieldTransportAngles(
      normals,
      tangents,
      adjacency.edgeOffsets,
      adjacency.halfedges,
    );
    expect(angles.length).toBe(5);
    expect(angles.every(Number.isFinite)).toBe(true);
    expect(Array.from(angles).filter((_, edge) => edge !== 2)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(Math.abs(angles[2])).toBeGreaterThan(0.1);
  });
  it("owns empty arrays and rejects invalid dimensions and vertices", () => {
    const input = new Uint32Array();
    const result = buildTriangleAdjacency(0, input);
    expect(result.halfedges).not.toBe(input);
    expect(Array.from(result.vertexOffsets)).toEqual([0]);
    expect(() => buildTriangleAdjacency(-1, input)).toThrow(/dimensions/);
    expect(() => buildTriangleAdjacency(1.5, input)).toThrow(/dimensions/);
    expect(() => buildTriangleAdjacency(3, new Uint32Array([0]))).toThrow(
      /dimensions/,
    );
    expect(() => buildTriangleAdjacency(2, new Uint32Array([0, 1, 2]))).toThrow(
      /vertex/,
    );
  });
});

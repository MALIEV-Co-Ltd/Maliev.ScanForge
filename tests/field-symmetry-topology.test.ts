import { describe, expect, it } from "vitest";
import { deriveTriangleSymmetryTopology } from "../src/field-symmetry-topology";
import { buildTriangleNormalCache } from "../src/field-triangle-normals";
import { buildTriangleFieldFrames } from "../src/field-triangle-frames";
const triangles = new Uint32Array([0, 1, 2, 5, 4, 3]);
const mapping = new Int32Array([3, 4, 5, 0, 1, 2]);
describe("recovered triangle symmetry topology", () => {
  it("pairs reflected faces independent of winding and preserves native edge IDs", () => {
    const result = deriveTriangleSymmetryTopology(triangles, mapping);
    expect(Array.from(result.facePartners)).toEqual([1, 0]);
    expect(Array.from(result.edgePartners)).toEqual([4, 3, 5, 1, 0, 2]);
    expect(result.mappedFaceCount).toBe(2);
    expect(Array.from(result.faceStatus)).toEqual([0, 0]);
    expect(Array.from(result.referenceEdges)).toEqual([1, 1]);
    expect(Array.from(result.directionEdges)).toEqual([1, 1]);
  });
  it("uses default frame edges for the masked side", () => {
    const result = deriveTriangleSymmetryTopology(triangles, mapping, {
      bits: new Uint8Array([7]),
      bitCount: 6,
    });
    expect(Array.from(result.faceStatus)).toEqual([1, 0]);
    expect(Array.from(result.directionEdges)).toEqual([0, 1]);
  });
  it("classifies balanced and unbalanced changed-vertex masks without counting identity vertices", () => {
    const self = new Uint32Array([0, 1, 2]);
    const swapped = new Int32Array([1, 0, 2]);
    const balanced = deriveTriangleSymmetryTopology(self, swapped, {
      bits: new Uint8Array([1]),
      bitCount: 3,
    });
    expect(balanced.faceStatus[0]).toBe(2);
    expect(balanced.mappedFaceCount).toBe(1);
    const mixed = deriveTriangleSymmetryTopology(triangles, mapping, {
      bits: new Uint8Array([1]),
      bitCount: 6,
    });
    expect(mixed.faceStatus[0]).toBe(-1);
    const identity = deriveTriangleSymmetryTopology(
      self,
      new Int32Array([0, 1, 2]),
    );
    expect(identity.faceStatus[0]).toBe(-1);
  });
  it("preserves first-incident-face lookup and overwrite behavior for duplicates", () => {
    const result = deriveTriangleSymmetryTopology(
      new Uint32Array([0, 1, 2, 0, 1, 2]),
      new Int32Array([0, 1, 2]),
    );
    expect(Array.from(result.facePartners)).toEqual([1, 0]);
    expect(result.mappedFaceCount).toBe(3);
    expect(Array.from(result.edgePartners)).toEqual([0, 1, 2]);
  });
  it("retains missing partners and safely handles collapsed faces", () => {
    const result = deriveTriangleSymmetryTopology(
      new Uint32Array([0, 1, 2]),
      new Int32Array([0, 1, -1]),
    );
    expect(result.facePartners[0]).toBe(-1);
    expect(Array.from(result.edgePartners)).toEqual([0, -1, -1]);
    expect(result.directionEdges[0]).toBe(0);
    const collapsed = deriveTriangleSymmetryTopology(
      new Uint32Array([0, 0, 0]),
      new Int32Array([0]),
    );
    expect(collapsed.facePartners[0]).toBe(-1);
  });
  it("feeds recovered reference edges into scan-derived normal and frame production", () => {
    const positions = new Float32Array([
      -1, 0, 0, -1, 2, 0, -1, 0, 3, 1, 0, 0, 1, 2, 0, 1, 0, 3,
    ]);
    const result = deriveTriangleSymmetryTopology(triangles, mapping);
    const { normals } = buildTriangleNormalCache(positions, triangles);
    const frames = buildTriangleFieldFrames(
      positions,
      triangles,
      normals,
      result.directionEdges,
    );
    expect(Array.from(frames.edgeLengths)).toEqual([
      Math.fround(Math.sqrt(13)),
      2,
    ]);
    expect(frames.tangents[0]).toBe(0);
    expect(frames.tangents[1]).toBeLessThan(0);
    expect(frames.tangents[2]).toBeGreaterThan(0);
  });
  it("owns empty outputs and validates bounded masks, mappings and indices", () => {
    const input = new Int32Array();
    const result = deriveTriangleSymmetryTopology(new Uint32Array(), input);
    expect(result.facePartners).not.toBe(input);
    expect(result.mappedFaceCount).toBe(0);
    expect(() =>
      deriveTriangleSymmetryTopology(
        triangles,
        new Int32Array([9, 0, 0, 0, 0, 0]),
      ),
    ).toThrow(/vertex/);
    expect(() =>
      deriveTriangleSymmetryTopology(triangles, mapping, {
        bits: new Uint8Array(),
        bitCount: 1,
      }),
    ).toThrow(/mask/);
    expect(() =>
      deriveTriangleSymmetryTopology(new Uint32Array([0, 1, 6]), mapping),
    ).toThrow(/vertex/);
  });
});

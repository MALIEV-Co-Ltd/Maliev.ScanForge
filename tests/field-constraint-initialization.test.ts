import { describe, expect, it } from "vitest";
import {
  initializeDefaultFieldConstraints,
  type FieldConstraintTransfer,
} from "../src/field-constraint-initialization";
import { buildTriangleAdjacency } from "../src/field-triangle-adjacency";
import { deriveTriangleFieldCenters } from "../src/field-face-centers";
import { deriveFieldConnectionPool } from "../src/field-connection-pool";
function transfer(): FieldConstraintTransfer {
  return {
    targets: new Int32Array([1, 2, -1]),
    eligibleTargets: { bits: new Uint8Array([6]), bitCount: 3 },
    lanes: [
      new Uint32Array([0x7fc01234, 20, 30]),
      new Uint32Array([100, 200, 300]),
    ],
    flags: new Uint8Array([4, 8, 16]),
  };
}
describe("recovered default field constraint initialization", () => {
  it("uses an inclusive 500 threshold and packs face bits across byte boundaries", () => {
    const result = initializeDefaultFieldConstraints(
      new Float32Array([499.99, 500, 501, 0, 0, 0, 0, 0, 500]),
    );
    expect(Array.from(result.fixedFaces.bits)).toEqual([6, 1]);
    expect(result.fixedFaces.bitCount).toBe(9);
    expect(result.fixedCount).toBe(3);
  });
  it("fixes the first face only when no supplied strength qualifies", () => {
    const input = new Float32Array([1, 2, 3]);
    const result = initializeDefaultFieldConstraints(input);
    expect(Array.from(result.strengths)).toEqual([500, 2, 3]);
    expect(Array.from(result.fixedFaces.bits)).toEqual([1]);
    expect(Array.from(input)).toEqual([1, 2, 3]);
  });
  it("transfers raw lanes and flags sequentially after fixed-mask production", () => {
    const mapping = transfer();
    const result = initializeDefaultFieldConstraints(
      new Float32Array([700, 0, 0]),
      mapping,
    );
    expect(Array.from(result.strengths)).toEqual([700, 700, 700]);
    expect(Array.from(result.fixedFaces.bits)).toEqual([1]);
    expect(Array.from(result.lanes![0])).toEqual([
      0x7fc01234, 0x7fc01234, 0x7fc01234,
    ]);
    expect(Array.from(result.lanes![1])).toEqual([100, 100, 100]);
    expect(Array.from(result.flags!)).toEqual([4, 10, 18]);
    expect(Array.from(mapping.flags)).toEqual([4, 8, 16]);
    expect(mapping.lanes[0][1]).toBe(20);
  });
  it("retains later overwrite order for repeated targets and respects bounded eligibility", () => {
    const mapping = transfer();
    mapping.targets.set([2, 2, -1]);
    const result = initializeDefaultFieldConstraints(
      new Float32Array([700, 600, 0]),
      mapping,
    );
    expect(result.strengths[2]).toBe(600);
    expect(result.lanes![0][2]).toBe(20);
    expect(Array.from(result.fixedFaces.bits)).toEqual([3]);
    mapping.eligibleTargets.bitCount = 1;
    mapping.eligibleTargets.bits[0] = 255;
    const bounded = initializeDefaultFieldConstraints(
      new Float32Array([700, 600, 0]),
      mapping,
    );
    expect(bounded.strengths[2]).toBe(0);
    expect(bounded.flags![2]).toBe(16);
  });
  it("feeds initialized seed bits and scan-derived adjacency into connection-pool production", () => {
    const triangles = new Uint32Array([0, 1, 2, 2, 1, 3]);
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    const adjacency = buildTriangleAdjacency(4, triangles);
    const initialized = initializeDefaultFieldConstraints(new Float32Array(2));
    const pool = deriveFieldConnectionPool(
      deriveTriangleFieldCenters(positions, triangles),
      new Uint32Array(adjacency.faceEdges),
      adjacency.edgeOffsets,
      adjacency.halfedges,
      initialized.fixedFaces,
    );
    expect(pool.distances[0]).toBe(0);
    expect(pool.distances[1]).toBeGreaterThan(0);
    expect(pool.predecessorEdges[1]).toBe(2);
  });
  it("owns empty results and rejects malformed strengths and mapping inputs", () => {
    const result = initializeDefaultFieldConstraints(new Float32Array());
    expect(result.fixedCount).toBe(0);
    expect(result.fixedFaces.bitCount).toBe(0);
    expect(() =>
      initializeDefaultFieldConstraints(new Float32Array([NaN])),
    ).toThrow(/finite/);
    const mapping = transfer();
    mapping.targets[0] = 3;
    expect(() =>
      initializeDefaultFieldConstraints(new Float32Array(3), mapping),
    ).toThrow(/target/);
    expect(() =>
      initializeDefaultFieldConstraints(new Float32Array(2), transfer()),
    ).toThrow(/dimensions/);
  });
});

import { describe, expect, it } from "vitest";
import { matchAxisVertexSymmetry } from "../src/field-vertex-symmetry";
import { deriveTriangleSymmetryTopology } from "../src/field-symmetry-topology";

describe("recovered axis vertex symmetry matcher", () => {
  it.each([0, 1, 2] as const)(
    "reflects the chosen axis %s and marks all positive-side vertices",
    (axis) => {
      const positions = new Float32Array(6);
      positions[axis] = -1;
      positions[3 + axis] = 1;
      const result = matchAxisVertexSymmetry(
        positions,
        axis,
        0,
        0.1,
        new Uint32Array([0, 1]),
      );
      expect(result.completed).toBe(true);
      expect(Array.from(result.partners)).toEqual([1, 0]);
      expect(result.mappedVertexCount).toBe(2);
      expect(result.positiveSide.bitCount).toBe(2);
      expect(Array.from(result.positiveSide.bits)).toEqual([2]);
    },
  );
  it("chooses the closest candidate inside the strict ordinary distance threshold", () => {
    const positions = new Float32Array([-1, 0, 0, 1, 0.2, 0, 1, 0.1, 0]);
    const result = matchAxisVertexSymmetry(
      positions,
      0,
      0,
      0.5,
      new Uint32Array([0, 1, 2]),
    );
    expect(Array.from(result.partners)).toEqual([2, -1, 0]);
    expect(result.mappedVertexCount).toBe(2);
    expect(Array.from(result.positiveSide.bits)).toEqual([6]);
    const boundary = matchAxisVertexSymmetry(
      new Float32Array([-1, 0, 0, 1, 0.5, 0]),
      0,
      0,
      0.5,
      new Uint32Array([0, 1]),
    );
    expect(Array.from(boundary.partners)).toEqual([-1, -1]);
    expect(boundary.mappedVertexCount).toBe(0);
  });
  it("accepts the first reverse-order very close match even when another candidate is closer", () => {
    const positions = new Float32Array([-1, 0, 0, 1, 0.001, 0, 1, 0.002, 0]);
    const result = matchAxisVertexSymmetry(
      positions,
      0,
      0,
      1,
      new Uint32Array([0, 1, 2]),
    );
    expect(Array.from(result.partners)).toEqual([2, 1, 0]);
    expect(result.mappedVertexCount).toBe(3);
  });
  it("retains caller tie order and positive-side self mapping near the plane", () => {
    const positions = new Float32Array([-1, 0, 0, 1, 0.2, 0, 1, -0.2, 0]);
    const forward = matchAxisVertexSymmetry(
      positions,
      0,
      0,
      0.5,
      new Uint32Array([0, 1, 2]),
    );
    const reversed = matchAxisVertexSymmetry(
      positions,
      0,
      0,
      0.5,
      new Uint32Array([0, 2, 1]),
    );
    expect(Array.from(forward.partners)).toEqual([2, -1, 0]);
    expect(Array.from(reversed.partners)).toEqual([1, 0, -1]);
    const near = matchAxisVertexSymmetry(
      new Float32Array([-0.3, 0, 0, 0.3, 10, 0]),
      0,
      0,
      0.5,
      new Uint32Array([0, 1]),
    );
    expect(Array.from(near.partners)).toEqual([-1, 1]);
    expect(near.mappedVertexCount).toBe(1);
  });
  it("keeps early acceptance strict and reuses the matching window across ascending sources", () => {
    const boundary = matchAxisVertexSymmetry(
      new Float32Array([-2, 0, 0, 2, 0.001, 0, 2, 0.005, 0]),
      0,
      0,
      1,
      new Uint32Array([0, 1, 2]),
    );
    expect(Array.from(boundary.partners)).toEqual([1, 0, -1]);
    const positions = new Float32Array([-3, 1, 0, -2, 2, 0, 2, 2, 0, 3, 1, 0]);
    const order = new Uint32Array([0, 1, 2, 3]);
    const original = positions.slice();
    const result = matchAxisVertexSymmetry(positions, 0, 0, 0.1, order);
    expect(Array.from(result.partners)).toEqual([3, 2, 1, 0]);
    expect(result.mappedVertexCount).toBe(4);
    expect(Array.from(result.positiveSide.bits)).toEqual([12]);
    expect(positions).toEqual(original);
    expect(Array.from(order)).toEqual([0, 1, 2, 3]);
  });
  it("uses the supplied plane coordinate and feeds vertex mappings into reflected topology", () => {
    const positions = new Float32Array([
      9, 0, 0, 9, 2, 0, 9, 0, 3, 11, 0, 0, 11, 2, 0, 11, 0, 3,
    ]);
    const result = matchAxisVertexSymmetry(
      positions,
      0,
      10,
      0.01,
      new Uint32Array([0, 1, 2, 3, 4, 5]),
    );
    expect(Array.from(result.partners)).toEqual([3, 4, 5, 0, 1, 2]);
    const topology = deriveTriangleSymmetryTopology(
      new Uint32Array([0, 1, 2, 5, 4, 3]),
      result.partners,
      result.positiveSide,
    );
    expect(Array.from(topology.facePartners)).toEqual([1, 0]);
    expect(Array.from(topology.faceStatus)).toEqual([0, 1]);
    expect(Array.from(topology.directionEdges)).toEqual([1, 0]);
  });
  it("preserves strict zero-distance threshold behavior and safely owns empty results", () => {
    const result = matchAxisVertexSymmetry(
      new Float32Array([0, 0, 0]),
      0,
      0,
      0,
      new Uint32Array([0]),
    );
    expect(result.partners[0]).toBe(-1);
    expect(result.completed).toBe(true);
    const empty = matchAxisVertexSymmetry(
      new Float32Array(),
      0,
      0,
      0,
      new Uint32Array(),
    );
    expect(empty.completed).toBe(false);
    expect(empty.partners.length).toBe(0);
    expect(empty.positiveSide.bitCount).toBe(0);
  });
  it("retains a non-monotonic supplied order instead of substituting a coordinate sort", () => {
    const result = matchAxisVertexSymmetry(
      new Float32Array([-1, 0, 0, 1, 0, 0]),
      0,
      0,
      1,
      new Uint32Array([1, 0]),
    );
    expect(Array.from(result.partners)).toEqual([-1, 1]);
    // The mask follows all ordinals after the first positive source.
    expect(Array.from(result.positiveSide.bits)).toEqual([3]);
  });
  it("rejects malformed permutations, nonfinite inputs and overflow", () => {
    const positions = new Float32Array([-1, 0, 0, 1, 0, 0]);
    expect(() =>
      matchAxisVertexSymmetry(positions, 0, 0, 1, new Uint32Array([0, 0])),
    ).toThrow(/permutation/);
    expect(() =>
      matchAxisVertexSymmetry(positions, 0, 0, -1, new Uint32Array([0, 1])),
    ).toThrow(/settings/);
    expect(() =>
      matchAxisVertexSymmetry(
        new Float32Array([NaN, 0, 0]),
        0,
        0,
        1,
        new Uint32Array([0]),
      ),
    ).toThrow(/finite/);
    expect(() =>
      matchAxisVertexSymmetry(positions, 0, 1e39, 1, new Uint32Array([0, 1])),
    ).toThrow(/overflow/);
  });
});

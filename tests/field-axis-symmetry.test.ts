import { describe, expect, it } from "vitest";
import { detectAxisVertexSymmetry } from "../src/field-axis-symmetry";
import { deriveTriangleSymmetryTopology } from "../src/field-symmetry-topology";

describe("recovered automatic axis symmetry selection", () => {
  it("accepts the first high-coverage axis and leaves later scores unvisited", () => {
    const positions = new Float32Array([0, 0, 0, 0, 3, 0, 0, 0, 4]);
    const result = detectAxisVertexSymmetry(positions);
    expect(result.axis).toBe(0);
    expect(result.coverage).toBe(1);
    expect(Array.from(result.axisScores)).toEqual([1, -1, -1]);
    expect(Array.from(result.center)).toEqual([0, 1.5, 2]);
    expect(result.tolerance).toBe(Math.fround(5 * Math.fround(0.0001)));
    expect(Array.from(result.mapping!.partners)).toEqual([0, 1, 2]);
    const topology = deriveTriangleSymmetryTopology(
      new Uint32Array([0, 1, 2]),
      result.mapping!.partners,
      result.mapping!.positiveSide,
    );
    expect(topology.mappedFaceCount).toBe(1);
  });
  it("uses native ordering without silently making it monotonic", () => {
    const result = detectAxisVertexSymmetry(
      new Float32Array([-1, 0, 0, 1, 0, 1]),
    );
    expect(result.axis).toBe(1);
    expect(Array.from(result.axisScores)).toEqual([0, 1, -1]);
    expect(Array.from(result.mapping!.partners)).toEqual([0, 1]);
  });
  it("keeps the first equal best score above the low cutoff", () => {
    const result = detectAxisVertexSymmetry(
      new Float32Array([0, 0, 0, -1, -1, -1, 1, 1, 1, 1, 1, 1, 0, 0, 0]),
    );
    expect(result.axis).toBe(0);
    expect(Array.from(result.axisScores)).toEqual(
      new Array(3).fill(Math.fround(0.4)),
    );
    expect(result.coverage).toBe(Math.fround(0.4));
    expect(Array.from(result.mapping!.partners)).toEqual([4, -1, -1, -1, 0]);
  });
  it("rejects scores exactly equal to the float low cutoff", () => {
    const positions = new Float32Array(30);
    for (let vertex = 1; vertex < 9; vertex++)
      positions.fill(vertex % 2 ? -1 : 1, vertex * 3, vertex * 3 + 3);
    const result = detectAxisVertexSymmetry(positions);
    expect(Array.from(result.axisScores)).toEqual(
      new Array(3).fill(Math.fround(0.2)),
    );
    expect(result.axis).toBeNull();
    expect(result.mapping).toBeNull();
    expect(result.coverage).toBe(0);
  });
  it("does not early accept a score equal to float 0.95", () => {
    const positions = new Float32Array(60);
    positions.set([1, 0, 0, -1, 10, 0]);
    const result = detectAxisVertexSymmetry(positions, 1);
    expect(result.axisScores[0]).toBe(Math.fround(0.95));
    expect(result.axisScores[1]).toBe(0);
    expect(result.axisScores[2]).toBe(1);
    expect(result.axis).toBe(2);
    expect(result.coverage).toBe(1);
  });
  it("floors degenerate tolerance, owns empty outputs and rejects invalid arithmetic", () => {
    const result = detectAxisVertexSymmetry(new Float32Array([0, 0, 0]));
    expect(result.tolerance).toBe(Math.fround(1e-19));
    expect(result.axis).toBe(0);
    const empty = detectAxisVertexSymmetry(new Float32Array());
    expect(empty.axis).toBeNull();
    expect(Array.from(empty.axisScores)).toEqual([-1, -1, -1]);
    expect(() => detectAxisVertexSymmetry(new Float32Array([1]))).toThrow(
      /vertices/,
    );
    expect(() =>
      detectAxisVertexSymmetry(new Float32Array([Infinity, 0, 0])),
    ).toThrow(/finite/);
    expect(() =>
      detectAxisVertexSymmetry(new Float32Array([3e38, 0, 0])),
    ).toThrow(/overflow/);
    expect(() => detectAxisVertexSymmetry(new Float32Array(), -1)).toThrow(
      /tolerance/,
    );
  });
});

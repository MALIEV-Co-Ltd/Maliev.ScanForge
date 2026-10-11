import { describe, expect, it } from "vitest";
import { buildTriangleFieldFrames } from "../src/field-triangle-frames";

const vertices = () => new Float32Array([10, 20, 30, 13, 20, 30, 10, 24, 30]);

describe("recovered triangle field frames", () => {
  it("derives the default frame from the first directed edge and face normal", () => {
    const result = buildTriangleFieldFrames(
      vertices(),
      new Uint32Array([0, 1, 2]),
      new Float32Array([0, 0, 1]),
    );
    expect([...result.tangents]).toEqual([1, 0, 0]);
    expect([...result.bitangents]).toEqual([0, 1, 0]);
    expect([...result.edgeLengths]).toEqual([3]);
  });

  it("uses each supplied reference edge, including the closing edge direction", () => {
    const result = buildTriangleFieldFrames(
      vertices(),
      new Uint32Array([0, 1, 2, 0, 1, 2, 0, 1, 2]),
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      new Uint8Array([0, 1, 2]),
    );
    expect([...result.edgeLengths]).toEqual([3, 5, 4]);
    expect(result.tangents[3]).toBeCloseTo(-0.6);
    expect(result.tangents[4]).toBeCloseTo(0.8);
    expect([...result.tangents.slice(6)]).toEqual([0, -1, 0]);
    expect([...result.bitangents.slice(6)]).toEqual([1, 0, -0]);
  });

  it("preserves orientation under translations and inverted normals", () => {
    const moved = vertices().map(
      (value, index) => value + [100, -20, 7][index % 3],
    );
    const result = buildTriangleFieldFrames(
      moved,
      new Uint32Array([0, 1, 2]),
      new Float32Array([0, 0, -2]),
    );
    expect([...result.tangents]).toEqual([1, 0, 0]);
    expect([...result.bitangents]).toEqual([0, -1, 0]);
  });

  it("retains zero and subnormalization-length edges without fabricating a direction", () => {
    const result = buildTriangleFieldFrames(
      new Float32Array([0, 0, 0, 0, 0, 0, 1e-25, 0, 0]),
      new Uint32Array([0, 1, 2, 0, 1, 2]),
      new Float32Array([0, 0, 1, 0, 0, 1]),
      new Uint8Array([0, 1]),
    );
    expect([...result.tangents.slice(0, 3)]).toEqual([0, 0, 0]);
    expect(result.tangents[3]).toBe(new Float32Array([1e-25])[0]);
    expect(result.edgeLengths[0]).toBe(0);
  });

  it("returns independent arrays and supports an empty mesh", () => {
    const positions = vertices();
    const triangles = new Uint32Array([0, 1, 2]);
    const normals = new Float32Array([0, 0, 1]);
    const before = [...positions];
    const result = buildTriangleFieldFrames(positions, triangles, normals);
    result.tangents.fill(8);
    expect([...positions]).toEqual(before);
    expect([...triangles]).toEqual([0, 1, 2]);
    expect([...normals]).toEqual([0, 0, 1]);
    expect(
      buildTriangleFieldFrames(
        new Float32Array(),
        new Uint32Array(),
        new Float32Array(),
      ).edgeLengths.length,
    ).toBe(0);
  });

  it("rejects malformed geometry and float arithmetic overflow", () => {
    const run = (
      positions = vertices(),
      triangles = new Uint32Array([0, 1, 2]),
      normals = new Float32Array([0, 0, 1]),
      edges?: Uint8Array,
    ) => buildTriangleFieldFrames(positions, triangles, normals, edges);
    expect(() => run(new Float32Array([0]))).toThrow(/dimensions/);
    expect(() => run(undefined, new Uint32Array([0, 1, 3]))).toThrow(/vertex/);
    expect(() =>
      run(undefined, undefined, new Float32Array([0, NaN, 1])),
    ).toThrow(/finite/);
    expect(() =>
      run(undefined, undefined, undefined, new Uint8Array([3])),
    ).toThrow(/reference edge/);
    expect(() =>
      run(new Float32Array([3e38, 0, 0, -3e38, 0, 0, 0, 1, 0])),
    ).toThrow(/overflow/);
  });
});

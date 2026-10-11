import { describe, expect, it } from "vitest";
import {
  buildCurvatureEdgeData,
  applyCurvatureEdgeConstraints,
} from "../src/field-edge-curvature";
import { buildTriangleNormalCache } from "../src/field-triangle-normals";

const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
function fold(z = 1) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, z]);
  const normals = buildTriangleNormalCache(positions, triangles).normals;
  return {
    positions,
    normals,
    data: buildCurvatureEdgeData(positions, triangles, normals),
  };
}

describe("recovered edge curvature preparation", () => {
  it.each([1, -1])(
    "produces a signed fold and ordered double tensor for side %s",
    (z) => {
      const { data } = fold(z);
      expect(data.adjacency.edgeVertices.slice(0, 2)).toEqual(
        new Uint32Array([0, 1]),
      );
      expect(data.lengths[0]).toBe(1);
      expect(data.directions.slice(0, 3)).toEqual(new Float32Array([1, 0, 0]));
      const angle = Math.fround((-z * Math.PI) / 2);
      expect(data.angles[0]).toBe(angle);
      expect(data.tensors[0]).toBe(angle);
      expect(data.tensors.slice(1, 6).every((v) => v === 0)).toBe(true);
      expect(data.angles.slice(1).every((v) => v === 0)).toBe(true);
    },
  );

  it("handles scaled, zero and antiparallel supplied normals through the recovered angle branches", () => {
    const { positions } = fold();
    expect(
      buildCurvatureEdgeData(
        positions,
        triangles,
        new Float32Array([0, 0, 7, 0, 5, 0]),
      ).angles[0],
    ).toBe(Math.fround(-Math.PI / 2));
    expect(
      buildCurvatureEdgeData(
        positions,
        triangles,
        new Float32Array([0, 0, 1, 0, 0, -1]),
      ).angles[0],
    ).toBe(Math.fround(-Math.PI));
    expect(
      Object.is(
        buildCurvatureEdgeData(
          positions,
          triangles,
          new Float32Array([0, 0, 1, 0, 0, 0]),
        ).angles[0],
        -0,
      ),
    ).toBe(true);
  });

  it("retains negative zero for a coplanar two-face edge and zero for boundaries", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]);
    const data = buildCurvatureEdgeData(
      positions,
      triangles,
      buildTriangleNormalCache(positions, triangles).normals,
    );
    expect(Object.is(data.angles[0], -0)).toBe(true);
    expect(Object.is(data.tensors[0], -0)).toBe(true);
    expect(Object.is(data.angles[1], 0)).toBe(true);
  });

  it("uses double lengths, float reciprocal vectors, float weights and ordered double tensor products", () => {
    const positions = new Float32Array([0, 0, 0, 2, 3, 4, 1, 0, 0, 0, 1, 0]);
    const data = buildCurvatureEdgeData(
      positions,
      triangles,
      new Float32Array([0, 0, 1, 0, 1, 0]),
    );
    const length = Math.fround(Math.sqrt(29));
    const reciprocal = Math.fround(1 / length);
    const x = Math.fround(reciprocal * 2),
      y = Math.fround(reciprocal * 3),
      z = Math.fround(reciprocal * 4);
    const weight = Math.fround(length * Math.fround(-Math.PI / 2));
    expect(data.lengths[0]).toBe(length);
    expect(data.directions.slice(0, 3)).toEqual(new Float32Array([x, y, z]));
    expect(data.tensors.slice(0, 6)).toEqual(
      new Float64Array([
        x * weight * x,
        x * weight * y,
        x * weight * z,
        y * weight * y,
        y * weight * z,
        z * weight * z,
      ]),
    );
  });

  it("leaves nonmanifold edge angles zero and zero-length directions exactly zero", () => {
    const { positions, normals } = fold();
    const three = new Uint32Array([0, 1, 2, 1, 0, 3, 0, 1, 3]);
    const data = buildCurvatureEdgeData(
      positions,
      three,
      new Float32Array([...normals, 0, -1, 0]),
    );
    expect(data.adjacency.edgeOffsets[1]).toBe(3);
    expect(Object.is(data.angles[0], 0)).toBe(true);
    const zero = buildCurvatureEdgeData(
      new Float32Array(9),
      new Uint32Array([0, 1, 2]),
      new Float32Array(3),
    );
    expect(zero.lengths.every((v) => v === 0)).toBe(true);
    expect(zero.directions.every((v) => v === 0)).toBe(true);
    expect(zero.tensors.every((v) => v === 0)).toBe(true);
  });

  it("applies boundary edges in native edge order, replacing directions and flags", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const data = buildCurvatureEdgeData(
      positions,
      new Uint32Array([0, 1, 2]),
      new Float32Array([0, 0, 1]),
    );
    const initial = new Float32Array([7, 8, 9]);
    const flags = new Uint8Array([255]);
    const result = applyCurvatureEdgeConstraints(
      data,
      new Int32Array(),
      initial,
      flags,
      { boundaries: true, symmetry: false },
    );
    expect(result.directions).toEqual(data.directions.slice(-3));
    expect(result.flags[0]).toBe(9);
    expect(initial).toEqual(new Float32Array([7, 8, 9]));
    expect(flags[0]).toBe(255);
    expect(result.symmetryApplied).toBe(false);
  });

  it("applies self-mapped symmetry edges after boundaries to both incident faces", () => {
    const { data } = fold();
    const result = applyCurvatureEdgeConstraints(
      data,
      new Int32Array([0, 1, -1, -1]),
      new Float32Array(6),
      new Uint8Array([255, 255]),
      { boundaries: true, symmetry: true },
    );
    expect(result.flags).toEqual(new Uint8Array([13, 13]));
    expect(result.directions).toEqual(new Float32Array([1, 0, 0, 1, 0, 0]));
    expect(result.symmetryApplied).toBe(true);
    const empty = applyCurvatureEdgeConstraints(
      data,
      new Int32Array(),
      result.directions,
      result.flags,
      { boundaries: false, symmetry: true },
    );
    expect(empty.symmetryApplied).toBe(false);
    expect(empty.directions).toEqual(result.directions);
  });

  it("skips nonmanifold edges for boundaries but includes them for self-mapped symmetry", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const three = new Uint32Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const data = buildCurvatureEdgeData(
      positions,
      three,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    );
    const result = applyCurvatureEdgeConstraints(
      data,
      new Int32Array([0, 1, 2]),
      new Float32Array(9),
      new Uint8Array([5, 5, 5]),
      { boundaries: true, symmetry: false },
    );
    expect(result.flags).toEqual(new Uint8Array([5, 5, 5]));
    const symmetry = applyCurvatureEdgeConstraints(
      data,
      new Int32Array([0, 1, 2]),
      result.directions,
      result.flags,
      { boundaries: false, symmetry: true },
    );
    expect(symmetry.flags).toEqual(new Uint8Array([13, 13, 13]));
    expect(symmetry.directions).toEqual(
      new Float32Array([
        ...data.directions.slice(-3),
        ...data.directions.slice(-3),
        ...data.directions.slice(-3),
      ]),
    );
  });

  it("owns fresh arrays and rejects malformed or overflowing inputs", () => {
    const { positions, normals, data } = fold();
    expect(data.lengths).not.toBe(
      buildCurvatureEdgeData(positions, triangles, normals).lengths,
    );
    expect(() =>
      buildCurvatureEdgeData(positions, triangles, new Float32Array(3)),
    ).toThrow();
    expect(() =>
      buildCurvatureEdgeData(
        new Float32Array([NaN, 0, 0]),
        new Uint32Array(),
        new Float32Array(),
      ),
    ).toThrow();
    expect(() =>
      buildCurvatureEdgeData(
        new Float32Array([3e38, 0, 0, -3e38, 0, 0, 0, 1, 0]),
        new Uint32Array([0, 1, 2]),
        new Float32Array([0, 0, 1]),
      ),
    ).toThrow();
    expect(() =>
      applyCurvatureEdgeConstraints(
        data,
        new Int32Array([0]),
        new Float32Array(6),
        new Uint8Array(2),
        { boundaries: false, symmetry: true },
      ),
    ).toThrow();
    const empty = buildCurvatureEdgeData(
      new Float32Array(),
      new Uint32Array(),
      new Float32Array(),
    );
    expect(empty.tensors.length).toBe(0);
  });
});

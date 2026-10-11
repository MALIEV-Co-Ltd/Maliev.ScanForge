import { describe, expect, it } from "vitest";
import { deriveFieldTransportAngles } from "../src/field-angle-transport";
import { buildTriangleFieldFrames } from "../src/field-triangle-frames";
import { assembleFieldSystem } from "../src/field-system-assembly";
import { solveFieldLinearSystem } from "../src/field-linear-solver";

const angles = (normals: number[], tangents: number[]) =>
  deriveFieldTransportAngles(
    new Float32Array(normals),
    new Float32Array(tangents),
    new Uint32Array([0, 2]),
    new Uint32Array([0, 3]),
  );

describe("recovered adjacent-face transport", () => {
  it("feeds scan-derived transport into the recovered connection equations", () => {
    const normals = new Float32Array([0, 0, 1, 0, 0, 1]);
    const frames = buildTriangleFieldFrames(
      new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
      new Uint32Array([0, 1, 2, 2, 0, 1]),
      normals,
    );
    const transport = deriveFieldTransportAngles(
      normals,
      frames.tangents,
      new Uint32Array([0, 2]),
      new Uint32Array([0, 3]),
    );
    const assembled = assembleFieldSystem(
      2,
      [{ left: 0, right: 1, transportAngle: transport[0], quarterTurns: 0 }],
      2,
      [{ node: 0, angle: 0 }],
      [],
    );
    const solved = solveFieldLinearSystem(
      assembled.system,
      new Float64Array(1),
      {
        seedIndices: new Uint32Array([0]),
        relativeTolerance: 1e-10,
        maxIterations: 10,
        diagonalScaling: true,
      },
    );
    expect(solved.status).toBe("converged");
    expect(solved.solution[0]).toBe(-transport[0]);
    expect(assembled.system.coefficients[0] * solved.solution[0]).toBe(
      assembled.system.rightHandSide[0],
    );
  });
  it("measures and wraps planar angles with ordered incidence", () => {
    const normals = [0, 0, 1, 0, 0, 1];
    expect(angles(normals, [1, 0, 0, 1, 0, 0])[0]).toBe(0);
    expect(angles(normals, [1, 0, 0, 0, 1, 0])[0]).toBeCloseTo(Math.PI / 2, 6);
    expect(angles(normals, [1, 0, 0, 0, -1, 0])[0]).toBeCloseTo(
      -Math.PI / 2,
      6,
    );
    expect(angles(normals, [0, 1, 0, 1, 0, 0])[0]).toBeCloseTo(-Math.PI / 2, 6);
    expect(angles(normals, [1, 0, 0, -1, 0, 0])[0]).toBe(Math.fround(Math.PI));
  });

  it("aligns folded face normals before measuring their tangent difference", () => {
    const normals = [0, 0, 1, 0, -1, 0];
    expect(angles(normals, [1, 0, 0, 1, 0, 0])[0]).toBe(0);
    expect(angles(normals, [1, 0, 0, 0, 0, 1])[0]).toBeCloseTo(Math.PI / 2, 5);
  });

  it("takes the antiparallel fallback and the near-parallel threshold branch", () => {
    expect(angles([0, 0, 1, 0, 0, -1], [1, 0, 0, 1, 0, 0])[0]).toBeCloseTo(
      Math.PI,
      5,
    );
    expect(angles([0, 0, 1, 0, -1e-5, 1], [1, 0, 0, 1, 0, 0])[0]).toBe(0);
  });

  it("leaves boundary and nonmanifold edges zero instead of choosing an arbitrary face pair", () => {
    const result = deriveFieldTransportAngles(
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      new Float32Array([1, 0, 0, 0, 1, 0, -1, 0, 0]),
      new Uint32Array([0, 1, 3, 6]),
      new Uint32Array([0, 0, 3, 0, 3, 6]),
    );
    expect([...result]).toEqual([0, Math.fround(Math.PI / 2), 0]);
  });

  it("consumes scan-derived triangle frames without modifying geometry or incidence", () => {
    const normals = new Float32Array([0, 0, 1, 0, 0, 1]);
    const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
    const frames = buildTriangleFieldFrames(
      positions,
      new Uint32Array([0, 1, 2, 2, 0, 1]),
      normals,
    );
    const original = [...frames.tangents];
    const offsets = new Uint32Array([0, 2]);
    const halfedges = new Uint32Array([0, 3]);
    expect(
      deriveFieldTransportAngles(
        normals,
        frames.tangents,
        offsets,
        halfedges,
      )[0],
    ).toBeCloseTo(-Math.PI / 2, 6);
    expect([...frames.tangents]).toEqual(original);
    expect([...offsets]).toEqual([0, 2]);
    expect([...halfedges]).toEqual([0, 3]);
    expect(
      deriveFieldTransportAngles(
        new Float32Array(),
        new Float32Array(),
        new Uint32Array([0]),
        new Uint32Array(),
      ).length,
    ).toBe(0);
  });

  it("rejects malformed frame and incidence inputs", () => {
    const run = (
      normals = new Float32Array([0, 0, 1, 0, 0, 1]),
      offsets = new Uint32Array([0, 2]),
      halfedges = new Uint32Array([0, 3]),
    ) =>
      deriveFieldTransportAngles(
        normals,
        new Float32Array([1, 0, 0, 1, 0, 0]),
        offsets,
        halfedges,
      );
    expect(() => run(new Float32Array([0]))).toThrow(/dimensions/);
    expect(() => run(new Float32Array([0, 0, NaN, 0, 0, 1]))).toThrow(/finite/);
    expect(() => run(undefined, new Uint32Array([1, 2]))).toThrow(/dimensions/);
    expect(() => run(undefined, new Uint32Array([0, 2, 1, 2]))).toThrow(
      /ascending/,
    );
    expect(() => run(undefined, undefined, new Uint32Array([0, 6]))).toThrow(
      /halfedge/,
    );
  });
});

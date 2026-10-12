import { describe, expect, it } from "vitest";
import { applyCurvatureSymmetryDirections } from "../src/field-curvature-symmetry";
import {
  applyCurvatureBoundaryDirections,
  classifyCurvatureBoundaryEdges,
} from "../src/field-curvature-boundary";
import { buildCurvatureEdgeData } from "../src/field-edge-curvature";
import { produceStableCurvatureDirections } from "../src/field-curvature-radius";
import { produceCurvatureDirections } from "../src/field-curvature-directions";
import native from "./fixtures/field-native-symmetry-directions.json";

describe("symmetry curvature direction constraints", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete original writer case $id",
    (entry) => {
      const result = applyCurvatureSymmetryDirections(
        new Uint32Array(entry.edgeVertices),
        new Uint32Array(entry.edgeOffsets),
        new Uint32Array(entry.halfedges),
        new Int32Array(entry.vertexPartners),
        new Float32Array(entry.edgeDirections),
        new Float32Array(entry.previousDirections),
        new Uint8Array(entry.previousFlags),
      );
      expect(Array.from(result.directions)).toEqual(entry.directions);
      expect(Array.from(result.flags)).toEqual(entry.flags);
      expect(result.enabled).toBe(entry.enabled);
    },
  );
  it("requires both endpoints to be self-mapped", () => {
    const run = (partners: number[]) =>
      applyCurvatureSymmetryDirections(
        new Uint32Array([0, 1]),
        new Uint32Array([0, 1]),
        new Uint32Array([0]),
        new Int32Array(partners),
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6]),
        new Uint8Array([128]),
      );
    expect(run([0, 1]).flags[0]).toBe(13);
    for (const partners of [
      [0, -1],
      [-1, 1],
      [1, 0],
      [-1, -1],
    ])
      expect(run(partners).flags[0]).toBe(128);
  });
  it("preserves empty-map state without dereferencing edge vertices", () => {
    const result = applyCurvatureSymmetryDirections(
      new Uint32Array([999, 1000]),
      new Uint32Array([0, 1]),
      new Uint32Array([0]),
      new Int32Array(),
      new Float32Array([1, 2, 3]),
      new Float32Array([4, 5, 6]),
      new Uint8Array([128]),
    );
    expect(result.enabled).toBe(false);
    expect(Array.from(result.directions)).toEqual([4, 5, 6]);
    expect(result.flags[0]).toBe(128);
  });
  it("reports a nonempty symmetry map even when no edges are present", () => {
    const result = applyCurvatureSymmetryDirections(
      new Uint32Array(),
      new Uint32Array([0]),
      new Uint32Array(),
      new Int32Array([0]),
      new Float32Array(),
      new Float32Array(),
      new Uint8Array(),
    );
    expect(result.enabled).toBe(true);
    expect(result.flags.length).toBe(0);
  });
  it("keeps ascending last-write order across repeated and nonmanifold incidences", () => {
    const result = applyCurvatureSymmetryDirections(
      new Uint32Array([0, 1, 1, 2]),
      new Uint32Array([0, 4, 5]),
      new Uint32Array([0, 1, 2, 3, 4]),
      new Int32Array([0, 1, 2]),
      new Float32Array([1, 0, 0, 0, 2, 0]),
      new Float32Array(6),
      new Uint8Array([128, 255]),
    );
    expect(Array.from(result.directions)).toEqual([1, 0, 0, 0, 2, 0]);
    expect(Array.from(result.flags)).toEqual([13, 13]);
  });
  it("overwrites boundary constraints on a folded mesh before either numerical worker mode", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
    const normals = new Float32Array([0, 0, 1, 0, 1, 0]);
    const edges = buildCurvatureEdgeData(positions, triangles, normals);
    const adjacency = edges.adjacency;
    const boundary = applyCurvatureBoundaryDirections(
      adjacency.edgeOffsets,
      adjacency.halfedges,
      classifyCurvatureBoundaryEdges(adjacency.edgeOffsets).boundaryEdges,
      edges.directions,
      new Float32Array(6),
      new Uint8Array(2),
    );
    const symmetry = applyCurvatureSymmetryDirections(
      adjacency.edgeVertices,
      adjacency.edgeOffsets,
      adjacency.halfedges,
      new Int32Array([0, 1, -1, -1]),
      edges.directions,
      boundary.directions,
      boundary.flags,
    );
    expect(Array.from(boundary.flags)).toEqual([9, 9]);
    expect(Array.from(symmetry.flags)).toEqual([13, 13]);
    expect(Array.from(symmetry.directions)).toEqual([1, 0, 0, 1, 0, 0]);
    const radii = [0, 1].map(() => ({
      averages: new Float64Array(12),
      directions: symmetry.directions.slice(),
      middleValues: new Float32Array([1, 1]),
      largestValues: new Float32Array([10, 10]),
      qualified: new Uint8Array([3]),
    }));
    const previous = produceStableCurvatureDirections(radii, {
      backwardSpan: 1,
      forwardSpan: 1,
      ratioMinimum: 0.7,
      skippedFaces: new Uint8Array([3]),
    });
    previous.directions.set(symmetry.directions);
    previous.flags.set(symmetry.flags);
    previous.strengths.fill(9);
    for (const mode of [0, 1] as const) {
      const result = produceCurvatureDirections(
        radii,
        normals,
        new Float32Array([1, 0.5]),
        {
          mode,
          backwardSpan: 1,
          forwardSpan: 1,
          ratioMinimum: 0.7,
          normalThresholds: [0.4, 0.5, 0.8],
          previous,
        },
      );
      expect(Array.from(result.directions)).toEqual(
        Array.from(symmetry.directions),
      );
      expect(Array.from(result.flags)).toEqual([15, 15]);
      expect(Array.from(result.strengths)).toEqual(
        mode === 1 ? [9, 9] : [50000, 50000],
      );
      expect(Array.from(result.selectedRadius)).toEqual([-1, -1]);
    }
  });
  it("returns owned copies without mutating source geometry or flags", () => {
    const directions = new Float32Array([4, 5, 6]);
    const flags = new Uint8Array([128]);
    const result = applyCurvatureSymmetryDirections(
      new Uint32Array([0, 1]),
      new Uint32Array([0, 1]),
      new Uint32Array([0]),
      new Int32Array([0, 1]),
      new Float32Array([1, 2, 3]),
      directions,
      flags,
    );
    result.directions[0] = 42;
    result.flags[0] = 42;
    expect(Array.from(directions)).toEqual([4, 5, 6]);
    expect(flags[0]).toBe(128);
  });
  it("rejects invalid endpoints, partners and edge dimensions", () => {
    const run = (pairs: number[], partners: number[]) =>
      applyCurvatureSymmetryDirections(
        new Uint32Array(pairs),
        new Uint32Array([0, 1]),
        new Uint32Array([0]),
        new Int32Array(partners),
        new Float32Array([1, 2, 3]),
        new Float32Array(3),
        new Uint8Array(1),
      );
    expect(() => run([0, 2], [0, 1])).toThrow("invalid vertex");
    expect(() => run([0, 1], [0, 2])).toThrow("invalid partner");
    expect(() => run([0], [0, 1])).toThrow("dimensions");
  });
});

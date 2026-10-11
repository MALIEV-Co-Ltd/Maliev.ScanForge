import { describe, expect, it } from "vitest";
import {
  applyCurvatureBoundaryDirections,
  classifyCurvatureBoundaryEdges,
} from "../src/field-curvature-boundary";
import { buildCurvatureEdgeData } from "../src/field-edge-curvature";
import { produceStableCurvatureDirections } from "../src/field-curvature-radius";
import { produceCurvatureDirections } from "../src/field-curvature-directions";
import native from "./fixtures/field-native-boundary.json";

describe("curvature boundary classification and constraints", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches original classifier and complete direction function case $id",
    (entry) => {
      const offsets = new Uint32Array(entry.edgeOffsets);
      const classification = classifyCurvatureBoundaryEdges(offsets);
      expect(Array.from(classification.boundaryEdges)).toEqual(
        entry.boundaryEdges,
      );
      expect(Array.from(classification.nonmanifoldEdges)).toEqual(
        entry.nonmanifoldEdges,
      );
      const result = applyCurvatureBoundaryDirections(
        offsets,
        new Uint32Array(entry.halfedges),
        new Uint32Array(entry.selectedEdges),
        new Float32Array(entry.edgeDirections),
        new Float32Array(entry.previousDirections),
        new Uint8Array(entry.previousFlags),
      );
      expect(Array.from(result.directions)).toEqual(entry.directions);
      expect(Array.from(result.flags)).toEqual(entry.flags);
    },
  );
  it("classifies zero/one/two/many incidences and keeps ascending edge order", () => {
    const result = classifyCurvatureBoundaryEdges(
      new Uint32Array([0, 0, 1, 3, 6, 10]),
    );
    expect(Array.from(result.boundaryEdges)).toEqual([0, 1]);
    expect(Array.from(result.nonmanifoldEdges)).toEqual([3, 4]);
  });
  it("preserves untouched faces, assigns flag nine and lets the last selected edge win", () => {
    const offsets = new Uint32Array([0, 1, 2]);
    const halfedges = new Uint32Array([0, 1]);
    const edgeDirections = new Float32Array([1, 0, 0, 0, 2, 0]);
    const prior = new Float32Array([5, 6, 7, 8, 9, 10]);
    const flags = new Uint8Array([255, 137]);
    const run = (edges: number[]) =>
      applyCurvatureBoundaryDirections(
        offsets,
        halfedges,
        new Uint32Array(edges),
        edgeDirections,
        prior,
        flags,
      );
    const forward = run([0, 1]);
    expect(Array.from(forward.directions)).toEqual([0, 2, 0, 8, 9, 10]);
    expect(Array.from(forward.flags)).toEqual([9, 137]);
    expect(Array.from(run([1, 0]).directions)).toEqual([1, 0, 0, 8, 9, 10]);
    expect(Array.from(run([1, 0, 1]).directions)).toEqual(
      Array.from(forward.directions),
    );
    expect(Array.from(prior)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(Array.from(flags)).toEqual([255, 137]);
  });
  it("connects boundary constraints on a folded mesh to the constrained direction branch", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
    const normals = new Float32Array([0, 0, 1, 0, 1, 0]);
    const edges = buildCurvatureEdgeData(positions, triangles, normals);
    const classified = classifyCurvatureBoundaryEdges(
      edges.adjacency.edgeOffsets,
    );
    expect(classified.boundaryEdges.length).toBe(4);
    expect(classified.nonmanifoldEdges.length).toBe(0);
    const applied = applyCurvatureBoundaryDirections(
      edges.adjacency.edgeOffsets,
      edges.adjacency.halfedges,
      classified.boundaryEdges,
      edges.directions,
      new Float32Array(6),
      new Uint8Array(2),
    );
    expect(Array.from(applied.flags)).toEqual([9, 9]);
    const radii = [0, 1].map(() => ({
      averages: new Float64Array(12),
      directions: new Float32Array(applied.directions),
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
    previous.directions.set(applied.directions);
    previous.flags.set(applied.flags);
    const result = produceCurvatureDirections(
      radii,
      normals,
      new Float32Array([0.1, 0.05]),
      {
        backwardSpan: 1,
        forwardSpan: 1,
        ratioMinimum: 0.7,
        normalThresholds: [0.1, 0.2, 0.3],
        previous,
      },
    );
    expect(Array.from(result.completed)).toEqual([1, 1]);
    expect(result.directions).toEqual(applied.directions);
    expect(Array.from(result.strengths)).toEqual([50000, 50000]);
    expect(Array.from(result.selectedRadius)).toEqual([-1, -1]);
  });
  it("supports empty edge caches and ignores unused incidence storage", () => {
    expect(
      classifyCurvatureBoundaryEdges(new Uint32Array([0])).boundaryEdges.length,
    ).toBe(0);
    const result = applyCurvatureBoundaryDirections(
      new Uint32Array([0]),
      new Uint32Array([999]),
      new Uint32Array(),
      new Float32Array(),
      new Float32Array([1, 2, 3]),
      new Uint8Array([7]),
    );
    expect(Array.from(result.directions)).toEqual([1, 2, 3]);
    expect(Array.from(result.flags)).toEqual([7]);
  });
  it.each([[], [1], [0, 2, 1]].map((offsets) => ({ offsets })))(
    "rejects malformed offsets $offsets",
    ({ offsets }) => {
      expect(() =>
        classifyCurvatureBoundaryEdges(new Uint32Array(offsets)),
      ).toThrow(/offsets/);
    },
  );
  it("rejects inconsistent dimensions, nonfinite directions and invalid incidence/edge references", () => {
    const offsets = new Uint32Array([0, 1]);
    const halfedges = new Uint32Array([0]);
    const edges = new Uint32Array([0]);
    const directions = new Float32Array([1, 0, 0]);
    const prior = new Float32Array(3);
    const flags = new Uint8Array([0]);
    expect(() =>
      applyCurvatureBoundaryDirections(
        offsets,
        halfedges,
        edges,
        new Float32Array(),
        prior,
        flags,
      ),
    ).toThrow(/dimensions/);
    expect(() =>
      applyCurvatureBoundaryDirections(
        offsets,
        new Uint32Array(),
        edges,
        directions,
        prior,
        flags,
      ),
    ).toThrow(/dimensions/);
    expect(() =>
      applyCurvatureBoundaryDirections(
        offsets,
        new Uint32Array([3]),
        edges,
        directions,
        prior,
        flags,
      ),
    ).toThrow(/face/);
    expect(() =>
      applyCurvatureBoundaryDirections(
        offsets,
        halfedges,
        new Uint32Array([1]),
        directions,
        prior,
        flags,
      ),
    ).toThrow(/edge/);
    expect(() =>
      applyCurvatureBoundaryDirections(
        offsets,
        halfedges,
        edges,
        new Float32Array([NaN, 0, 0]),
        prior,
        flags,
      ),
    ).toThrow(/finite/);
  });
});

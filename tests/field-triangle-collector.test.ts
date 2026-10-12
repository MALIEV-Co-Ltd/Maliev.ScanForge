import { describe, expect, it } from "vitest";
import { collectGuideTriangles } from "../src/field-triangle-collector";
import { buildGuideQueryTree } from "../src/field-query-tree";
import { buildTriangleNormalCache } from "../src/field-triangle-normals";
import { queryGuideSurface } from "../src/field-surface-query";
import { buildGuidePointBounds } from "../src/field-point-bounds";
import native from "./fixtures/field-native-triangle-collector.json";

describe("recovered triangle-storage geometry collector", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete native collector case $id",
    (entry) => {
      const collected = collectGuideTriangles(
        new Float32Array(entry.positions),
        new Uint32Array(entry.triangles),
      );
      expect([...collected.faces]).toEqual(entry.faces);
      expect(collected.faceBounds.map((box) => [...box])).toEqual(
        entry.faceBounds,
      );
    },
  );

  it("feeds indexed geometry through collection, tree building and projection", () => {
    const positions = new Float32Array([
      0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 4, 2, 0, 4, 0, 2, 4,
    ]);
    const triangles = new Uint32Array([
      0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5,
    ]);
    const collected = collectGuideTriangles(positions, triangles);
    // Native whole-geometry cache acquisition remains separate from point bounds.
    const bounds = buildGuidePointBounds(positions);
    const tree = buildGuideQueryTree(
      collected.faceBounds,
      collected.faces,
      bounds,
    );
    const { normals } = buildTriangleNormalCache(positions, triangles);
    const surface = { positions, triangles, normals, bounds, ...tree };
    expect(tree.nodes.length).toBe(3);
    const result = queryGuideSurface(
      surface,
      new Float32Array([0.5, 0.5, 3.9]),
      1,
    );
    expect(result.face).toBe(5);
    expect([...result.point]).toEqual([0.5, 0.5, 4]);
    expect(
      queryGuideSurface(surface, new Float32Array([0, 0, 2]), 1).face,
    ).toBe(-1);
  });

  it("retains repeated and zero-area faces in the initial order", () => {
    const collected = collectGuideTriangles(
      new Float32Array([2, 3, 4]),
      new Uint32Array([0, 0, 0, 0, 0, 0]),
    );
    expect([...collected.faces]).toEqual([0, 1]);
    expect(collected.faceBounds.map((box) => [...box])).toEqual([
      [2, 3, 4, 2, 3, 4],
      [2, 3, 4, 2, 3, 4],
    ]);
  });

  it("rejects malformed browser geometry before indexing", () => {
    expect(() =>
      collectGuideTriangles(new Float32Array(2), new Uint32Array()),
    ).toThrow(/dimensions/);
    expect(() =>
      collectGuideTriangles(new Float32Array(3), new Uint32Array(2)),
    ).toThrow(/dimensions/);
    expect(() =>
      collectGuideTriangles(new Float32Array([NaN, 0, 0]), new Uint32Array()),
    ).toThrow(/coordinates/);
    expect(() =>
      collectGuideTriangles(new Float32Array(3), new Uint32Array([0, 0, 1])),
    ).toThrow(/vertex/);
  });
});

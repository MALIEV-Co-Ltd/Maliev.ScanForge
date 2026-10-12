import { describe, expect, it } from "vitest";
import { buildVertexEdgeIncidence } from "../src/field-vertex-edge-incidence";
import { buildTriangleAdjacency } from "../src/field-triangle-adjacency";
import { deriveCurvaturePathAssociations } from "../src/field-curvature-associations";
import native from "./fixtures/field-native-vertex-edge-incidence.json";

describe("recovered vertex-edge incidence packing", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete original endpoint packing case $id",
    (entry) => {
      const result = buildVertexEdgeIncidence(
        entry.vertexCount,
        new Int32Array(entry.edgeVertices),
      );
      expect(Array.from(result.vertexEdgeOffsets)).toEqual(
        entry.output.vertexEdgeOffsets,
      );
      expect(Array.from(result.vertexEdges)).toEqual(entry.output.vertexEdges);
    },
  );
  it("retains endpoint order, duplicate edges, loops and isolated vertices", () => {
    const result = buildVertexEdgeIncidence(
      4,
      new Int32Array([2, 0, 0, 0, 2, 0]),
    );
    expect(Array.from(result.vertexEdgeOffsets)).toEqual([0, 4, 4, 6, 6]);
    expect(Array.from(result.vertexEdges)).toEqual([0, 1, 1, 2, 0, 2]);
  });
  it("supplies recovered mesh-cache order to guide association propagation", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
    const triangles = new Uint32Array([0, 1, 2, 1, 2, 3]);
    const cache = buildTriangleAdjacency(4, triangles);
    const incidence = buildVertexEdgeIncidence(4, cache.edgeVertices);
    const result = deriveCurvaturePathAssociations(
      [
        {
          enabled: true,
          mode: 1,
          radius: 2,
          points: new Float32Array([0, 0, 0]),
          mappedKinds: new Int32Array([1]),
          mappedVertices: new Int32Array([0]),
        },
      ],
      positions,
      triangles,
      { edgeVertices: new Int32Array(cache.edgeVertices), ...incidence },
    );
    expect(Array.from(result.vertexDistances)).toEqual([0, 1, 2, 3]);
    expect(Array.from(result.faceDistances)).toEqual([0.5, 1]);
    expect(
      deriveCurvaturePathAssociations(
        [
          {
            enabled: true,
            mode: 1,
            radius: 2,
            points: new Float32Array([0, 0, 0]),
            mappedKinds: new Int32Array([1]),
            mappedVertices: new Int32Array([0]),
          },
        ],
        positions,
        triangles,
      ),
    ).toEqual(result);
  });
  it("owns cache storage and rejects invalid dimensions or endpoints", () => {
    const endpoints = new Int32Array([0, 1]);
    const result = buildVertexEdgeIncidence(2, endpoints);
    result.vertexEdges[0] = 42;
    expect(endpoints[0]).toBe(0);
    expect(buildVertexEdgeIncidence(2, endpoints).vertexEdges[0]).toBe(0);
    expect(() => buildVertexEdgeIncidence(-1, endpoints)).toThrow("dimensions");
    expect(() => buildVertexEdgeIncidence(2, new Int32Array([0]))).toThrow(
      "dimensions",
    );
    expect(() => buildVertexEdgeIncidence(2, new Int32Array([-1, 0]))).toThrow(
      "invalid vertex",
    );
    expect(() => buildVertexEdgeIncidence(2, new Int32Array([0, 2]))).toThrow(
      "invalid vertex",
    );
  });
});

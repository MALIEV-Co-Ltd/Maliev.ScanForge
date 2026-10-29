import { expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { materializeFiniteSeams } from "../src/scan-split-finite-seams";

it("opens a three-way cut reaching a mesh boundary without extra facets", () => {
  const vertices = new Float64Array([
    0, 0, 0, 2, 0, 0, 1, 1, 0, -1, 1, 0, -2, 0, 0, -1, -1, 0, 1, -1, 0,
  ]);
  const triangles = new Uint32Array([
    0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 1,
  ]);
  const cuts = new Uint32Array([0, 1, 0, 3, 0, 5]);
  const result = materializeFiniteSeams(vertices, triangles, cuts, {
    preciseCoordinates: true,
  });
  const topology = analyzeIndexedMesh(
    Float64Array.from(result.vertices),
    result.triangles,
  );
  expect(result.triangles.length).toBe(triangles.length);
  expect(topology.components).toHaveLength(3);
  expect(topology.boundaryEdges).toBe(12);
  expect(topology.nonManifoldEdges).toBe(0);
});

it("handles a closed cut and a disconnected isolated cut in the same mesh", () => {
  const vertices = new Float64Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 3, 0, 0, 4, 0, 0, 3, 1, 0,
  ]);
  const triangles = new Uint32Array([
    0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3, 4, 5, 6,
  ]);
  const cuts = new Uint32Array([0, 1, 1, 2, 2, 0, 4, 5]);
  const result = materializeFiniteSeams(vertices, triangles, cuts, {
    preciseCoordinates: true,
  });
  const topology = analyzeIndexedMesh(
    Float64Array.from(result.vertices),
    result.triangles,
  );
  expect(result.triangles.length).toBe(triangles.length + 3);
  expect(topology.components).toHaveLength(3);
  expect(topology.nonManifoldEdges).toBe(0);
});

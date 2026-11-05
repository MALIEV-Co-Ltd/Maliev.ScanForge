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

it("opens a closed-fan cut even when endpoints have unrelated boundary fans", () => {
  const vertices = new Float64Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 1, 1, 0, 1, 0, 1,
  ]);
  const triangles = new Uint32Array([
    0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3, 0, 4, 5, 1, 6, 7,
  ]);
  const result = materializeFiniteSeams(
    vertices,
    triangles,
    new Uint32Array([0, 1]),
    {
      preciseCoordinates: true,
    },
  );
  expect(result.triangles.length).toBe(triangles.length + 6);
  const coords = (face: number, corner: number) => {
    const v = result.triangles[face * 3 + corner];
    return result.vertices.slice(v * 3, v * 3 + 3).join(",");
  };
  const cutEdges: number[][] = [];
  for (let f = 0; f < result.triangles.length / 3; f++) {
    for (let c = 0; c < 3; c++) {
      const d = (c + 1) % 3;
      if (
        (coords(f, c) === "0,0,0" && coords(f, d) === "1,0,0") ||
        (coords(f, c) === "1,0,0" && coords(f, d) === "0,0,0")
      )
        cutEdges.push([
          result.triangles[f * 3 + c],
          result.triangles[f * 3 + d],
        ]);
    }
  }
  expect(cutEdges).toHaveLength(0);
});

it("handles repeated isolated cuts on a large open fan within the default work budget", () => {
  const count = 2000;
  const vertices = [0, 0, 0];
  for (let i = 0; i <= count; i++) {
    const angle = (Math.PI * i) / count;
    vertices.push(Math.cos(angle), Math.sin(angle), 0);
  }
  const triangles: number[] = [];
  for (let i = 0; i < count; i++) triangles.push(0, i + 1, i + 2);
  const cuts: number[] = [];
  for (let i = 0; i < count; i++) cuts.push(0, 2);
  const result = materializeFiniteSeams(
    new Float64Array(vertices),
    new Uint32Array(triangles),
    new Uint32Array(cuts),
    { preciseCoordinates: true },
  );
  expect(result.triangles.length).toBe(triangles.length + 6);
});

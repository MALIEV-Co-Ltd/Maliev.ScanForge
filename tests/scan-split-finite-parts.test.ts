import { expect, it } from "vitest";
import { indexedMeshMatches } from "../src/indexed-mesh";
import { groupFiniteTrianglesCompact } from "../src/scan-split-finite-group";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";
import { materializeFiniteSeams } from "../src/scan-split-finite-seams";
import { partitionFiniteIndexedParts } from "../src/scan-split-finite-parts";

it("preserves distinct coincident indexed vertices in separate compact parts", () => {
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  ]);
  const triangles = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const labels = groupFiniteTrianglesCompact(triangles, new Uint32Array());
  const result = partitionFiniteIndexedParts(vertices, triangles, labels);
  expect(result).toHaveLength(2);
  for (const part of result) {
    expect(indexedMeshMatches(part.indexedMesh, part.positions)).toBe(true);
    expect(part.indexedMesh.vertices.length).toBe(9);
  }
  expect([...result[0].positions, ...result[1].positions]).toEqual([
    ...vertices,
  ]);
});

it("handles interleaved faces and a vertex shared across different parts", () => {
  const v = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0, 2, 0, 0, 2, 1, 0,
  ]);
  const t = new Uint32Array([0, 1, 2, 0, 3, 4, 1, 5, 6]);
  const result = partitionFiniteIndexedParts(v, t, new Uint32Array([0, 1, 0]));
  expect(result.map((p) => p.positions.length)).toEqual([18, 9]);
  expect(result[0].indexedMesh.vertices.length / 3).toBe(5);
  expect(result[1].indexedMesh.vertices.length / 3).toBe(3);
  for (const part of result)
    expect(indexedMeshMatches(part.indexedMesh, part.positions)).toBe(true);
});

it("retains number-array seam coordinates in indexed and expanded parts", () => {
  const vertices = [100000000, 0, 0, 100000004, 4, 0, 99999992, 16, 0];
  const parts = partitionFiniteIndexedParts(
    vertices,
    new Uint32Array([0, 1, 2]),
    new Uint32Array([0]),
  );
  expect(parts[0].positions[3]).toBe(100000004);
  expect(parts[0].indexedMesh.vertices[3]).toBe(100000004);
  expect(indexedMeshMatches(parts[0].indexedMesh, parts[0].positions)).toBe(
    true,
  );
});

it("carries a precise seam through grouping and part creation", () => {
  const source = new Float32Array([
    100000000, 0, 0, 100000008, 8, 0, 99999992, 16, 0,
  ]);
  const seam = materializeFiniteSeams(
    source,
    new Uint32Array([0, 1, 2]),
    new Uint32Array([0, 1]),
    { preciseCoordinates: true },
  );
  const groups = groupFiniteTrianglesCompact(seam.triangles, new Uint32Array());
  const parts = partitionFiniteIndexedParts(
    seam.vertices,
    seam.triangles,
    groups,
  );
  expect(parts.flatMap((part) => part.positions)).toContain(100000004);
  for (const part of parts)
    expect(indexedMeshMatches(part.indexedMesh, part.positions)).toBe(true);
});

it("admits the wider number-array part payload before allocation", () => {
  const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const triangles = new Uint32Array([0, 1, 2]);
  const groups = new Uint32Array([0]);
  expect(() =>
    partitionFiniteIndexedParts(vertices, triangles, groups, {
      maxTypedBytes: 195,
    }),
  ).toThrow(/memory/i);
  expect(() =>
    partitionFiniteIndexedParts(vertices, triangles, groups, {
      maxTypedBytes: 196,
    }),
  ).not.toThrow();
});

it("rejects invalid geometry, insufficient typed allowance and cancellation", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const t = new Uint32Array([0, 1, 2]);
  expect(() => partitionFiniteIndexedParts(v, t, new Uint32Array([1]))).toThrow(
    /group/i,
  );
  expect(() =>
    partitionFiniteIndexedParts(v, t, new Uint32Array([0]), {
      maxTypedBytes: 123,
    }),
  ).toThrow(/memory/i);
  expect(() =>
    partitionFiniteIndexedParts(v, t, new Uint32Array([0]), {
      maxTypedBytes: 124,
    }),
  ).not.toThrow();
  const abort = new AbortController();
  abort.abort();
  expect(() =>
    partitionFiniteIndexedParts(v, t, new Uint32Array([0]), {
      signal: abort.signal,
    }),
  ).toThrow(/abort/i);
});

it("keeps an interior slit boundary in the compact published part", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const refined = refineFiniteCutterMesh(
    v,
    new Uint32Array([0, 1, 2]),
    new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]),
  );
  const seamed = materializeFiniteSeams(
    new Float32Array([...v, ...refined.addedVertices]),
    refined.triangles,
    refined.constraints,
  );
  const groups = groupFiniteTrianglesCompact(
    seamed.triangles,
    new Uint32Array(),
  );
  const parts = partitionFiniteIndexedParts(
    seamed.vertices,
    seamed.triangles,
    groups,
  );
  expect(parts).toHaveLength(1);
  expect(indexedMeshMatches(parts[0].indexedMesh, parts[0].positions)).toBe(
    true,
  );
  expect(
    analyzeIndexedMesh(
      Float64Array.from(parts[0].indexedMesh.vertices),
      parts[0].indexedMesh.triangles,
    ).boundaryEdges,
  ).toBe(7);
});

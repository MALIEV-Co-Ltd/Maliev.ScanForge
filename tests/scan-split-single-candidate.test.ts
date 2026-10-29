import { expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { indexedMeshMatches } from "../src/indexed-mesh";
import { runFiniteSplitCandidate } from "../src/scan-split-finite-candidate";
import {
  combineFiniteSplitParts,
  expandFiniteSeamedMesh,
} from "../src/scan-split-single-candidate";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";
import { materializeFiniteSeams } from "../src/scan-split-finite-seams";

it("keeps split components in one indexed mesh without welding their seam", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([0.5, -1, -1, 0.5, 1, -1, 0.5, 0, 1]);
  const result = runFiniteSplitCandidate(source, cutter);
  expect(result.segments).toHaveLength(2);
  const combined = combineFiniteSplitParts(
    result.segments,
    result.segmentIndexedMeshes,
  );
  expect(indexedMeshMatches(combined.indexedMesh, combined.positions)).toBe(
    true,
  );
  expect(
    analyzeIndexedMesh(
      Float64Array.from(combined.indexedMesh.vertices),
      combined.indexedMesh.triangles,
    ).components,
  ).toHaveLength(2);
  expect(combined.positions.length).toBe(
    result.segments.reduce((n, p) => n + p.length, 0),
  );
});

it("rejects mismatched parts, insufficient memory and cancellation", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const mesh = {
    vertices: positions.slice(),
    triangles: new Uint32Array([0, 1, 2]),
  };
  expect(() => combineFiniteSplitParts([positions], [])).toThrow(/count/i);
  expect(() =>
    combineFiniteSplitParts(
      [positions],
      [{ ...mesh, triangles: new Uint32Array([0, 2, 1]) }],
    ),
  ).toThrow(/match/i);
  expect(() =>
    combineFiniteSplitParts([positions], [mesh], { maxTypedBytes: 83 }),
  ).toThrow(/memory/i);
  expect(() =>
    combineFiniteSplitParts([positions], [mesh], { maxTypedBytes: 84 }),
  ).not.toThrow();
  const abort = new AbortController();
  abort.abort();
  expect(() =>
    combineFiniteSplitParts([positions], [mesh], { signal: abort.signal }),
  ).toThrow(/abort/i);
});

it("documents selection-boundary isolation in the combined candidate", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const source = Float32Array.from(
    [...triangles].flatMap((id) => [...vertices.slice(id * 3, id * 3 + 3)]),
  );
  const cutter = new Float32Array([0.25, -2, -1, 0.25, 2, -1, 0.25, 0, 1]);
  const result = runFiniteSplitCandidate(
    source,
    cutter,
    { vertices, triangles },
    { selection: new Uint8Array([1, 0]) },
  );
  const combined = combineFiniteSplitParts(
    result.segments,
    result.segmentIndexedMeshes,
  );
  expect(indexedMeshMatches(combined.indexedMesh, combined.positions)).toBe(
    true,
  );
  expect(
    analyzeIndexedMesh(
      Float64Array.from(combined.indexedMesh.vertices),
      combined.indexedMesh.triangles,
    ).components,
  ).toHaveLength(3);
  expect(
    result.segments.some(
      (part) =>
        part.length === 9 &&
        [...part].every((value, i) => value === source[9 + i]),
    ),
  ).toBe(true);
});

it("exposes the nonconforming shared edge in a direct selected-only mesh", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const cutter = new Float32Array([0.25, -2, -1, 0.25, 2, -1, 0.25, 0, 1]);
  const refined = refineFiniteCutterMesh(vertices, triangles, cutter, {
    selection: new Uint8Array([1, 0]),
  });
  const seamed = materializeFiniteSeams(
    new Float32Array([...vertices, ...refined.addedVertices]),
    refined.triangles,
    refined.constraints,
  );
  const mesh = expandFiniteSeamedMesh(seamed).indexedMesh;
  const edgeCounts = new Map<string, number>();
  for (let face = 0; face < mesh.triangles.length; face += 3) {
    for (let side = 0; side < 3; side++) {
      const ids = [
        mesh.triangles[face + side],
        mesh.triangles[face + ((side + 1) % 3)],
      ];
      const points = ids.map((id) =>
        Array.from(mesh.vertices.slice(id * 3, id * 3 + 3)).join(","),
      );
      const key = points.sort().join("|");
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  // The untouched neighbor retains the full edge while selected faces end at
  // an interior point: geometry meets, but the indexed edges do not match.
  expect(edgeCounts.get("0,0,0|1,0,0")).toBe(1);
  expect(edgeCounts.get("0,0,0|0.25,0,0")).toBe(1);
  expect(edgeCounts.get("0.25,0,0|1,0,0")).toBe(1);
  expect(
    indexedMeshMatches(mesh, expandFiniteSeamedMesh(seamed).positions),
  ).toBe(true);
});

it("expands a seamed mesh without splitting an unrelated point-only source identity", () => {
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0,
  ]);
  const triangles = new Uint32Array([0, 1, 2, 0, 3, 4]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const refined = refineFiniteCutterMesh(vertices, triangles, cutter);
  const seamed = materializeFiniteSeams(
    new Float32Array([...vertices, ...refined.addedVertices]),
    refined.triangles,
    refined.constraints,
  );
  const output = expandFiniteSeamedMesh(seamed);
  expect(indexedMeshMatches(output.indexedMesh, output.positions)).toBe(true);
  const ids = new Set<number>();
  for (let i = 0; i < output.indexedMesh.vertices.length; i += 3)
    if (
      output.indexedMesh.vertices[i] === 0 &&
      output.indexedMesh.vertices[i + 1] === 0 &&
      output.indexedMesh.vertices[i + 2] === 0
    )
      ids.add(i / 3);
  expect(ids.size).toBe(1);
});

it("checks finite indexed mesh expansion memory and cancellation", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  expect(() =>
    expandFiniteSeamedMesh({ vertices, triangles }, { maxTypedBytes: 35 }),
  ).toThrow(/memory/i);
  expect(() =>
    expandFiniteSeamedMesh({ vertices, triangles }, { maxTypedBytes: 36 }),
  ).not.toThrow();
  expect(() =>
    expandFiniteSeamedMesh({ vertices, triangles: new Uint32Array([0, 1, 3]) }),
  ).toThrow(/index/i);
  const abort = new AbortController();
  abort.abort();
  expect(() =>
    expandFiniteSeamedMesh({ vertices, triangles }, { signal: abort.signal }),
  ).toThrow(/abort/i);
});

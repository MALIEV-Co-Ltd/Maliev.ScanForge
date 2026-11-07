import { expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { nativeHoleBoundaryWalks } from "../src/scan-hole-boundary-order";
import { joinNativeCurvaturePatch } from "../src/scan-hole-curvature-join";

function control(subdivisions: number, unrelated = false) {
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const points = [
    ...corners.map(([x, y]) => [2 * x, 2 * y, 1]),
    ...corners.map(([x, y]) => [x, y, 1]),
  ];
  const faces: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.push(i, j, j + 4, i, j + 4, i + 4);
  }
  if (unrelated) {
    points.push([10, 10, 2], [11, 10, 2], [10, 11, 2], [99, 99, 99]);
    faces.push(8, 9, 10);
  }
  const topology = analyzeIndexedMesh(
    Float64Array.from(points.flat()),
    Uint32Array.from(faces),
  );
  const boundary = nativeHoleBoundaryWalks(topology).find((loop) =>
    loop.every((id) => id >= 4 && id < 8),
  )!;
  const uvs: number[] = [],
    vertices: number[] = [],
    triangles: number[] = [];
  for (let side = 0; side < 4; side++)
    for (let i = 0; i < subdivisions; i++) {
      const a = corners[side],
        b = corners[(side + 1) % 4],
        t = i / subdivisions;
      const x = a[0] + t * (b[0] - a[0]),
        y = a[1] + t * (b[1] - a[1]);
      uvs.push(x, y, 0);
      vertices.push(x, y, 1);
    }
  const count = uvs.length / 3;
  uvs.push(0, 0, 0);
  vertices.push(0, 0, 1);
  for (let i = 0; i < count; i++) triangles.push(count, i, (i + 1) % count);
  const input = {
    boundary,
    boundaryUV: boundary.map((id) => [points[id][0], points[id][1], 0]),
    boundaryWorld: boundary.map((id) => [...points[id]]),
    cap: {
      uvs: Float32Array.from(uvs),
      vertices: Float32Array.from(vertices),
      triangles: Uint32Array.from(triangles),
    },
  };
  return { topology, input };
}

it("stitches inserted cap boundary vertices into the original indexed collar", () => {
  const { topology, input } = control(2);
  const source = topology.vertices.slice(),
    cap = input.cap.vertices.slice();
  const result = joinNativeCurvaturePatch(topology, input);
  const output = analyzeIndexedMesh(
    Float64Array.from(result.vertices),
    result.triangles,
  );
  expect(result.triangles.length / 3).toBe(20);
  expect(result.stitchedBoundaryVertices).toBe(4);
  expect(result.collapsedEdges).toBe(0);
  expect(output.boundaryLoops).toHaveLength(1);
  expect(output.nonManifoldEdges).toBe(0);
  expect(output.inconsistentEdges).toBe(0);
  for (let id = 0; id < 4; id++)
    expect(Array.from(result.vertices.slice(id * 3, id * 3 + 3))).toEqual(
      Array.from(source.slice(id * 3, id * 3 + 3)),
    );
  expect(
    Array.from(result.vertices)
      .filter((_, i) => i % 3 === 2)
      .every((z) => z === 1),
  ).toBe(true);
  expect(topology.vertices).toEqual(source);
  expect(input.cap.vertices).toEqual(cap);
});

it("collapses eligible inserted seam edges without removing original rim identities", () => {
  const { topology, input } = control(3);
  const result = joinNativeCurvaturePatch(topology, input);
  const used = new Set(result.triangles);
  expect(result.stitchedBoundaryVertices).toBe(8);
  expect(result.collapsedEdges).toBe(4);
  expect(result.triangles.length / 3).toBe(20);
  expect(used.size).toBe(13);
  for (const id of input.boundary) expect(used.has(id)).toBe(true);
  const output = analyzeIndexedMesh(
    Float64Array.from(result.vertices),
    result.triangles,
  );
  expect(output.nonManifoldEdges).toBe(0);
  expect(output.inconsistentEdges).toBe(0);
  expect(output.boundaryLoops).toHaveLength(1);
});

it("preserves unrelated components and unused source vertex records", () => {
  const { topology, input } = control(2, true);
  const result = joinNativeCurvaturePatch(topology, input);
  expect(Array.from(result.vertices.slice(8 * 3, 12 * 3))).toEqual(
    Array.from(topology.vertices.slice(8 * 3, 12 * 3)),
  );
  const faces = Array.from({ length: result.triangles.length / 3 }, (_, i) =>
    Array.from(result.triangles.slice(i * 3, i * 3 + 3)),
  );
  expect(faces).toContainEqual([8, 9, 10]);
  expect(
    analyzeIndexedMesh(Float64Array.from(result.vertices), result.triangles)
      .boundaryLoops,
  ).toHaveLength(2);
});

it("rejects a cap that does not provide distinct counterparts for the original rim", () => {
  const { topology, input } = control(2);
  input.boundaryUV = input.boundaryUV.map(() => [0, 0, 0]);
  expect(() => joinNativeCurvaturePatch(topology, input)).toThrow(
    /rim|boundary|distinct/i,
  );
});

it("rejects invalid source boundaries and nonmanifold caps atomically", () => {
  const { topology, input } = control(2),
    before = topology.vertices.slice();
  expect(() =>
    joinNativeCurvaturePatch(topology, { ...input, boundary: [0, 1, 2] }),
  ).toThrow(/boundary|matching/i);
  const triangles = new Uint32Array([
    ...input.cap.triangles,
    ...input.cap.triangles.slice(0, 3),
  ]);
  expect(() =>
    joinNativeCurvaturePatch(topology, {
      ...input,
      cap: { ...input.cap, triangles },
    }),
  ).toThrow(/manifold|cap|winding/i);
  expect(topology.vertices).toEqual(before);
});

it("cancels the collar transaction without changing either source or cap", () => {
  const { topology, input } = control(3),
    source = topology.vertices.slice(),
    cap = input.cap.vertices.slice();
  let checks = 0;
  expect(() =>
    joinNativeCurvaturePatch(topology, input, () => {
      if (++checks === 3) throw new DOMException("Cancelled", "AbortError");
    }),
  ).toThrow(/Cancelled/);
  expect(topology.vertices).toEqual(source);
  expect(input.cap.vertices).toEqual(cap);
});

it("removes unused new cap records while preserving all source vertex identities", () => {
  const { topology, input } = control(3, true);
  input.cap.vertices = new Float32Array([
    ...input.cap.vertices,
    9999,
    9999,
    9999,
  ]);
  input.cap.uvs = new Float32Array([...input.cap.uvs, 9999, 9999, 0]);
  const result = joinNativeCurvaturePatch(topology, input);
  const used = new Set(result.triangles);
  for (
    let id = topology.vertices.length / 3;
    id < result.vertices.length / 3;
    id++
  )
    expect(used.has(id)).toBe(true);
  expect(Array.from(result.vertices.slice(8 * 3, 12 * 3))).toEqual(
    Array.from(topology.vertices.slice(8 * 3, 12 * 3)),
  );
  expect(Math.max(...result.vertices)).toBe(99);
});

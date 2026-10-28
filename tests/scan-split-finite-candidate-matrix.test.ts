import { expect, it } from "vitest";
import { indexedMeshMatches } from "../src/indexed-mesh";
import { runFiniteSplitCandidate } from "../src/scan-split-finite-candidate";
import { splitGeneralCutter } from "../src/scan-edit-general-split";
import { analyzeIndexedMesh } from "../src/mesh-processing";

function cubeCells(cells: number[][]): Float32Array {
  const occupied = new Set(cells.map((cell) => cell.join(",")));
  const vertices = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const sides = [
    { d: [0, 0, -1], ids: [0, 2, 1, 0, 3, 2] },
    { d: [0, 0, 1], ids: [4, 5, 6, 4, 6, 7] },
    { d: [0, -1, 0], ids: [0, 1, 5, 0, 5, 4] },
    { d: [1, 0, 0], ids: [1, 2, 6, 1, 6, 5] },
    { d: [0, 1, 0], ids: [2, 3, 7, 2, 7, 6] },
    { d: [-1, 0, 0], ids: [3, 0, 4, 3, 4, 7] },
  ];
  const output: number[] = [];
  for (const cell of cells)
    for (const side of sides)
      if (
        !occupied.has(cell.map((value, axis) => value + side.d[axis]).join(","))
      )
        for (const id of side.ids)
          output.push(...vertices[id].map((value, axis) => value + cell[axis]));
  return new Float32Array(output);
}
const square = new Float32Array([
  -1, -1, 0.5, 3, -1, 0.5, 3, 3, 0.5, -1, -1, 0.5, 3, 3, 0.5, -1, 3, 0.5,
]);
const area = (p: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < p.length; i += 9)
    sum +=
      ((p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) -
        (p[i + 4] - p[i + 1]) * (p[i + 6] - p[i])) /
      2;
  return sum;
};

it.each([
  { name: "closed convex", cutter: cubeCells([[0, 0, 0]]), expected: [1, 15] },
  {
    name: "closed concave",
    cutter: cubeCells([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]),
    expected: [3, 13],
  },
])("retains the established $name area partitions", ({ cutter, expected }) => {
  const result = runFiniteSplitCandidate(square, cutter);
  expect(result.segments).toHaveLength(2);
  expect(result.segments.map(area).sort((a, b) => a - b)).toEqual(expected);
  for (let i = 0; i < result.segments.length; i++)
    expect(
      indexedMeshMatches(result.segmentIndexedMeshes[i], result.segments[i]),
    ).toBe(true);
});

it("preserves a disjoint finite planar cutter control", () => {
  const source = new Float32Array([-1, 4, 0, 1, 4, 0, 0, 5, 0]);
  const cutter = new Float32Array([
    0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1,
  ]);
  const result = runFiniteSplitCandidate(source, cutter);
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]).toEqual(source);
});

it("documents disconnected-source part grouping as a separate native question", () => {
  const source = new Float32Array([
    -1, 4, 0, 1, 4, 0, 0, 5, 0, -1, 7, 0, 1, 7, 0, 0, 8, 0,
  ]);
  const cutter = new Float32Array([
    0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1,
  ]);
  const candidate = runFiniteSplitCandidate(source, cutter);
  const current = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions: source, target: cutter },
    {},
  );
  expect(candidate.segments).toHaveLength(2);
  expect(current.segments!.filter((part) => part.length)).toHaveLength(1);
  expect(candidate.diagnostics.cutEdges).toBe(0);
});

const foldedControl = () => {
  const source = new Float32Array([
    -0.5, -0.5, 0, 1.5, -0.5, 0, 1.5, 1.5, 0, -0.5, -0.5, 0, 1.5, 1.5, 0, -0.5,
    1.5, 0,
  ]);
  const cutter = new Float32Array([
    0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 1, 1,
    -1, 1, 1, 1, 0, 1, -1, 1, 1, 1, 0, 1, 1,
  ]);
  return runFiniteSplitCandidate(source, cutter);
};

it("preserves area in the folded open-cutter control", () => {
  const result = foldedControl();
  expect(result.segments.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
    4,
    7,
  );
  expect(result.segments).toHaveLength(1);
});

it("keeps the folded cut as an open nonseparating seam", () => {
  const result = foldedControl();
  const mesh = result.segmentIndexedMeshes[0];
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    for (let side = 0; side < 3; side++) {
      const a = mesh.triangles[i + side],
        b = mesh.triangles[i + ((side + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key) ?? { a, b, count: 0 };
      edge.count++;
      edges.set(key, edge);
    }
  }
  let boundaryLength = 0,
    seamLength = 0;
  for (const edge of edges.values())
    if (edge.count === 1) {
      const a = edge.a * 3,
        b = edge.b * 3;
      const length = Math.hypot(
        mesh.vertices[a] - mesh.vertices[b],
        mesh.vertices[a + 1] - mesh.vertices[b + 1],
        mesh.vertices[a + 2] - mesh.vertices[b + 2],
      );
      boundaryLength += length;
      const x1 = mesh.vertices[a],
        y1 = mesh.vertices[a + 1],
        x2 = mesh.vertices[b],
        y2 = mesh.vertices[b + 1];
      const perimeter =
        (x1 === x2 && (x1 === -0.5 || x1 === 1.5)) ||
        (y1 === y2 && (y1 === -0.5 || y1 === 1.5));
      const seam =
        (x1 === 0 &&
          x2 === 0 &&
          Math.min(y1, y2) >= -0.5 &&
          Math.max(y1, y2) <= 1) ||
        (y1 === 1 &&
          y2 === 1 &&
          Math.min(x1, x2) >= 0 &&
          Math.max(x1, x2) <= 1);
      expect(perimeter || seam).toBe(true);
      if (seam) seamLength += length;
    }
  const topology = analyzeIndexedMesh(
    Float64Array.from(mesh.vertices),
    mesh.triangles,
  );
  expect(topology.components).toHaveLength(1);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(boundaryLength).toBeCloseTo(13, 6);
  expect(seamLength).toBeCloseTo(5, 6);
});

it("preserves a tilted identical coplanar control", () => {
  const source = new Float32Array([0, 0, 0, 7, 5, 21, 2, 2, 17]);
  const result = runFiniteSplitCandidate(source, source.slice());
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]).toEqual(source);
});

it("retains the original scan face crossing with positive winding", () => {
  const source = new Float32Array([
    19.898012161254883, 47.31754684448242, -315.9837341308594,
    20.04651641845703, 47.50707244873047, -315.9645080566406, 20.04990005493164,
    47.18638610839844, -315.8510437011719,
  ]);
  const cutter = new Float32Array([
    19.9250431060791, -149.8528594970703, -442.96917724609375, 19.9250431060791,
    -149.8528594970703, 72.22071838378906, 19.9250431060791, 406.9168701171875,
    -442.96917724609375,
  ]);
  const result = runFiniteSplitCandidate(source, cutter);
  expect(result.segments).toHaveLength(2);
  const normal = (p: Float32Array, i: number) => {
    const a = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]],
      b = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  };
  const n = normal(source, 0);
  let total = 0;
  for (const part of result.segments)
    for (let i = 0; i < part.length; i += 9) {
      const face = normal(part, i),
        dot = face.reduce((sum, v, k) => sum + v * n[k], 0);
      expect(dot).toBeGreaterThan(0);
      total += dot;
    }
  expect(total / n.reduce((sum, v) => sum + v * v, 0)).toBeCloseTo(1, 4);
});

it("keeps a coplanar shared source edge in one part", () => {
  const source = new Float32Array([
    0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0,
  ]);
  const cutter = new Float32Array([0, 0.1, -1, 0, 0.9, -1, 0, 0.5, 1]);
  const result = runFiniteSplitCandidate(source, cutter);
  expect(result.segments).toHaveLength(1);
  expect(
    indexedMeshMatches(result.segmentIndexedMeshes[0], result.segments[0]),
  ).toBe(true);
});

it("preserves a sloped shared-edge contact and source coverage", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 3, 0, 0, 4, 0, 1, -1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const source = Float32Array.from(
    [...triangles].flatMap((id) => [...vertices.slice(id * 3, id * 3 + 3)]),
  );
  const cutter = new Float32Array([0, 0, -1, 1, 3, -1, 0, 0, 2]);
  const result = runFiniteSplitCandidate(source, cutter, {
    vertices,
    triangles,
  });
  expect(result.segments.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(
    area(source),
    6,
  );
  for (let i = 0; i < result.segments.length; i++)
    expect(
      indexedMeshMatches(result.segmentIndexedMeshes[i], result.segments[i]),
    ).toBe(true);
  expect(
    result.segments.some((part) => {
      for (let i = 0; i < part.length; i += 3)
        if (
          Math.abs(part[i] - 2 / 3) < 1e-6 &&
          Math.abs(part[i + 1] - 2) < 1e-6 &&
          part[i + 2] === 0
        )
          return true;
      return false;
    }),
  ).toBe(true);
});

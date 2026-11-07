import { expect, it } from "vitest";
import { expandFiniteGroups } from "../src/scan-split-finite-output";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";
import { analyzeIndexedMesh, analyzeMesh } from "../src/mesh-processing";

it("expands groups in source face order using both original and added vertices", () => {
  const original = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  const added = new Float32Array([1, 0, 0, 1, 1, 0]);
  const triangles = new Uint32Array([0, 3, 2, 3, 4, 2, 3, 1, 4]);
  const groups = new Uint32Array([0, 0, 2]);
  const before = [
    original.slice(),
    added.slice(),
    triangles.slice(),
    groups.slice(),
  ];
  const result = expandFiniteGroups(original, added, triangles, groups);
  expect(result.map(({ group }) => group)).toEqual([0, 2]);
  expect([...result[0].positions]).toEqual([
    0, 0, 0, 1, 0, 0, 0, 2, 0, 1, 0, 0, 1, 1, 0, 0, 2, 0,
  ]);
  expect([...result[1].positions]).toEqual([1, 0, 0, 2, 0, 0, 1, 1, 0]);
  expect([original, added, triangles, groups]).toEqual(before);
});

it("rejects invalid indices, nonfinite coordinates and a bounded output allocation", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const t = new Uint32Array([0, 1, 2]);
  const g = new Uint32Array([0]);
  expect(() =>
    expandFiniteGroups(v, new Float32Array(), new Uint32Array([0, 1, 3]), g),
  ).toThrow(/index/i);
  expect(() =>
    expandFiniteGroups(
      new Float32Array([NaN, ...v.slice(1)]),
      new Float32Array(),
      t,
      g,
    ),
  ).toThrow(/finite/i);
  expect(() =>
    expandFiniteGroups(v, new Float32Array(), t, g, { maxTypedBytes: 35 }),
  ).toThrow(/memory/i);
  expect(
    expandFiniteGroups(v, new Float32Array(), t, g, { maxTypedBytes: 36 })[0]
      .positions,
  ).toEqual(v);
});

it("honors cancellation during output construction", () => {
  const controller = new AbortController();
  let calls = 0;
  expect(() =>
    expandFiniteGroups(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Float32Array(),
      new Uint32Array([0, 1, 2]),
      new Uint32Array([0]),
      {
        signal: controller.signal,
        check: () => {
          if (++calls === 3) controller.abort();
        },
      },
    ),
  ).toThrow(/abort/i);
});

it("expands a nonseparating interior cut without inventing output separation", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const t = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const mesh = refineFiniteCutterMesh(v, t, cutter);
  const output = expandFiniteGroups(
    v,
    mesh.addedVertices,
    mesh.triangles,
    mesh.groups,
  );
  expect(output).toHaveLength(1);
  expect(output[0].positions.length).toBe(mesh.triangles.length * 3);
  let twiceArea = 0;
  const p = output[0].positions;
  for (let i = 0; i < p.length; i += 9) {
    const signed =
      (p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) -
      (p[i + 4] - p[i + 1]) * (p[i + 6] - p[i]);
    expect(signed).toBeGreaterThan(0);
    twiceArea += signed;
  }
  expect(twiceArea).toBeCloseTo(1, 7);
  expect(mesh.cutIncidence[0].kind).toBe("nonseparating");
});

it("demonstrates that coordinate-only publication welds an interior cut closed", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const t = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const mesh = refineFiniteCutterMesh(v, t, cutter);
  const [output] = expandFiniteGroups(
    v,
    mesh.addedVertices,
    mesh.triangles,
    mesh.groups,
  );
  const topology = analyzeMesh(output.positions);
  // Only the original triangle's three edges are boundaries. The two faces
  // on the finite cut are welded together again by coordinate indexing.
  expect(topology.boundaryEdges).toBe(3);
  expect(mesh.cutIncidence[0].faces).toHaveLength(2);
  expect(mesh.cutIncidence[0].kind).toBe("nonseparating");
});

it("shows that duplicated indexed midpoints retain both sides of an interior slit", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const mesh = refineFiniteCutterMesh(v, new Uint32Array([0, 1, 2]), cutter);
  const vertices = [...v, ...mesh.addedVertices];
  const [a, b] = mesh.constraints;
  const midpoint = [0, 1, 2].map((axis) =>
    Math.fround((vertices[a * 3 + axis] + vertices[b * 3 + axis]) / 2),
  );
  const firstMidpoint = vertices.length / 3;
  vertices.push(...midpoint, ...midpoint);
  const faces: number[] = [];
  let cutFaces = 0;
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const triangle = [...mesh.triangles.slice(i, i + 3)];
    const edge = triangle.findIndex(
      (id, j) =>
        (id === a && triangle[(j + 1) % 3] === b) ||
        (id === b && triangle[(j + 1) % 3] === a),
    );
    if (edge < 0) faces.push(...triangle);
    else {
      const start = triangle[edge],
        end = triangle[(edge + 1) % 3],
        third = triangle[(edge + 2) % 3];
      const mid = firstMidpoint + cutFaces++;
      faces.push(start, mid, third, mid, end, third);
    }
  }
  expect(cutFaces).toBe(2);
  const index = new Uint32Array(faces);
  const position = Float32Array.from(
    faces.flatMap((id) => vertices.slice(id * 3, id * 3 + 3)),
  );
  const indexed = analyzeIndexedMesh(Float64Array.from(vertices), index);
  expect(indexed.boundaryEdges).toBe(7); // three outer and four slit edges
  expect(indexed.components).toHaveLength(1);
  expect(analyzeMesh(position).boundaryEdges).toBe(3);
});

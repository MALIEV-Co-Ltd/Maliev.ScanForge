import { expect, it } from "vitest";
import { collectFiniteCutterHits } from "../src/scan-edit-general-split";
import { buildSparseFiniteEdgeContactsIndexed } from "../src/scan-split-finite-edges";
import { buildFiniteFaceInput } from "../src/scan-split-finite-face-input";
import { triangulateFiniteFace } from "../src/scan-split-finite-face";
import {
  assembleFiniteFaceMesh,
  assembleFiniteSparseFaceMesh,
} from "../src/scan-split-finite-assembly";
import { groupFiniteTrianglesCompact } from "../src/scan-split-finite-group";
import type { Vec3 } from "../src/types";

it("rejects interior cutter contacts rounded onto source vertices", () => {
  const vertices = new Float32Array([
    100000000, 0, 0, 100000008, 0, 0, 100000000, 8, 0,
  ]);
  const cutter = new Float32Array([
    100000000, 0, -1, 100000008, 0, 10000000000, 100000008, 0, -1,
  ]);
  const before = [vertices.slice(), cutter.slice()];
  expect(() =>
    collectFiniteCutterHits(vertices, new Uint32Array([0, 1, 2]), cutter, {
      preciseCoordinates: true,
    }),
  ).toThrow(/binary64 precision/i);
  expect([vertices, cutter]).toEqual(before);
});

it("retains the exact source-edge parameter for a large-coordinate witness", () => {
  const vertices = new Float32Array([
    100000000, 0, 0, 100000008, 0, 0, 100000000, 8, 0,
  ]);
  const cutter = new Float32Array([
    100000000, 0, -1, 100000008, 0, 1000000000, 100000000, 0, 1,
  ]);
  const result = collectFiniteCutterHits(
    vertices,
    new Uint32Array([0, 1, 2]),
    cutter,
    { preciseCoordinates: true },
  );
  const contact = result.contacts.find((entry) => entry.exactWitness)!;
  expect(contact).toBeDefined();
  expect(contact.t).toBe(1 / 1000000001);
  const hit = result.faces.get(0)![0];
  expect(
    hit.sourceEdges
      .flat()
      .some((entry) => entry.edge === 0 && entry.t === contact.t),
  ).toBe(true);
});

it("collects a precise finite segment inside one Float32 cell", () => {
  const vertices = new Float32Array([
    100000000, 0, 0, 100000008, 0, 0, 100000000, 8, 0,
  ]);
  const cutter = new Float32Array([
    100000000,
    2,
    -1,
    100000008,
    2,
    1,
    100000008,
    2,
    1 + 2 ** -23,
  ]);
  const hit = collectFiniteCutterHits(
    vertices,
    new Uint32Array([0, 1, 2]),
    cutter,
    { preciseCoordinates: true },
  ).faces.get(0)![0];
  expect(hit.points).toHaveLength(2);
  expect(hit.points[0][0]).not.toBe(hit.points[1][0]);
  expect(hit.sourceEdges).toEqual([[], []]);
});

it("retains contained coplanar overlap without fabricating source-edge contacts", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([
    0.125, 0.125, 0, 0.25, 0.125, 0, 0.125, 0.25, 0,
  ]);
  const result = collectFiniteCutterHits(vertices, triangles, cutter);
  expect(result.faces.get(0)).toEqual([
    {
      cutterFace: 0,
      coplanar: true,
      points: [
        [0.125, 0.125, 0],
        [0.25, 0.125, 0],
        [0.125, 0.25, 0],
      ],
      sourceEdges: [[], [], []],
    },
  ]);
  expect(result.contacts).toEqual([]);
});

it("collects actual finite segments with indexed source-edge and cutter-facet identities", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const cutter = new Float32Array([0.25, -2, -1, 0.25, 2, -1, 0.25, 0, 1]);
  const before = [...vertices, ...triangles, ...cutter];
  const result = collectFiniteCutterHits(vertices, triangles, cutter);
  expect([...result.faces.keys()]).toEqual([0, 1]);
  expect(result.faces.get(0)![0].cutterFace).toBe(0);
  expect(result.faces.get(0)![0].points).toHaveLength(2);
  expect(
    result.contacts.some(
      (c) => c.edge[0] === 0 && c.edge[1] === 1 && c.t === 0.25,
    ),
  ).toBe(true);
  expect(
    result.contacts.some(
      (c) => c.edge[0] === 1 && c.edge[1] === 0 && c.t === 0.75,
    ),
  ).toBe(true);
  expect([...vertices, ...triangles, ...cutter]).toEqual(before);
});

it("preserves selection identity and supports budget and abort", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]),
    t = new Uint32Array([0, 1, 2, 1, 0, 3]),
    cutter = new Float32Array([0.25, -2, -1, 0.25, 2, -1, 0.25, 0, 1]);
  const result = collectFiniteCutterHits(v, t, cutter, {
    selection: new Uint8Array([1, 0]),
  });
  expect([...result.faces.keys()]).toEqual([0]);
  expect(() =>
    buildSparseFiniteEdgeContactsIndexed(v, t, result.contacts, {
      selection: new Uint8Array([1, 0]),
    }),
  ).toThrow(/unselected/i);
  expect(() => collectFiniteCutterHits(v, t, cutter, { maxWork: 1 })).toThrow(
    /budget/i,
  );
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    collectFiniteCutterHits(v, t, cutter, { signal: controller.signal }),
  ).toThrow(/abort/i);
  const during = new AbortController();
  expect(() =>
    collectFiniteCutterHits(v, t, cutter, {
      signal: during.signal,
      onProgress: () => during.abort(),
    }),
  ).toThrow(/abort/i);
});

it("keeps a wholly interior finite cut connected without extending it to the source boundary", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    t = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const collected = collectFiniteCutterHits(v, t, cutter);
  const registry = buildSparseFiniteEdgeContactsIndexed(
    v,
    t,
    collected.contacts,
  );
  const ids: [number, number, number] = [0, 1, 2],
    points: [Vec3, Vec3, Vec3] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ];
  const input = buildFiniteFaceInput(
    ids,
    collected.faces.get(0) ?? [],
    registry.get(0) ?? [],
  );
  const mesh = triangulateFiniteFace(points, input.segments, input);
  const output = assembleFiniteFaceMesh(v, [
    { ids, boundaries: input.boundaryContacts, mesh },
  ]);
  expect(
    new Set(groupFiniteTrianglesCompact(output.triangles, output.constraints))
      .size,
  ).toBe(1);
  expect(output.constraints).toHaveLength(2);
  const positions = (id: number) =>
    id < 3
      ? [...v.slice(id * 3, id * 3 + 3)]
      : [...output.addedVertices.slice((id - 3) * 3, (id - 3) * 3 + 3)];
  for (const id of output.constraints) {
    const [x, y, z] = positions(id);
    expect(x).toBeCloseTo(0.5, 6);
    expect(y).toBeGreaterThanOrEqual(0.099999);
    expect(y).toBeLessThanOrEqual(0.200001);
    expect(z).toBe(0);
  }
});

it("retains the near-end offset when the forward edge fraction rounds to one", () => {
  const x = Math.fround(2e-20),
    v = new Float32Array([1, 0, 0, 1e-20, 0, 0, 0, 1, 0]),
    t = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([x, -1, -1, x, 2, -1, x, 0, 1]);
  const result = collectFiniteCutterHits(v, t, cutter);
  const contact = result.contacts.find(
    (c) => c.edge[0] === 0 && c.edge[1] === 1,
  )!;
  expect(contact.t).toBe(1);
  expect(contact.fromEnd).toBeGreaterThan(0);
});

it("ignores a disjoint cutter within the expanded search tolerance", () => {
  const x = Math.fround(2e-20),
    v = new Float32Array([1, 0, 0, 1e-20, 0, 0, 0, 1, 0]),
    t = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([x, 0, 1e-7, x, 1, 1e-7, x, 0, 2e-7]);
  const result = collectFiniteCutterHits(v, t, cutter);
  expect(result.faces.size).toBe(0);
  expect(result.contacts).toEqual([]);
});

it("ignores a disjoint cutter even when its exact bounding box overlaps the source", () => {
  const x = Math.fround(2e-20),
    v = new Float32Array([1, 0, 0, 1e-20, 0, 0, 0, 1, 0]),
    t = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([x, -2, -1, x, 1, 1, x, -3, 1]);
  const result = collectFiniteCutterHits(v, t, cutter);
  expect(result.faces.size).toBe(0);
  expect(result.contacts).toEqual([]);
});

it("retains a Float32-visible intersection arbitrarily near an indexed edge endpoint", () => {
  const x = Math.fround(2e-20),
    v = new Float32Array([1, 0, 0, 1e-20, 0, 0, 0, 1, 0]),
    t = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([x, -1, -1, x, 2, -1, x, 0, 1]);
  const result = collectFiniteCutterHits(v, t, cutter);
  expect(
    result.faces
      .get(0)![0]
      .points.some((p) => Math.fround(p[0]) === x && p[1] === 0),
  ).toBe(true);
  expect(result.contacts.some((c) => c.edge[0] === 0 && c.edge[1] === 1)).toBe(
    true,
  );
});

it("assembles the real near-endpoint cutter intersection across both source edges", () => {
  const x = Math.fround(2e-20),
    v = new Float32Array([1, 0, 0, 1e-20, 0, 0, 0, 1, 0]),
    t = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([x, -1, -1, x, 2, -1, x, 0, 1]);
  const hit = collectFiniteCutterHits(v, t, cutter);
  const registry = buildSparseFiniteEdgeContactsIndexed(v, t, hit.contacts);
  const ids: [number, number, number] = [0, 1, 2],
    face = [0, 1, 2].map(
      (i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]] as Vec3,
    ) as [Vec3, Vec3, Vec3];
  const input = buildFiniteFaceInput(
    ids,
    hit.faces.get(0) ?? [],
    registry.get(0) ?? [],
  );
  let checks = 0;
  const signal = {
    get aborted() {
      checks++;
      return false;
    },
  } as AbortSignal;
  expect(() =>
    triangulateFiniteFace(face, input.segments, {
      ...input,
      maxWork: 17,
      signal,
    }),
  ).toThrow(/budget/i);
  expect(checks).toBeLessThanOrEqual(18);
  const mesh = triangulateFiniteFace(face, input.segments, input);
  const output = assembleFiniteFaceMesh(v, [
    { ids, boundaries: input.boundaryContacts, mesh },
  ]);
  expect(output.constraints).toHaveLength(2);
  const endpoints = [...output.constraints]
    .map((id) =>
      id < 3
        ? [...v.slice(id * 3, id * 3 + 3)]
        : [...output.addedVertices.slice((id - 3) * 3, (id - 3) * 3 + 3)],
    )
    .sort((a, b) => a[1] - b[1]);
  expect(endpoints).toEqual([
    [x, 0, 0],
    [x, 1, 0],
  ]);
  expect(
    new Set(groupFiniteTrianglesCompact(output.triangles, output.constraints))
      .size,
  ).toBe(2);
  expect([...v]).toEqual([1, 0, 0, Math.fround(1e-20), 0, 0, 0, 1, 0]);
});

it("retains the two-extreme-contact cut across cyclic source and cutter orientations", () => {
  const x = Math.fround(2e-20),
    v = new Float32Array([1, 0, 0, 1e-20, 0, 0, 0, 1, 0]);
  const cutters = [
    new Float32Array([x, -1, -1, x, 2, -1, x, 0, 1]),
    new Float32Array([x, 0, 1, x, 2, -1, x, -1, -1]),
  ];
  for (const ids of [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ] as [number, number, number][])
    for (const cutter of cutters) {
      const triangles = new Uint32Array(ids),
        hit = collectFiniteCutterHits(v, triangles, cutter);
      const registry = buildSparseFiniteEdgeContactsIndexed(
        v,
        triangles,
        hit.contacts,
      );
      const input = buildFiniteFaceInput(
        ids,
        hit.faces.get(0) ?? [],
        registry.get(0) ?? [],
      );
      const face = ids.map(
        (i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]] as Vec3,
      ) as [Vec3, Vec3, Vec3];
      const mesh = triangulateFiniteFace(face, input.segments, input);
      const result = assembleFiniteFaceMesh(v, [
        { ids, boundaries: input.boundaryContacts, mesh },
      ]);
      expect(result.constraints).toHaveLength(2);
      expect(
        new Set(
          groupFiniteTrianglesCompact(result.triangles, result.constraints),
        ).size,
      ).toBe(2);
    }
});

it("runs finite collection through sparse assembly while leaving an unrelated face unchanged", () => {
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 3, 0, 0, 4, 0, 0, 3, 1, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 1, 0, 3, 4, 5, 6]);
  const cutter = new Float32Array([0.25, -2, -1, 0.25, 2, -1, 0.25, 0, 1]);
  const collected = collectFiniteCutterHits(vertices, indices, cutter);
  const registry = buildSparseFiniteEdgeContactsIndexed(
    vertices,
    indices,
    collected.contacts,
  );
  const affected = new Set([...collected.faces.keys(), ...registry.keys()]);
  const refined = new Map(
    [...affected].map((f) => {
      const ids = [...indices.slice(f * 3, f * 3 + 3)] as [
        number,
        number,
        number,
      ];
      const face = ids.map(
        (id) =>
          [
            vertices[id * 3],
            vertices[id * 3 + 1],
            vertices[id * 3 + 2],
          ] as Vec3,
      ) as [Vec3, Vec3, Vec3];
      const input = buildFiniteFaceInput(
        ids,
        collected.faces.get(f) ?? [],
        registry.get(f) ?? [],
      );
      return [
        f,
        {
          ids,
          boundaries: input.boundaryContacts,
          mesh: triangulateFiniteFace(face, input.segments, input),
        },
      ] as const;
    }),
  );
  const result = assembleFiniteSparseFaceMesh(vertices, indices, refined);
  expect([...result.triangles.slice(result.faceOffsets[2] * 3)]).toEqual([
    4, 5, 6,
  ]);
  expect(
    new Set(groupFiniteTrianglesCompact(result.triangles, result.constraints))
      .size,
  ).toBe(3);
  expect([...indices]).toEqual([0, 1, 2, 1, 0, 3, 4, 5, 6]);
});

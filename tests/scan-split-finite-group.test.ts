import { expect, it } from "vitest";
import {
  groupFiniteTriangles,
  groupFiniteTrianglesCompact,
} from "../src/scan-split-finite-group";
import { triangulateFiniteFace } from "../src/scan-split-finite-face";
import type { Vec3 } from "../src/types";

const face: [Vec3, Vec3, Vec3] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];

it("keeps a surface connected around both ends of a wholly interior cut", () => {
  const mesh = triangulateFiniteFace(face, [
    [
      [0.5, 0.1, 0],
      [0.5, 0.2, 0],
    ],
  ]);
  const groups = groupFiniteTriangles(mesh.triangles, mesh.constraints);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toHaveLength(mesh.triangles.length);
});

it("separates a face when a finite cut joins two source boundary edges", () => {
  const mesh = triangulateFiniteFace(face, [
    [
      [0, 0.25, 0],
      [0.5, 0.5, 0],
    ],
  ]);
  const groups = groupFiniteTriangles(mesh.triangles, mesh.constraints);
  expect(groups).toHaveLength(2);
  expect(groups.reduce((sum, g) => sum + g.length, 0)).toBe(
    mesh.triangles.length,
  );
});

it("groups by vertex identity and does not weld disconnected coincident coordinates", () => {
  expect(
    groupFiniteTriangles(
      [
        [0, 1, 2],
        [3, 4, 5],
      ],
      [],
    ),
  ).toEqual([[0], [1]]);
});

it("rejects non-manifold source incidence and missing cut edges", () => {
  expect(() =>
    groupFiniteTriangles(
      [
        [0, 1, 2],
        [1, 0, 3],
        [0, 1, 4],
      ],
      [],
    ),
  ).toThrow(/non.manifold/i);
  expect(() => groupFiniteTriangles([[0, 1, 2]], [[0, 3]])).toThrow(
    /cut edge/i,
  );
});

it("honors cancellation and a counted work budget without changing inputs", () => {
  const triangles: [number, number, number][] = [
    [0, 1, 2],
    [1, 0, 3],
  ];
  const before = JSON.stringify(triangles),
    controller = new AbortController();
  controller.abort();
  expect(() =>
    groupFiniteTriangles(triangles, [], { signal: controller.signal }),
  ).toThrow(/abort/i);
  expect(() => groupFiniteTriangles(triangles, [], { maxWork: 1 })).toThrow(
    /budget/i,
  );
  expect(JSON.stringify(triangles)).toBe(before);
});

it("rejects duplicate facets regardless of their winding", () => {
  expect(() =>
    groupFiniteTriangles(
      [
        [0, 1, 2],
        [2, 1, 0],
      ],
      [],
    ),
  ).toThrow(/duplicate/i);
});

it("keeps point-only contacts in separate edge-connected groups", () => {
  expect(
    groupFiniteTriangles(
      [
        [0, 1, 2],
        [0, 3, 4],
      ],
      [],
    ),
  ).toEqual([[0], [1]]);
});

it("groups compact indexed triangles across non-cut edges without welding identities", () => {
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3, 4, 5, 6]);
  expect([
    ...groupFiniteTrianglesCompact(triangles, new Uint32Array()),
  ]).toEqual([0, 0, 2]);
  expect([
    ...groupFiniteTrianglesCompact(triangles, new Uint32Array([0, 1])),
  ]).toEqual([0, 1, 2]);
  expect([...triangles]).toEqual([0, 1, 2, 1, 0, 3, 4, 5, 6]);
});

it("keeps differently selected faces in separate compact components", () => {
  const tris = new Uint32Array([0, 1, 2, 1, 0, 3]);
  expect([
    ...groupFiniteTrianglesCompact(tris, new Uint32Array(), {
      partition: new Uint8Array([1, 0]),
    }),
  ]).toEqual([0, 1]);
  expect([
    ...groupFiniteTrianglesCompact(tris, new Uint32Array(), {
      partition: new Uint8Array([1, 1]),
    }),
  ]).toEqual([0, 0]);
  expect(() =>
    groupFiniteTrianglesCompact(tris, new Uint32Array(), {
      partition: new Uint8Array([1]),
    }),
  ).toThrow(/partition/i);
  expect(() =>
    groupFiniteTrianglesCompact(tris, new Uint32Array(), {
      partition: new Uint8Array([1, 2]),
    }),
  ).toThrow(/partition/i);
});

it("rejects duplicate facets, non-manifold edges, missing cuts, and memory over-admission", () => {
  expect(() =>
    groupFiniteTrianglesCompact(
      new Uint32Array([0, 1, 2, 2, 1, 0]),
      new Uint32Array(),
    ),
  ).toThrow(/duplicate/i);
  expect(() =>
    groupFiniteTrianglesCompact(
      new Uint32Array([0, 1, 2, 1, 0, 3, 0, 1, 4]),
      new Uint32Array(),
    ),
  ).toThrow(/non.manifold/i);
  expect(() =>
    groupFiniteTrianglesCompact(
      new Uint32Array([0, 1, 2]),
      new Uint32Array([0, 3]),
    ),
  ).toThrow(/cut edge/i);
  expect(() =>
    groupFiniteTrianglesCompact(new Uint32Array([0, 1, 2]), new Uint32Array(), {
      maxTypedBytes: 1,
    }),
  ).toThrow(/memory/i);
});

it("matches independent edge-connected grouping on a cut grid", () => {
  const width = 25;
  const triangles: [number, number, number][] = [];
  const cuts: [number, number][] = [];
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const a = y * (width + 1) + x,
        b = a + 1,
        c = a + width + 1,
        d = c + 1;
      triangles.push([a, b, d], [a, d, c]);
      if (x === 12) cuts.push([a, c]);
    }
  const expected = groupFiniteTriangles(triangles, cuts)
    .map((g) => g.join(","))
    .sort();
  const labels = groupFiniteTrianglesCompact(
    new Uint32Array(triangles.flat()),
    new Uint32Array(cuts.flat()),
  );
  const groups = new Map<number, number[]>();
  labels.forEach((id, i) => {
    const g = groups.get(id) ?? [];
    g.push(i);
    groups.set(id, g);
  });
  expect([...groups.values()].map((g) => g.join(",")).sort()).toEqual(expected);
});

it("honors a compact grouping budget and an observable abort", () => {
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  expect(() =>
    groupFiniteTrianglesCompact(triangles, new Uint32Array(), { maxWork: 2 }),
  ).toThrow(/budget/i);
  let checks = 0;
  const signal = {
    get aborted() {
      return ++checks > 8;
    },
  } as AbortSignal;
  expect(() =>
    groupFiniteTrianglesCompact(triangles, new Uint32Array(), { signal }),
  ).toThrow(/abort/i);
  expect([...triangles]).toEqual([0, 1, 2, 1, 0, 3]);
  let shared = 0;
  expect(() =>
    groupFiniteTrianglesCompact(triangles, new Uint32Array(), {
      check: () => {
        if (++shared === 3) throw new Error("shared budget");
      },
    }),
  ).toThrow(/shared budget/i);
});

it("groups a 100,000-facet indexed strip with bounded helper allocations", () => {
  const cells = 50_000,
    triangles = new Uint32Array(cells * 6);
  for (let i = 0; i < cells; i++) {
    const a = 2 * i;
    triangles.set([a, a + 2, a + 3, a, a + 3, a + 1], i * 6);
  }
  const labels = groupFiniteTrianglesCompact(
    triangles,
    new Uint32Array([cells, cells + 1]),
    { maxTypedBytes: 4_000_000 },
  );
  expect(labels.length).toBe(100_000);
  expect(labels[0]).toBe(0);
  expect(labels[cells - 1]).toBe(0);
  expect(labels[cells]).toBe(cells);
  expect(labels[labels.length - 1]).toBe(cells);
});

it("groups a one-million-facet indexed strip under the typed-array budget", () => {
  const cells = 500_000,
    triangles = new Uint32Array(cells * 6);
  for (let i = 0; i < cells; i++) {
    const a = 2 * i;
    triangles.set([a, a + 2, a + 3, a, a + 3, a + 1], i * 6);
  }
  const labels = groupFiniteTrianglesCompact(
    triangles,
    new Uint32Array([cells, cells + 1]),
    { maxTypedBytes: 28_000_000 },
  );
  expect(labels.length).toBe(1_000_000);
  expect(labels[cells - 1]).toBe(0);
  expect(labels[cells]).toBe(cells);
  expect(labels[labels.length - 1]).toBe(cells);
});

import { expect, it } from "vitest";
import {
  inspectFiniteTriangleContact,
  splitGeneralCutter,
} from "../src/scan-edit-general-split";
import type { Vec3 } from "../src/types";

const source: [Vec3, Vec3, Vec3] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];

it("rounds precise interior intersections consistently on a tilted plane", () => {
  const result = inspectFiniteTriangleContact(
    [
      [0, 0, 0],
      [8, 0, 8],
      [0, 8, 0],
    ],
    [
      [0, 2, -1],
      [8, 2, 10],
      [8, 2, 14],
    ],
    { preciseCoordinates: true },
  );
  expect(result.points).toHaveLength(2);
  for (const point of result.points) expect(point[2]).toBe(point[0]);
});

it("keeps exact plane equality across varied tilted intersections", () => {
  const face: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [8, 0, 8],
    [0, 8, 0],
  ];
  for (let below = 1; below <= 8; below++)
    for (let above = 1; above <= 8; above++) {
      const cutter: [Vec3, Vec3, Vec3] = [
        [0, 2, -below],
        [8, 2, 8 + above],
        [8, 2, 9 + above],
      ];
      const result = inspectFiniteTriangleContact(face, cutter, {
        preciseCoordinates: true,
      });
      for (const point of result.points)
        expect(point[2], `${below}/${above}`).toBe(point[0]);
    }
});

it("rejects distinct crossings that collapse to one binary64 point", () => {
  expect(() =>
    inspectFiniteTriangleContact(
      [
        [100000000, 0, 0],
        [100000008, 0, 0],
        [100000000, 8, 0],
      ],
      [
        [100000000, 2, -1],
        [100000008, 2, 100000000],
        [100000008, 2, 100000008],
      ],
      { preciseCoordinates: true },
    ),
  ).toThrow(/precision/i);
});

it("reconciles the same rational crossing calculated from different triangle edges", () => {
  const result = inspectFiniteTriangleContact(
    [
      [0, 1, 0],
      [1, -2, 0],
      [0, -1, 0],
    ],
    [
      [-1, 0, -1],
      [3, 0, 2],
      [-1, 0, 1],
    ],
    { preciseCoordinates: true },
  );
  expect(result.points).toHaveLength(2);
  const endpoint = result.points.find((p) => p[0] > 0.3)!;
  expect(endpoint[0]).toBeCloseTo(1 / 3, 15);
  expect(result.sourceEdges[result.points.indexOf(endpoint)]).toContainEqual({
    edge: 0,
    t: expect.closeTo(1 / 3, 15),
  });
});

it("keeps distinct nearby source-edge and cutter-edge crossings", () => {
  const result = inspectFiniteTriangleContact(
    [
      [100000000, 0, 0],
      [100000008, 0, 0],
      [100000000, 8, 0],
    ],
    [
      [100000000, 2, -3],
      [100000008, 2, 1 + 2 ** -23],
      [100000008, 2, 1],
    ],
    { preciseCoordinates: true },
  );
  expect(result.points).toHaveLength(2);
  expect(result.points[0][0]).not.toBe(result.points[1][0]);
  expect(Math.fround(result.points[0][0])).toBe(
    Math.fround(result.points[1][0]),
  );
  expect(result.sourceEdges.filter((edges) => edges.length)).toHaveLength(1);
});

it("retains a finite interior segment shorter than a Float32 cell", () => {
  const result = inspectFiniteTriangleContact(
    [
      [100000000, 0, 0],
      [100000008, 0, 0],
      [100000000, 8, 0],
    ],
    [
      [100000000, 2, -1],
      [100000008, 2, 1],
      [100000008, 2, 1 + 2 ** -23],
    ],
    { preciseCoordinates: true },
  );
  expect(result.points).toHaveLength(2);
  expect(result.points[0][0]).not.toBe(result.points[1][0]);
  expect(Math.fround(result.points[0][0])).toBe(
    Math.fround(result.points[1][0]),
  );
});

it("retains finite interior intersections without inventing boundary provenance", () => {
  const result = inspectFiniteTriangleContact(source, [
    [0.5, 0.1, -1],
    [0.5, 0.3, -1],
    [0.5, 0.1, 1],
  ]);
  expect(result.coplanar).toBe(false);
  expect(
    result.points.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)).sort(),
  ).toEqual([
    [0.5, 0.1, 0],
    [0.5, 0.2, 0],
  ]);
  expect(result.sourceEdges).toEqual([[], []]);
});

it("reports authoritative source-edge parameters at both finite segment ends", () => {
  const result = inspectFiniteTriangleContact(source, [
    [0.5, -1, -1],
    [0.5, 1, -1],
    [0.5, 0, 1],
  ]);
  expect(result.points).toHaveLength(2);
  const records = result.points
    .map((point, i) => ({ point, edges: result.sourceEdges[i] }))
    .sort((a, b) => a.point[1] - b.point[1]);
  expect(records[0].point).toEqual([0.5, 0, 0]);
  expect(records[0].edges).toEqual([{ edge: 0, t: 0.5 }]);
  expect(records[1].point).toEqual([0.5, 0.5, 0]);
  expect(records[1].edges).toEqual([{ edge: 1, t: 0.5 }]);
});

it("retains both source-edge identities for a source vertex contact", () => {
  const cutter: [Vec3, Vec3, Vec3] = [
    [0, -1, -1],
    [0, 1, -1],
    [0, 0, 1],
  ];
  const result = inspectFiniteTriangleContact(source, cutter);
  expect(
    inspectFiniteTriangleContact(source, cutter, { preciseCoordinates: true }),
  ).toEqual(result);
  const vertex = result.points.findIndex(
    (p) => p[0] === 0 && p[1] === 0 && p[2] === 0,
  );
  expect(vertex).toBeGreaterThanOrEqual(0);
  expect(result.sourceEdges[vertex]).toEqual([
    { edge: 0, t: 0 },
    { edge: 2, t: 1 },
  ]);
});

it("records coplanar overlapping boundary endpoints with their edge parameters", () => {
  const cutter: [Vec3, Vec3, Vec3] = [
    [0.25, 0, 0],
    [0.75, 0, 0],
    [0.5, -1, 0],
  ];
  const before = JSON.stringify([source, cutter]);
  const result = inspectFiniteTriangleContact(source, cutter);
  expect(result.coplanar).toBe(true);
  const records = result.points
    .map((point, i) => ({ point, edges: result.sourceEdges[i] }))
    .sort((a, b) => a.point[0] - b.point[0]);
  expect(records).toEqual([
    { point: [0.25, 0, 0], edges: [{ edge: 0, t: 0.25 }] },
    { point: [0.75, 0, 0], edges: [{ edge: 0, t: 0.75 }] },
  ]);
  expect(JSON.stringify([source, cutter])).toBe(before);
});

it("detects a coplanar cutter contained strictly inside the source face", () => {
  const cutter: [Vec3, Vec3, Vec3] = [
    [0.1, 0.1, 0],
    [0.2, 0.1, 0],
    [0.1, 0.2, 0],
  ];
  const result = inspectFiniteTriangleContact(source, cutter);
  expect(result.coplanar).toBe(true);
  expect(result.points).toEqual(cutter);
  expect(result.sourceEdges).toEqual([[], [], []]);
});

it("retains interior cutter corners as well as source-edge overlap contacts", () => {
  const result = inspectFiniteTriangleContact(source, [
    [0.25, -0.25, 0],
    [0.75, 0.25, 0],
    [0.25, 0.25, 0],
  ]);
  expect(result.coplanar).toBe(true);
  expect(result.points).toContainEqual([0.25, 0.25, 0]);
  expect(
    result.sourceEdges[
      result.points.findIndex((p) => p[1] === 0.25 && p[0] === 0.25)
    ],
  ).toEqual([]);
  expect(
    result.sourceEdges.some((edges) => edges.some((edge) => edge.edge === 0)),
  ).toBe(true);
});

it("gives reversed neighboring faces complementary source-edge parameters", () => {
  const cutter: [Vec3, Vec3, Vec3] = [
    [0.5, -1, -1],
    [0.5, 1, -1],
    [0.5, 0, 1],
  ];
  const neighbor: [Vec3, Vec3, Vec3] = [
    [1, 0, 0],
    [0, 0, 0],
    [1, -1, 0],
  ];
  for (const face of [source, neighbor]) {
    const result = inspectFiniteTriangleContact(face, cutter);
    const i = result.points.findIndex((p) => p[0] === 0.5 && p[1] === 0);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(result.sourceEdges[i]).toEqual([{ edge: 0, t: 0.5 }]);
  }
});

it("preserves Float32-visible coplanar source vertices and both incident identities", () => {
  const tiny = Math.fround(1e-20);
  const triangle: [Vec3, Vec3, Vec3] = [
    [1, 0, 0],
    [tiny, 0, 0],
    [0, 1, 0],
  ];
  const result = inspectFiniteTriangleContact(triangle, triangle);
  const i = result.points.findIndex(
    (p) => p[0] === tiny && p[1] === 0 && p[2] === 0,
  );
  expect(i).toBeGreaterThanOrEqual(0);
  expect(result.sourceEdges[i]).toEqual([
    { edge: 0, t: 1 },
    { edge: 1, t: 0 },
  ]);
  expect(result.points).not.toContainEqual([0, 0, 0]);
});

it("recognizes an exactly coincident tilted triangle as coplanar", () => {
  const face: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [7, 5, 21],
    [2, 2, 17],
  ];
  const result = inspectFiniteTriangleContact(face, face);
  expect(result.coplanar).toBe(true);
  expect(result.points).toHaveLength(3);
  for (const vertex of face) expect(result.points).toContainEqual(vertex);
});

it("does not invent a split for identical tilted source and cutter faces", () => {
  const positions = new Float32Array([0, 0, 0, 7, 5, 21, 2, 2, 17]);
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions, target: positions.slice() },
    {},
  );
  expect(result.diagnostics.splitTriangles).toBe(0);
  expect(result.segments!.filter((segment) => segment.length)).toHaveLength(1);
  expect(result.segments!.find((segment) => segment.length)).toEqual(positions);
});

it("recognizes a strictly contained tilted coplanar triangle", () => {
  const face: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [8, 4, 20],
    [4, 8, 16],
  ];
  const cutter: [Vec3, Vec3, Vec3] = [
    [3, 3, 9],
    [4, 3.5, 11.5],
    [3.5, 4, 11],
  ];
  const result = inspectFiniteTriangleContact(face, cutter);
  expect(result.coplanar).toBe(true);
  expect(result.points).toEqual(cutter);
  expect(result.sourceEdges).toEqual([[], [], []]);
});

it("retains all original vertices for varied coincident tilted triangles", () => {
  let seed = 0x70f31a4b;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.fround(((seed & 0xffff) - 32768) / 128);
  };
  for (let i = 0; i < 500; i++) {
    const face = Array.from(
      { length: 3 },
      () => [next(), next(), next()] as Vec3,
    ) as [Vec3, Vec3, Vec3];
    const result = inspectFiniteTriangleContact(face, face);
    expect(result.coplanar).toBe(true);
    expect(result.points).toHaveLength(3);
    for (const vertex of face) expect(result.points).toContainEqual(vertex);
  }
});

it("does not mistake nearby parallel tilted triangles for coplanar overlap", () => {
  const face: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [8, 4, 20],
    [4, 8, 16],
  ];
  const offset = 2 ** -20;
  const cutter = face.map(([x, y, z]) => [x, y, z + offset] as Vec3) as [
    Vec3,
    Vec3,
    Vec3,
  ];
  const result = inspectFiniteTriangleContact(face, cutter);
  expect(result.coplanar).toBe(false);
  expect(result.points).toEqual([]);
});

it("does not expose mutable references to source or cutter input", () => {
  const src: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const cutter: [Vec3, Vec3, Vec3] = [
    [0, -1, -1],
    [0, 1, -1],
    [0, 0, 1],
  ];
  const before = JSON.stringify([src, cutter]);
  const result = inspectFiniteTriangleContact(src, cutter);
  result.points[0][0] = 44;
  expect(JSON.stringify([src, cutter])).toBe(before);
});

it("retains a noncoplanar intersection between distinct Float32-near source vertices", () => {
  const tiny = Math.fround(1e-20);
  const face: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [0, tiny, 0],
    [1, 0, 0],
  ];
  const cutter: [Vec3, Vec3, Vec3] = [
    [0, -1, -1],
    [0, 1, -1],
    [0, 0, 1],
  ];
  const result = inspectFiniteTriangleContact(face, cutter);
  expect(result.points).toHaveLength(2);
  expect(result.points).toContainEqual([0, 0, 0]);
  expect(result.points).toContainEqual([0, tiny, 0]);
});

it("retains a rounded cutter crossing on a sloped source edge", () => {
  const result = inspectFiniteTriangleContact(
    [
      [0, 0, 0],
      [1, 3, 0],
      [0, 4, 0],
    ],
    [
      [0, 0, -1],
      [1, 3, -1],
      [0, 0, 2],
    ],
  );
  expect(result.points).toHaveLength(2);
  expect(
    result.points.some(
      (point) =>
        Math.abs(point[0] - 2 / 3) < 1e-12 && Math.abs(point[1] - 2) < 1e-12,
    ),
  ).toBe(true);
  const index = result.points.findIndex(
    (point) => Math.abs(point[0] - 2 / 3) < 1e-12,
  );
  expect(result.sourceEdges[index]).toEqual([
    { edge: 0, t: expect.closeTo(2 / 3, 12) },
  ]);
});

it("retains the sloped-edge crossing in the shared production Split path", () => {
  const positions = new Float32Array([0, 0, 0, 1, 3, 0, 0, 4, 0]);
  const target = new Float32Array([0, 0, -1, 1, 3, -1, 0, 0, 2]);
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions, target },
    {},
  );
  const points = result.segments!.flatMap((part) =>
    Array.from({ length: part.length / 3 }, (_, i) =>
      Array.from(part.slice(i * 3, i * 3 + 3)),
    ),
  );
  expect(
    points.some(
      ([x, y, z]) =>
        Math.abs(x - 2 / 3) < 1e-6 && Math.abs(y - 2) < 1e-6 && z === 0,
    ),
  ).toBe(true);
});

it("retains the same sloped intersection when source and cutter are swapped", () => {
  const a: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 3, 0],
    [0, 4, 0],
  ];
  const b: [Vec3, Vec3, Vec3] = [
    [0, 0, -1],
    [1, 3, -1],
    [0, 0, 2],
  ];
  const forward = inspectFiniteTriangleContact(a, b);
  const reverse = inspectFiniteTriangleContact(b, a);
  const normalized = (points: Vec3[]) =>
    points.map((p) => p.map((x) => Math.round(x * 1e6) / 1e6)).sort();
  expect(normalized(reverse.points)).toEqual(normalized(forward.points));
  expect(reverse.points).toHaveLength(2);
});

it("does not report a disjoint cutter across a Float32-visible gap as an intersection", () => {
  const cutter: [Vec3, Vec3, Vec3] = [
    [0.5, -1e-15, -1],
    [0.5, -2e-15, -1],
    [0.5, -1e-15, 1],
  ];
  expect(inspectFiniteTriangleContact(source, cutter).points).toEqual([]);
});

it("rejects a rounded zero distance when exact endpoints are on the same side", () => {
  const d: Vec3 = [0.86803398875, 0.11421356237, 0.7538204263800001];
  const source: [Vec3, Vec3, Vec3] = [
    d,
    [d[0], d[1], d[2] + 1],
    [d[0], d[1] + 0.1, d[2]],
  ];
  const cutter: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 1, 0],
    [1, 0, 1],
  ];
  expect(inspectFiniteTriangleContact(source, cutter).points).toEqual([]);
});

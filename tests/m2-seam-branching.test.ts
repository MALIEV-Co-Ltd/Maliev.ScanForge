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
  expect(result.triangles.length).toBe(triangles.length);
  expect(
    analyzeIndexedMesh(Float64Array.from(result.vertices), result.triangles)
      .components,
  ).toHaveLength(2);
});

it("preserves separating paths and branches when native retention is enabled", () => {
  const vertices = new Float64Array([
    0, 0, 0, 2, 0, 0, 1, 1, 0, -1, 1, 0, -2, 0, 0, -1, -1, 0, 1, -1, 0,
  ]);
  const triangles = new Uint32Array([
    0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 1,
  ]);
  for (const [cuts, expectedComponents] of [
    [new Uint32Array([1, 0, 0, 4]), 2],
    [new Uint32Array([0, 1, 0, 3, 0, 5]), 3],
  ] as const) {
    const result = materializeFiniteSeams(vertices, triangles, cuts, {
      preciseCoordinates: true,
      retainIsolatedInterior: true,
    });
    const topology = analyzeIndexedMesh(
      Float64Array.from(result.vertices),
      result.triangles,
    );
    expect(topology.components).toHaveLength(expectedComponents);
    expect(topology.nonManifoldEdges).toBe(0);
  }
});

it("processes large closed loops and branches with native retention under the stage allowance", () => {
  const n = 20000,
    vertices = new Float32Array((n + 1) * 3),
    triangles = new Uint32Array(n * 3),
    loop = new Uint32Array(n * 2),
    branch = new Uint32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    vertices[(i + 1) * 3] = Math.cos(angle);
    vertices[(i + 1) * 3 + 1] = Math.sin(angle);
    const j = ((i + 1) % n) + 1;
    triangles.set([0, i + 1, j], 3 * i);
    loop.set([i + 1, j], 2 * i);
    branch.set([0, i + 1], 2 * i);
  }
  for (const cuts of [loop, branch]) {
    const result = materializeFiniteSeams(vertices, triangles, cuts, {
      retainIsolatedInterior: true,
      maxTypedBytes: 1024 * 1024 * 1024,
    });
    expect(result.triangles.length).toBe(triangles.length);
  }
}, 30000);

it.fails(
  "retains a simple path in a mixed loop while rejecting a disconnected intermediate fan",
  () => {
    const base = [
      0, 2, 0, 0, 1, 0, 1, 1, 0, 0.5, 1, 0, 0.5, 1.15, 0, 0.5, 1.3, 0,
    ];
    const faces = [5, 1, 4, 4, 1, 3, 5, 4, 2, 5, 0, 1, 4, 3, 2, 5, 2, 0];
    const tetra = [3, 0, 0, 4, 0, 0, 3, 1, 0, 3, 0, 1];
    const tetraFaces = [6, 8, 7, 6, 7, 9, 7, 8, 9, 8, 6, 9];
    const cuts = new Uint32Array([3, 4, 4, 5, 6, 7, 7, 8, 8, 6]);
    const run = (v: number[], f: number[]) =>
      materializeFiniteSeams(new Float32Array(v), new Uint32Array(f), cuts, {
        retainIsolatedInterior: true,
      });
    const retained = run([...base, ...tetra], [...faces, ...tetraFaces]);
    const incident = (m: ReturnType<typeof run>, a: number, b: number) => {
      const coord = (i: number) =>
        Array.from(m.vertices.slice(3 * i, 3 * i + 3)).join(",");
      const wantedA = Array.from(
        new Float32Array(base.slice(3 * a, 3 * a + 3)),
      ).join(",");
      const wantedB = Array.from(
        new Float32Array(base.slice(3 * b, 3 * b + 3)),
      ).join(",");
      const counts = new Map<string, number>();
      for (let i = 0; i < m.triangles.length; i += 3)
        for (let j = 0; j < 3; j++) {
          const x = m.triangles[i + j],
            y = m.triangles[i + ((j + 1) % 3)];
          if (
            (coord(x) === wantedA && coord(y) === wantedB) ||
            (coord(y) === wantedA && coord(x) === wantedB)
          ) {
            const k = [x, y].sort((u, v) => u - v).join(":");
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
        }
      return Math.max(0, ...counts.values());
    };
    expect(incident(retained, 3, 4)).toBe(2);
    expect(incident(retained, 4, 5)).toBe(2);
    const disconnected = run(
      [...base, ...tetra, 0.3, 1.4, 0, 0.6, 1.5, 0],
      [...faces, ...tetraFaces, 4, 10, 11],
    );
    expect(incident(disconnected, 3, 4)).toBeLessThan(2);
  },
);

it("does not allocate path scratch for loops or branches mixed with an isolated cut", () => {
  const n = 20000,
    vertices = new Float32Array((n + 4) * 3),
    triangles = new Uint32Array((n + 1) * 3),
    loop = new Uint32Array((n + 1) * 2),
    branch = new Uint32Array((n + 1) * 2);
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    vertices[(i + 1) * 3] = Math.cos(angle);
    vertices[(i + 1) * 3 + 1] = Math.sin(angle);
    const j = ((i + 1) % n) + 1;
    triangles.set([0, i + 1, j], 3 * i);
    loop.set([i + 1, j], 2 * i);
    branch.set([0, i + 1], 2 * i);
  }
  vertices.set([3, 0, 0, 4, 0, 0, 3, 1, 0], (n + 1) * 3);
  triangles.set([n + 1, n + 2, n + 3], n * 3);
  loop.set([n + 1, n + 2], n * 2);
  branch.set([n + 1, n + 2], n * 2);
  for (const cuts of [loop, branch]) {
    const common = { maxTypedBytes: 2300000 };
    const baseline = materializeFiniteSeams(vertices, triangles, cuts, common);
    const observed = materializeFiniteSeams(vertices, triangles, cuts, {
      ...common,
      retainIsolatedInterior: true,
    });
    expect(observed.triangles.length).toBe(baseline.triangles.length);
  }
}, 30000);

it("does not charge path scratch for subdivided branches under a tight stage budget", () => {
  const n = 5000,
    vertices = new Float32Array((2 * n + 1) * 3),
    triangles = new Uint32Array(n * 9),
    cuts = new Uint32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n,
      c = Math.cos(angle),
      s = Math.sin(angle),
      m = 1 + i,
      o = 1 + n + i,
      next = (i + 1) % n,
      mn = 1 + next,
      on = 1 + n + next;
    vertices.set([c * 0.5, s * 0.5, 0], 3 * m);
    vertices.set([c, s, 0], 3 * o);
    triangles.set([0, m, mn, m, o, on, m, on, mn], 9 * i);
    cuts.set([0, m, m, o], 4 * i);
  }
  const common = { maxTypedBytes: 1670000 };
  const baseline = materializeFiniteSeams(vertices, triangles, cuts, common);
  const actual = materializeFiniteSeams(vertices, triangles, cuts, {
    ...common,
    retainIsolatedInterior: true,
  });
  expect(actual.triangles.length).toBe(baseline.triangles.length);
}, 30000);

it.fails(
  "handles a small native-retained path on a sparse indexed mesh under its stage budget",
  () => {
    const vertices = new Float32Array(1000000 * 3);
    vertices.set([
      0, 2, 0, 0, 1, 0, 1, 1, 0, 0.5, 1, 0, 0.5, 1.15, 0, 0.5, 1.3, 0,
    ]);
    const faces = new Uint32Array([
      5, 1, 4, 4, 1, 3, 5, 4, 2, 5, 0, 1, 4, 3, 2, 5, 2, 0,
    ]);
    const result = materializeFiniteSeams(
      vertices,
      faces,
      new Uint32Array([3, 4, 4, 5]),
      { retainIsolatedInterior: true, maxTypedBytes: 5000000 },
    );
    expect(result.triangles.length).toBe(faces.length);
    const edges = new Map<string, number>();
    for (let i = 0; i < result.triangles.length; i += 3)
      for (let j = 0; j < 3; j++) {
        const a = result.triangles[i + j],
          b = result.triangles[i + ((j + 1) % 3)],
          k = [a, b].sort((x, y) => x - y).join(":");
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    expect(
      Array.from(edges.values()).filter((count) => count === 1),
    ).toHaveLength(4);
  },
  30000,
);

it("handles an unrelated large closed loop with a short path under the existing stage budget", () => {
  const n = 5000,
    vertices = new Float32Array((n + 7) * 3),
    triangles = new Uint32Array((n + 6) * 3),
    cuts = new Uint32Array((n + 2) * 2);
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    vertices[3 * (i + 1)] = Math.cos(angle);
    vertices[3 * (i + 1) + 1] = Math.sin(angle);
    const j = ((i + 1) % n) + 1;
    triangles.set([0, i + 1, j], 3 * i);
    cuts.set([i + 1, j], 2 * i);
  }
  const b = n + 1;
  vertices.set(
    [3, 2, 0, 3, 1, 0, 4, 1, 0, 3.5, 1, 0, 3.5, 1.15, 0, 3.5, 1.3, 0],
    3 * b,
  );
  triangles.set(
    [
      b + 5,
      b + 1,
      b + 4,
      b + 4,
      b + 1,
      b + 3,
      b + 5,
      b + 4,
      b + 2,
      b + 5,
      b,
      b + 1,
      b + 4,
      b + 3,
      b + 2,
      b + 5,
      b + 2,
      b,
    ],
    n * 3,
  );
  cuts.set([b + 3, b + 4, b + 4, b + 5], 2 * n);
  const common = { maxTypedBytes: 563000 };
  const baseline = materializeFiniteSeams(vertices, triangles, cuts, common);
  const result = materializeFiniteSeams(vertices, triangles, cuts, {
    ...common,
    retainIsolatedInterior: true,
  });
  expect(result.triangles.length).toBe(baseline.triangles.length);
}, 30000);

import { expect, it } from "vitest";
import {
  buildFiniteEdgeContacts,
  buildSparseFiniteEdgeContacts,
  buildSparseFiniteEdgeContactsIndexed,
} from "../src/scan-split-finite-edges";
import { triangulateFiniteFace } from "../src/scan-split-finite-face";
import { exactSegmentTriangleCrossing } from "../src/scan-split-exact-crossing";
import type { Vec3 } from "../src/types";

const vertices: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, -1, 0],
];
const faces: [number, number, number][] = [
  [0, 1, 2],
  [1, 0, 3],
];

it("propagates a verified cutter-edge witness to both source faces", () => {
  const v: Vec3[] = [
    [0, 0, 0],
    [1, 3, 0],
    [0, 4, 0],
    [1, 0, 0],
  ];
  const witness = {
    segment: [
      [1, 3, -1],
      [0, 0, 2],
    ] as [Vec3, Vec3],
    triangle: [v[0], v[1], v[2]] as [Vec3, Vec3, Vec3],
    edge: 0 as const,
  };
  const result = buildSparseFiniteEdgeContacts(
    v,
    [
      [0, 1, 2],
      [1, 0, 3],
    ],
    [{ edge: [0, 1], t: 2 / 3, exactWitness: witness }],
    { preciseCoordinates: true },
  );
  expect(result.get(0)![0].points[0]).toEqual([2 / 3, 2, 0]);
  expect(result.get(1)![0].points[0]).toEqual([2 / 3, 2, 0]);
  expect(result.get(0)![0].contacts[0].canonical.exactWitness).toEqual(witness);
  expect(() =>
    buildSparseFiniteEdgeContacts(
      v,
      [[0, 1, 2]],
      [{ edge: [0, 1], t: 0.5, exactWitness: witness }],
      { preciseCoordinates: true },
    ),
  ).toThrow(/inconsistent/i);
});

it("rejects a parameter inferred from a rounded witness point at large coordinates", () => {
  const v: Vec3[] = [
    [100000000, 0, 0],
    [100000008, 0, 0],
    [100000000, 8, 0],
  ];
  const witness = {
    segment: [
      [100000000, 0, -1],
      [100000008, 0, 1000000000],
    ] as [Vec3, Vec3],
    triangle: [v[0], v[1], v[2]] as [Vec3, Vec3, Vec3],
    edge: 0 as const,
  };
  const crossing = exactSegmentTriangleCrossing(
    witness.segment[0],
    witness.segment[1],
    witness.triangle,
    { exactPoint: true },
  )!;
  const roundedParameter = (crossing.roundedPoint![0] - v[0][0]) / 8;
  expect(() =>
    buildSparseFiniteEdgeContacts(
      v,
      [[0, 1, 2]],
      [{ edge: [0, 1], t: roundedParameter, exactWitness: witness }],
      { preciseCoordinates: true },
    ),
  ).toThrow(/inconsistent/i);
  expect(
    buildSparseFiniteEdgeContacts(
      v,
      [[0, 1, 2]],
      [{ edge: [0, 1], t: 1 / 1000000001, exactWitness: witness }],
      { preciseCoordinates: true },
    ).get(0)![0].points[0],
  ).toEqual(crossing.roundedPoint);
});

it("rejects distinct exact edge contacts that collapse to one binary64 point", () => {
  const v: Vec3[] = [
    [100000000, 0, 0],
    [100000008, 0, 0],
    [100000000, 8, 0],
  ];
  const cutterA: [Vec3, Vec3, Vec3] = [
    [100000000, -1, -1],
    [100000008, -1, 1000000000],
    [100000000, 1, -1],
  ];
  const cutterB: [Vec3, Vec3, Vec3] = [
    [100000000, -1, -1],
    [100000008, -1, 1000000064],
    [100000000, 1, -1],
  ];
  const a = exactSegmentTriangleCrossing(v[0], v[1], cutterA, {
    exactPoint: true,
  })!;
  const b = exactSegmentTriangleCrossing(v[0], v[1], cutterB, {
    exactPoint: true,
  })!;
  expect(a.inside && b.inside).toBe(true);
  expect(a.exactPoint).not.toEqual(b.exactPoint);
  expect(a.roundedPoint).toEqual(b.roundedPoint);
  expect(() =>
    buildSparseFiniteEdgeContacts(
      v,
      [[0, 1, 2]],
      [
        { edge: [0, 1], t: a.fraction, source: "same", exactCutter: cutterA },
        { edge: [0, 1], t: b.fraction, source: "same", exactCutter: cutterB },
      ],
      { preciseCoordinates: true },
    ),
  ).toThrow(/collaps|ambiguous/i);
});

it("propagates one contact to both incident faces with their local edge directions", () => {
  const result = buildFiniteEdgeContacts(vertices, faces, [
    { edge: [0, 1], t: 0.25 },
  ]);
  expect(result[0]).toMatchObject([
    { edge: [0, 1], points: [[0.25, 0, 0]], contacts: [{ t: 0.25 }] },
  ]);
  expect(result[1]).toMatchObject([
    { edge: [1, 0], points: [[0.25, 0, 0]], contacts: [{ t: 0.75 }] },
  ]);
});

it("retains precise contact coordinates across both incident faces", () => {
  const packed = new Float32Array([
    100000000, 0, 0, 100000008, 8, 0, 99999968, 16, 0, 100000032, -8, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const result = buildSparseFiniteEdgeContactsIndexed(
    packed,
    indices,
    [{ edge: [0, 1], t: 0.5 }],
    { preciseCoordinates: true },
  );
  expect(result.get(0)![0].points[0]).toEqual([100000004, 4, 0]);
  expect(result.get(1)![0].points[0]).toEqual([100000004, 4, 0]);
});

it("propagates a verified exact cutter contact across both incident faces", () => {
  const cutter: [Vec3, Vec3, Vec3] = [
    [0.25, -2, -1],
    [0.25, 2, -1],
    [0.25, 0, 1],
  ];
  const result = buildSparseFiniteEdgeContacts(
    vertices,
    faces,
    [{ edge: [0, 1], t: 0.25, exactCutter: cutter }],
    { preciseCoordinates: true },
  );
  expect(result.get(0)![0].points[0]).toEqual([0.25, 0, 0]);
  expect(result.get(1)![0].points[0]).toEqual([0.25, 0, 0]);
  expect(() =>
    buildSparseFiniteEdgeContacts(
      vertices,
      faces,
      [{ edge: [0, 1], t: 0.5, exactCutter: cutter }],
      { preciseCoordinates: true },
    ),
  ).toThrow(/inconsistent/i);
});

it("merges matching exact contacts despite a neighboring parameter rounding difference", () => {
  const cutter: [Vec3, Vec3, Vec3] = [
    [0.25, -2, -1],
    [0.25, 2, -1],
    [0.25, 0, 1],
  ];
  const result = buildSparseFiniteEdgeContacts(
    vertices,
    faces,
    [
      { edge: [0, 1], t: 0.25, source: "same", exactCutter: cutter },
      {
        edge: [0, 1],
        t: 0.25 + Number.EPSILON / 2,
        source: "same",
        exactCutter: cutter,
      },
    ],
    { preciseCoordinates: true },
  );
  expect(result.get(0)![0].points).toEqual([[0.25, 0, 0]]);
  expect(result.get(1)![0].points).toEqual([[0.25, 0, 0]]);
});

it("canonicalizes contact direction and keeps deterministic local order", () => {
  const contacts = [
    { edge: [1, 0] as [number, number], t: 0.25 },
    { edge: [0, 1] as [number, number], t: 0.25 },
    { edge: [1, 0] as [number, number], t: 0.75 },
  ];
  const result = buildFiniteEdgeContacts(vertices, faces, contacts);
  expect(result[0][0].points).toEqual([
    [0.25, 0, 0],
    [0.75, 0, 0],
  ]);
  expect(result[1][0].points).toEqual([
    [0.75, 0, 0],
    [0.25, 0, 0],
  ]);
});

it("does not propagate across different vertex identities at coincident coordinates", () => {
  const vs: Vec3[] = [...vertices, [0, 0, 0], [1, 0, 0], [0, -1, 0]];
  const result = buildFiniteEdgeContacts(
    vs,
    [
      [0, 1, 2],
      [5, 4, 6],
    ],
    [{ edge: [0, 1], t: 0.25 }],
  );
  expect(result[0]).toHaveLength(1);
  expect(result[1]).toEqual([]);
});

it("rejects a contact that would subdivide an unselected neighbor", () => {
  expect(() =>
    buildFiniteEdgeContacts(vertices, faces, [{ edge: [0, 1], t: 0.25 }], {
      selection: new Uint8Array([1, 0]),
    }),
  ).toThrow(/unselected/i);
});

it("rejects unresolved Float32 contact collisions and unknown edges", () => {
  expect(() =>
    buildFiniteEdgeContacts(vertices, faces, [
      { edge: [0, 1], t: 0.5 },
      { edge: [0, 1], t: 0.500000001 },
    ]),
  ).toThrow(/precision/i);
  expect(() =>
    buildFiniteEdgeContacts(vertices, faces, [{ edge: [2, 3], t: 0.5 }]),
  ).toThrow(/edge/i);
});

it("keeps distinct contacts that only collide after Float32 rounding", () => {
  const contacts = [
    { edge: [0, 1] as [number, number], t: 0.5 },
    { edge: [0, 1] as [number, number], t: 0.500000001 },
  ];
  const result = buildFiniteEdgeContacts(vertices, faces, contacts, {
    preciseCoordinates: true,
  });
  expect(result[0][0].points).toEqual([
    [0.5, 0, 0],
    [0.500000001, 0, 0],
  ]);
  expect(result[1][0].points).toEqual([
    [0.500000001, 0, 0],
    [0.5, 0, 0],
  ]);
});

it("supports budget and abort without changing caller input", () => {
  const saved = JSON.stringify(vertices),
    controller = new AbortController();
  controller.abort();
  expect(() =>
    buildFiniteEdgeContacts(vertices, faces, [], { signal: controller.signal }),
  ).toThrow(/abort/i);
  expect(() =>
    buildFiniteEdgeContacts(vertices, faces, [], { maxWork: 1 }),
  ).toThrow(/budget/i);
  expect(JSON.stringify(vertices)).toBe(saved);
  let checks = 0;
  expect(() =>
    buildSparseFiniteEdgeContacts(vertices, faces, [], {
      check: () => {
        if (++checks === 3) throw new Error("shared budget");
      },
    }),
  ).toThrow(/shared budget/i);
});

it("coalesces reversed decimal reports only when they share contact provenance", () => {
  const result = buildFiniteEdgeContacts(vertices, faces, [
    { edge: [0, 1], t: 0.1, source: "cut-A" },
    { edge: [1, 0], t: 0.9, source: "cut-A" },
  ]);
  expect(result[0][0].points).toHaveLength(1);
  expect(result[0][0].contacts[0].t).toBeCloseTo(0.1, 15);
  expect(result[1][0].contacts[0].t).toBeCloseTo(0.9, 15);
});

it("retains local edge parameters for a canonical rounded 3D point", () => {
  const vs: Vec3[] = [
    [0, 0, 0],
    [1, 3, 0],
    [0, 0, 2],
    [0, 0, -2],
  ];
  const result = buildFiniteEdgeContacts(
    vs,
    [
      [0, 1, 2],
      [1, 0, 3],
    ],
    [{ edge: [0, 1], t: 0.1, source: "cut-A" }],
  );
  expect(result[0][0].contacts[0].t).toBeCloseTo(0.1, 15);
  expect(result[1][0].contacts[0].t).toBeCloseTo(0.9, 15);
  expect(result[0][0].contacts[0].point).toEqual(
    result[1][0].contacts[0].point,
  );
});

it("does not merge ambiguous Float32 collisions without matching provenance", () => {
  for (const sources of [
    [undefined, undefined],
    ["A", "B"],
    ["A", "A"],
  ] as const) {
    expect(() =>
      buildFiniteEdgeContacts(vertices, faces, [
        { edge: [0, 1], t: 0.5, source: sources[0] },
        { edge: [0, 1], t: 0.500000001, source: sources[1] },
      ]),
    ).toThrow(/precision/i);
  }
});

it("retains all proven sources at an exact shared contact before reconciling reversed reports", () => {
  const out = buildFiniteEdgeContacts(vertices, faces, [
    { edge: [0, 1], t: 0.1, source: "A" },
    { edge: [0, 1], t: 0.1, source: "B" },
    { edge: [1, 0], t: 0.9, source: "B" },
  ]);
  expect(out[0][0].contacts).toHaveLength(1);
});

it("retains a Float32 halfway contact through opposite face orientations", () => {
  const vs: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ];
  const indexFaces: [number, number, number][] = [
    [0, 1, 2],
    [1, 0, 3],
  ];
  const contacts = buildFiniteEdgeContacts(vs, indexFaces, [
    { edge: [0, 1], t: 0.001953125349245965, source: "halfway" },
  ]);
  for (let i = 0; i < 2; i++) {
    const f = indexFaces[i].map((index) => vs[index]) as [Vec3, Vec3, Vec3];
    const contact = contacts[i][0].contacts[0];
    const result = triangulateFiniteFace(f, [], {
      boundaryContacts: [
        {
          edge: 0,
          t: contact.t,
          point: contact.point,
          canonical: contact.canonical,
        },
      ],
    });
    expect(result.vertices.map((p) => p.map(Math.fround))).toContainEqual(
      contact.point,
    );
  }
});

it("preserves contact identity on all local edge positions and both directions", () => {
  const vs: Vec3[] = [
    [0, 0, 0],
    [1, 3, 0],
    [0, 0, 2],
    [0, 0, -2],
  ];
  const first: [number, number, number][] = [
    [0, 1, 2],
    [2, 0, 1],
    [1, 2, 0],
  ];
  const second: [number, number, number][] = [
    [1, 0, 3],
    [3, 1, 0],
    [0, 3, 1],
  ];
  for (const t of [0.001953125349245965, 0.1, 0.25, 0.3333333333333333, 0.9]) {
    for (const a of first)
      for (const b of second) {
        const ids = [a, b];
        const contacts = buildFiniteEdgeContacts(vs, ids, [
          { edge: [0, 1], t, source: "cut" },
        ]);
        for (let i = 0; i < 2; i++) {
          const edge = ids[i].findIndex(
            (v, j) =>
              (v === 0 && ids[i][(j + 1) % 3] === 1) ||
              (v === 1 && ids[i][(j + 1) % 3] === 0),
          );
          const c = contacts[i][0].contacts[0];
          const out = triangulateFiniteFace(
            ids[i].map((id) => vs[id]) as [Vec3, Vec3, Vec3],
            [],
            {
              boundaryContacts: [
                {
                  edge: edge as 0 | 1 | 2,
                  t: c.t,
                  point: c.point,
                  canonical: c.canonical,
                },
              ],
            },
          );
          expect(out.vertices.map((p) => p.map(Math.fround))).toContainEqual(
            c.point,
          );
          expect(out.triangles).toHaveLength(2);
        }
      }
  }
});

it("retains a canonical near-end offset when the forward parameter rounds to one", () => {
  const vs: Vec3[] = [
    [1, 0, 0],
    [Math.fround(1e-20), 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ];
  const target = Math.fround(2e-20),
    fromEnd = (target - vs[1][0]) / (vs[0][0] - vs[1][0]);
  const out = buildSparseFiniteEdgeContacts(vs, faces, [
    { edge: [0, 1], t: 1, fromEnd, source: "cut" },
  ]);
  const a = out.get(0)![0].contacts[0],
    b = out.get(1)![0].contacts[0];
  expect(a.point).toEqual([target, 0, 0]);
  expect(b.point).toEqual(a.point);
  expect(a.canonical).toEqual({ t: 1, fromEnd, reversed: false });
  expect(b.t).toBe(fromEnd);
  expect(b.canonical).toEqual({ t: 1, fromEnd, reversed: true });
  for (let i = 0; i < 2; i++) {
    const contact = out.get(i)![0].contacts[0],
      face = faces[i].map((id) => vs[id]) as [Vec3, Vec3, Vec3];
    const mesh = triangulateFiniteFace(face, [], {
      boundaryContacts: [{ edge: 0, ...contact }],
    });
    expect(mesh.vertices[mesh.boundaryVertices[0]].map(Math.fround)).toEqual([
      target,
      0,
      0,
    ]);
    expect(mesh.triangles).toHaveLength(2);
  }
});

it("makes matching shared-edge subdivisions when cuts reach both incident faces", () => {
  const vs: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ];
  const ids: [number, number, number][] = [
    [0, 1, 2],
    [1, 0, 3],
  ];
  const contacts = buildFiniteEdgeContacts(vs, ids, [
    { edge: [0, 1], t: 0.25, source: "cut" },
  ]);
  const edgeSets: string[][] = [];
  for (let i = 0; i < 2; i++) {
    const contact = contacts[i][0].contacts[0];
    const out = triangulateFiniteFace(
      ids[i].map((id) => vs[id]) as [Vec3, Vec3, Vec3],
      [[contact.point, [0.25, i ? -0.25 : 0.25, 0]]],
      {
        boundaryContacts: [{ edge: 0, ...contact }],
        endpointBindings: [{ segment: 0, endpoint: 0, contact: 0 }],
      },
    );
    expect(out.constraints).toHaveLength(1);
    const incidence = new Map<string, number>();
    for (const [a, b, c] of out.triangles)
      for (const [x, y] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const p = out.vertices[x].map(Math.fround),
          q = out.vertices[y].map(Math.fround);
        if (p[1] === 0 && q[1] === 0) {
          const k = [p[0], q[0]].sort((m, n) => m - n).join(":");
          incidence.set(k, (incidence.get(k) ?? 0) + 1);
        }
      }
    expect([...incidence.values()]).toEqual([1, 1]);
    edgeSets.push([...incidence.keys()].sort());
  }
  expect(edgeSets[0]).toEqual(["0:0.25", "0.25:1"].sort());
  expect(edgeSets[1]).toEqual(edgeSets[0]);
});

it("retains a Float32-visible contact close to an endpoint under reversed orientation", () => {
  const near = 1e-20;
  const out = buildFiniteEdgeContacts(vertices, faces, [
    { edge: [0, 1], t: near, source: "near" },
  ]);
  const contact = out[1][0].contacts[0];
  const result = triangulateFiniteFace(
    [vertices[1], vertices[0], vertices[3]],
    [],
    {
      boundaryContacts: [{ edge: 0, ...contact }],
    },
  );
  expect(result.vertices.map((p) => p.map(Math.fround))).toContainEqual(
    contact.point,
  );
  expect(result.triangles).toHaveLength(2);
  expect(result.vertices[result.boundaryVertices[0]].map(Math.fround)).toEqual(
    contact.point,
  );
  expect(result.vertices.slice(0, 3)).toEqual([
    vertices[1],
    vertices[0],
    vertices[3],
  ]);
});

it("preserves source indexing and cut endpoints for a near-vertex contact at each local edge", () => {
  const vs: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
  ];
  for (const ids of [
    [1, 0, 2],
    [2, 1, 0],
    [0, 2, 1],
  ] as [number, number, number][]) {
    const registered = buildSparseFiniteEdgeContacts(
      vs,
      [ids],
      [{ edge: [0, 1], t: 1e-20, source: "near" }],
    );
    const edge = ids.findIndex((v, i) => v === 1 && ids[(i + 1) % 3] === 0) as
      0 | 1 | 2;
    const c = registered.get(0)![0].contacts[0];
    const face = ids.map((i) => vs[i]) as [Vec3, Vec3, Vec3];
    const out = triangulateFiniteFace(face, [[c.point, [0.25, -0.25, 0]]], {
      boundaryContacts: [{ edge, ...c }],
      endpointBindings: [{ segment: 0, endpoint: 0, contact: 0 }],
    });
    expect(out.vertices.slice(0, 3)).toEqual(face);
    const contact = out.vertices.findIndex(
      (p) => Math.fround(p[0]) === Math.fround(1e-20) && p[1] === 0,
    );
    expect(contact).toBeGreaterThanOrEqual(3);
    expect(out.constraints.some((e) => e.includes(contact))).toBe(true);
    for (const [a, b, c] of out.triangles) {
      const p = out.vertices[a],
        q = out.vertices[b],
        r = out.vertices[c];
      expect(
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]),
      ).toBeGreaterThan(0);
    }
  }
});

it("does not alias source vertices when it rotates a face for precision", () => {
  const vs: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
  ];
  const original = JSON.stringify(vs);
  const ids: [number, number, number] = [1, 0, 2];
  const c = buildSparseFiniteEdgeContacts(
    vs,
    [ids],
    [{ edge: [0, 1], t: 1e-20 }],
  ).get(0)![0].contacts[0];
  const result = triangulateFiniteFace([vs[1], vs[0], vs[2]], [], {
    boundaryContacts: [{ edge: 0, ...c }],
  });
  result.vertices[0][0] = 44;
  expect(JSON.stringify(vs)).toBe(original);
});

it("rejects incompatible extreme contacts without changing the source", () => {
  const vs: Vec3[] = [
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ];
  const ids: [number, number, number] = [2, 1, 0];
  const before = JSON.stringify(vs);
  const map = buildSparseFiniteEdgeContacts(
    vs,
    [ids],
    [
      { edge: [1, 2], t: 1e-20, source: "a" },
      { edge: [0, 1], t: 1e-20, source: "b" },
    ],
  );
  const boundaryContacts = map.get(0)!.map(({ edge, contacts }) => ({
    edge: ids.findIndex(
      (v, i) => v === edge[0] && ids[(i + 1) % 3] === edge[1],
    ) as 0 | 1 | 2,
    ...contacts[0],
  }));
  expect(() =>
    triangulateFiniteFace(ids.map((i) => vs[i]) as [Vec3, Vec3, Vec3], [], {
      boundaryContacts,
    }),
  ).toThrow(/precision/i);
  expect(JSON.stringify(vs)).toBe(before);
});

it("returns contacts only for incident faces in the sparse registry", () => {
  const vs: Vec3[] = [...vertices, [3, 0, 0], [4, 0, 0], [3, 1, 0]];
  const all: [number, number, number][] = [...faces, [4, 5, 6]];
  const input = [{ edge: [0, 1] as const, t: 0.25 }];
  const dense = buildFiniteEdgeContacts(vs, all, input);
  const sparse = buildSparseFiniteEdgeContacts(vs, all, input);
  expect([...sparse.keys()]).toEqual([0, 1]);
  expect(sparse.get(0)).toEqual(dense[0]);
  expect(sparse.get(1)).toEqual(dense[1]);
  expect(sparse.has(2)).toBe(false);
});

it("uses packed indexed source identities without expanding the mesh", () => {
  const flatVertices = new Float32Array(vertices.flat());
  const flatFaces = new Uint32Array(faces.flat());
  const beforeVertices = Array.from(flatVertices),
    beforeFaces = Array.from(flatFaces);
  const contacts = [{ edge: [0, 1] as const, t: 0.25, source: "shared" }];
  const packed = buildSparseFiniteEdgeContactsIndexed(
    flatVertices,
    flatFaces,
    contacts,
  );
  expect([...packed]).toEqual([
    ...buildSparseFiniteEdgeContacts(vertices, faces, contacts),
  ]);
  expect([...flatVertices]).toEqual(beforeVertices);
  expect([...flatFaces]).toEqual(beforeFaces);
  expect(() =>
    buildSparseFiniteEdgeContactsIndexed(flatVertices, flatFaces, contacts, {
      selection: new Uint8Array([1, 0]),
    }),
  ).toThrow(/unselected/i);
});

it("keeps incident face contact records independent when modified", () => {
  const result = buildSparseFiniteEdgeContactsIndexed(
    new Float32Array(vertices.flat()),
    new Uint32Array(faces.flat()),
    [{ edge: [0, 1], t: 0.25 }],
  );
  const left = result.get(0)![0],
    right = result.get(1)![0];
  left.contacts[0].point[0] = 0.75;
  expect(right.contacts[0].point).toEqual([0.25, 0, 0]);
  expect(left.points[0]).toEqual([0.25, 0, 0]);
});

it("rejects incomplete or invalid packed indices", () => {
  expect(() =>
    buildSparseFiniteEdgeContactsIndexed(
      new Float32Array([0, 0]),
      new Uint32Array([0, 1, 2]),
      [],
    ),
  ).toThrow(/indices|coordinates/i);
  expect(() =>
    buildSparseFiniteEdgeContactsIndexed(
      new Float32Array(vertices.flat()),
      new Uint32Array([0, 1, 99]),
      [],
    ),
  ).toThrow(/indices/i);
});

it("preserves distinct indexed identities at coincident positions in packed data", () => {
  const vs = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 0,
  ]);
  const tris = new Uint32Array([0, 1, 2, 4, 3, 5]);
  const result = buildSparseFiniteEdgeContactsIndexed(vs, tris, [
    { edge: [0, 1], t: 0.25 },
  ]);
  expect([...result.keys()]).toEqual([0]);
});

it("scans a million packed faces without allocating a face-object array", () => {
  const vs = new Float32Array(vertices.flat());
  const tris = new Uint32Array((1_000_000 + 2) * 3);
  tris.set(faces.flat(), 0);
  for (let i = 2; i < tris.length / 3; i++) tris.set([0, 2, 3], i * 3);
  const result = buildSparseFiniteEdgeContactsIndexed(vs, tris, [
    { edge: [0, 1], t: 0.25 },
  ]);
  expect([...result.keys()]).toEqual([0, 1]);
});

it("rejects non-manifold and missing contacted edges in the sparse registry", () => {
  expect(() =>
    buildSparseFiniteEdgeContacts(
      vertices,
      [...faces, [0, 1, 3]],
      [{ edge: [0, 1], t: 0.5 }],
    ),
  ).toThrow(/non-manifold/i);
  expect(() =>
    buildSparseFiniteEdgeContacts(vertices, faces, [{ edge: [2, 3], t: 0.5 }]),
  ).toThrow(/missing/i);
});

it("returns incident contacts in face-edge order regardless of input order", () => {
  const entries = [
    { edge: [0, 1] as const, t: 0.25 },
    { edge: [1, 2] as const, t: 0.5 },
  ];
  expect([...buildSparseFiniteEdgeContacts(vertices, faces, entries)]).toEqual([
    ...buildSparseFiniteEdgeContacts(vertices, faces, [...entries].reverse()),
  ]);
});

it("keeps the sparse output limited to incident faces for 100,000 unrelated facets", () => {
  const vs: Vec3[] = [...vertices];
  const all: [number, number, number][] = [...faces];
  for (let i = 0; i < 100_000; i++) {
    const n = vs.length;
    vs.push([i + 3, 0, 0], [i + 3, 1, 0], [i + 3, 0, 1]);
    all.push([n, n + 1, n + 2]);
  }
  const result = buildSparseFiniteEdgeContacts(vs, all, [
    { edge: [0, 1], t: 0.25 },
  ]);
  expect([...result.keys()]).toEqual([0, 1]);
});

it("admits more than 500,000 faces with the default linear scan budget", () => {
  const all: [number, number, number][] = [
    ...faces,
    ...Array<[number, number, number]>(600_000).fill([0, 2, 3]),
  ];
  const out = buildSparseFiniteEdgeContacts(vertices, all, [
    { edge: [0, 1], t: 0.25 },
  ]);
  expect([...out.keys()]).toEqual([0, 1]);
});

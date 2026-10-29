import { expect, it } from "vitest";
import {
  assembleFiniteFaceMesh,
  assembleFiniteSparseFaceMesh,
} from "../src/scan-split-finite-assembly";
import { triangulateFiniteFace } from "../src/scan-split-finite-face";
import { groupFiniteTrianglesCompact } from "../src/scan-split-finite-group";
import type { Vec3 } from "../src/types";

it("assembles a precise shared-edge contact without rounding its coordinate", () => {
  const vertices: Vec3[] = [
    [100000000, 0, 0],
    [100000008, 8, 0],
    [99999968, 16, 0],
    [100000032, -8, 0],
  ];
  const ids: [number, number, number][] = [
    [0, 1, 2],
    [1, 0, 3],
  ];
  const faces = ids.map((face, i) => {
    const boundaries = [
      {
        edge: 0 as const,
        t: 0.5,
        point: [100000004, 4, 0] as Vec3,
        canonical: { t: 0.5, reversed: !!i },
      },
    ];
    return {
      ids: face,
      boundaries,
      mesh: triangulateFiniteFace(
        face.map((n) => vertices[n]) as [Vec3, Vec3, Vec3],
        [],
        { boundaryContacts: boundaries, preciseCoordinates: true },
      ),
    };
  });
  const result = assembleFiniteFaceMesh(
    new Float32Array(vertices.flat()),
    faces,
    { preciseCoordinates: true },
  );
  expect(result.addedVertices).toBeInstanceOf(Float64Array);
  expect([...result.addedVertices]).toEqual([100000004, 4, 0]);
  expect([...result.triangles].filter((id) => id === 4)).toHaveLength(4);
  expect(() =>
    assembleFiniteFaceMesh(new Float32Array(vertices.flat()), faces, {
      preciseCoordinates: true,
      maxTypedBytes: 123,
    }),
  ).toThrow(/memory/i);
  expect(() =>
    assembleFiniteFaceMesh(new Float32Array(vertices.flat()), faces, {
      preciseCoordinates: true,
      maxTypedBytes: 124,
    }),
  ).not.toThrow();
});

it("shares a canonical indexed-edge contact across neighboring faces", () => {
  const vertices: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ];
  const ids: [number, number, number][] = [
    [0, 1, 2],
    [1, 0, 3],
  ];
  const faces = ids.map((face, i) => {
    const boundaries = [
      {
        edge: 0 as const,
        t: i ? 0.75 : 0.25,
        point: [0.25, 0, 0] as Vec3,
        canonical: { t: 0.25, reversed: !!i },
      },
    ];
    return {
      ids: face,
      boundaries,
      mesh: triangulateFiniteFace(
        face.map((n) => vertices[n]) as [Vec3, Vec3, Vec3],
        [],
        { boundaryContacts: boundaries },
      ),
    };
  });
  const result = assembleFiniteFaceMesh(
    new Float32Array(vertices.flat()),
    faces,
  );
  expect([...result.addedVertices]).toEqual([0.25, 0, 0]);
  const added = vertices.length;
  expect([...result.triangles].filter((n) => n === added)).toHaveLength(4);
  expect([...result.constraints]).toEqual([]);
  const sparse = assembleFiniteSparseFaceMesh(
    new Float32Array(vertices.flat()),
    new Uint32Array(ids.flat()),
    new Map(faces.map((face, i) => [i, face])),
  );
  expect([...sparse.triangles]).toEqual([...result.triangles]);
  expect([...sparse.addedVertices]).toEqual([...result.addedVertices]);
});

it("keeps coincident contacts on distinct indexed edges separate", () => {
  const vertices: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const ids: [number, number, number][] = [
    [0, 1, 2],
    [3, 4, 5],
  ];
  const faces = ids.map((face) => {
    const boundaries = [
      {
        edge: 0 as const,
        t: 0.25,
        point: [0.25, 0, 0] as Vec3,
        canonical: { t: 0.25, reversed: false },
      },
    ];
    return {
      ids: face,
      boundaries,
      mesh: triangulateFiniteFace(
        face.map((n) => vertices[n]) as [Vec3, Vec3, Vec3],
        [],
        { boundaryContacts: boundaries },
      ),
    };
  });
  const result = assembleFiniteFaceMesh(
    new Float32Array(vertices.flat()),
    faces,
  );
  expect([...result.addedVertices]).toEqual([0.25, 0, 0, 0.25, 0, 0]);
  expect(
    new Set([...result.triangles].filter((n) => n >= vertices.length)),
  ).toEqual(new Set([6, 7]));
});

it("assembles a finite cut across adjacent faces into two edge-connected components", () => {
  const vertices: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ];
  const ids: [number, number, number][] = [
    [0, 1, 2],
    [1, 0, 3],
  ];
  const boundaries = [
    [
      {
        edge: 0 as const,
        t: 0.25,
        point: [0.25, 0, 0] as Vec3,
        canonical: { t: 0.25, reversed: false },
      },
      {
        edge: 1 as const,
        t: 0.75,
        point: [0.25, 0.75, 0] as Vec3,
        canonical: { t: 0.75, reversed: false },
      },
    ],
    [
      {
        edge: 0 as const,
        t: 0.75,
        point: [0.25, 0, 0] as Vec3,
        canonical: { t: 0.25, reversed: true },
      },
      {
        edge: 2 as const,
        t: 0.25,
        point: [0.25, -0.75, 0] as Vec3,
        canonical: { t: 0.75, reversed: true },
      },
    ],
  ];
  const faces = ids.map((face, i) => {
    const segment: [Vec3, Vec3] = [
      [0.25, 0, 0],
      [0.25, i === 0 ? 0.75 : -0.75, 0],
    ];
    const endpointBindings = [
      { segment: 0, endpoint: 0 as const, contact: 0 },
      { segment: 0, endpoint: 1 as const, contact: 1 },
    ];
    const mesh = triangulateFiniteFace(
      face.map((n) => vertices[n]) as [Vec3, Vec3, Vec3],
      [segment],
      { boundaryContacts: boundaries[i], endpointBindings },
    );
    return { ids: face, boundaries: boundaries[i], mesh };
  });
  const source = new Float32Array(vertices.flat()),
    original = Array.from(source);
  const result = assembleFiniteFaceMesh(source, faces);
  const groups = groupFiniteTrianglesCompact(
    result.triangles,
    result.constraints,
  );
  expect(new Set(groups).size).toBe(2);
  expect(result.constraints).toHaveLength(4);
  expect([...result.faceOffsets]).toEqual([0, 3, 6]);
  expect([...source]).toEqual(original);
});

it("rejects inconsistent edge identity, insufficient storage and cancellation", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const face: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const boundaries = [
    {
      edge: 0 as const,
      t: 0.25,
      point: [0.25, 0, 0] as Vec3,
      canonical: { t: 0.25, reversed: false },
    },
  ];
  const mesh = triangulateFiniteFace(face, [], {
    boundaryContacts: boundaries,
  });
  const faces = [
    { ids: [0, 1, 2] as [number, number, number], boundaries, mesh },
  ];
  expect(() =>
    assembleFiniteFaceMesh(source, faces, { maxTypedBytes: 1 }),
  ).toThrow(/memory/i);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    assembleFiniteFaceMesh(source, faces, { signal: controller.signal }),
  ).toThrow(/abort/i);
  expect(() =>
    assembleFiniteFaceMesh(source, [
      {
        ...faces[0],
        boundaries: [
          { ...boundaries[0], canonical: { t: 0.25, reversed: true } },
        ],
      },
    ]),
  ).toThrow(/identity/i);
  expect(() =>
    assembleFiniteFaceMesh(source, [
      {
        ...faces[0],
        boundaries: [{ ...boundaries[0], point: [] as unknown as Vec3 }],
      },
    ]),
  ).toThrow(/identity|contact/i);
});

it("rejects a missing constraint and incomplete source-face coverage", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const vertices: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0.2, 0.2, 0],
  ];
  const mesh = {
    vertices,
    triangles: [
      [0, 1, 3],
      [0, 3, 2],
    ] as [number, number, number][],
    constraints: [[1, 2]] as [number, number][],
    boundaryVertices: [],
  };
  const face = {
    ids: [0, 1, 2] as [number, number, number],
    boundaries: [],
    mesh,
  };
  expect(() => assembleFiniteFaceMesh(source, [face])).toThrow(
    /constraint|coverage/i,
  );
  expect(() =>
    assembleFiniteFaceMesh(source, [
      { ...face, mesh: { ...mesh, constraints: [] } },
    ]),
  ).toThrow(/coverage/i);
});

it("rejects malformed source face coordinates", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const mesh = {
    vertices: [[], [1, 0, 0], [0, 1, 0]] as Vec3[],
    triangles: [[0, 1, 2]] as [number, number, number][],
    constraints: [] as [number, number][],
    boundaryVertices: [],
  };
  expect(() =>
    assembleFiniteFaceMesh(source, [{ ids: [0, 1, 2], boundaries: [], mesh }]),
  ).toThrow(/vertex/i);
});

it("rejects overlapping triangles whose areas sum to the source area", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const vertices: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0.5, 0],
    [0.5, 0.5, 0],
  ];
  const mesh = {
    vertices,
    triangles: [
      [0, 1, 3],
      [0, 1, 4],
    ] as [number, number, number][],
    constraints: [] as [number, number][],
    boundaryVertices: [],
  };
  expect(() =>
    assembleFiniteFaceMesh(source, [{ ids: [0, 1, 2], boundaries: [], mesh }]),
  ).toThrow(/edge|overlap|coverage/i);
});

it("rejects an interior vertex displaced from its source plane", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const vertices: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0.2, 0.2, 1],
  ];
  const mesh = {
    vertices,
    triangles: [
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3],
    ] as [number, number, number][],
    constraints: [] as [number, number][],
    boundaryVertices: [],
  };
  expect(() =>
    assembleFiniteFaceMesh(source, [{ ids: [0, 1, 2], boundaries: [], mesh }]),
  ).toThrow(/plane/i);
});

it("accounts for independently rounded edge points on an original tilted scan face", () => {
  const vertices: [Vec3, Vec3, Vec3] = [
    [20.096614837646484, -5.91249418258667, -291.8534851074219],
    [19.902437210083008, -5.853511810302734, -292.0082702636719],
    [20.14455223083496, -6.094422817230225, -292.0689697265625],
  ];
  const ids: [number, number, number] = [46673, 47367, 46675];
  const source = new Float32Array((Math.max(...ids) + 1) * 3);
  ids.forEach((id, i) => source.set(vertices[i], id * 3));
  const boundaries = [
    {
      edge: 0 as const,
      t: 0.883581356514906,
      point: [19.9250431060791, -5.860378265380859, -291.9902648925781] as Vec3,
      canonical: { t: 0.883581356514906, reversed: false },
    },
    {
      edge: 1 as const,
      t: 0.09336841607713997,
      point: [19.9250431060791, -5.876005172729492, -292.0139465332031] as Vec3,
      canonical: { t: 0.90663158392286, reversed: true },
    },
  ];
  const segment: [Vec3, Vec3] = [
    [19.9250431060791, -5.860378458073563, -291.9902503857496],
    [19.9250431060791, -5.876005289435103, -292.0139376763787],
  ];
  const bindings = [
    { segment: 0, endpoint: 0 as const, contact: 0 },
    { segment: 0, endpoint: 1 as const, contact: 1 },
  ];
  const mesh = triangulateFiniteFace(vertices, [segment], {
    boundaryContacts: boundaries,
    endpointBindings: bindings,
  });
  const out = assembleFiniteFaceMesh(source, [{ ids, boundaries, mesh }]);
  expect(out.triangles).toHaveLength(9);
});

it("rejects an emitted triangle that collapses at Float32 output precision", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const vertices: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0.2, 0.2, 0],
    [0.5, 0.49999999, 0],
  ];
  const mesh = {
    vertices,
    triangles: [
      [0, 1, 3],
      [1, 2, 4],
      [2, 3, 4],
      [3, 1, 4],
      [2, 0, 3],
    ] as [number, number, number][],
    constraints: [[3, 4]] as [number, number][],
    boundaryVertices: [],
  };
  expect(() =>
    assembleFiniteFaceMesh(source, [{ ids: [0, 1, 2], boundaries: [], mesh }]),
  ).toThrow(/precision|winding/i);
});

it("assembles sparse refinements while preserving untouched indexed faces", () => {
  const source = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const ids: [number, number, number] = [0, 1, 2],
    points: [Vec3, Vec3, Vec3] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ];
  const boundaries = [
    {
      edge: 0 as const,
      t: 0.25,
      point: [0.25, 0, 0] as Vec3,
      canonical: { t: 0.25, reversed: false },
    },
  ];
  const mesh = triangulateFiniteFace(points, [], {
    boundaryContacts: boundaries,
  });
  const result = assembleFiniteSparseFaceMesh(
    source,
    indices,
    new Map([[0, { ids, boundaries, mesh }]]),
  );
  expect([...result.faceOffsets]).toEqual([0, 2, 3]);
  expect([...result.triangles.slice(6)]).toEqual([3, 4, 5]);
  expect([...result.addedVertices]).toEqual([0.25, 0, 0]);
  expect([...indices]).toEqual([0, 1, 2, 3, 4, 5]);
});

it("rejects sparse refinements bound to the wrong face or an out-of-range face", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const ids: [number, number, number] = [0, 1, 2];
  const face: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const mesh = triangulateFiniteFace(face, []);
  expect(() =>
    assembleFiniteSparseFaceMesh(
      source,
      new Uint32Array(ids),
      new Map([[1, { ids, boundaries: [], mesh }]]),
    ),
  ).toThrow(/face/i);
  expect(() =>
    assembleFiniteSparseFaceMesh(
      source,
      new Uint32Array(ids),
      new Map([[0, { ids: [1, 0, 2], boundaries: [], mesh }]]),
    ),
  ).toThrow(/identity/i);
});

it("keeps one million untouched faces packed and within the typed allocation budget", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const count = 1_000_000,
    indices = new Uint32Array(count * 3);
  for (let i = 0; i < count; i++) indices.set([0, 1, 2], i * 3);
  const output = assembleFiniteSparseFaceMesh(source, indices, new Map(), {
    maxTypedBytes: 16_000_004,
  });
  expect(output.triangles.length).toBe(count * 3);
  expect([...output.triangles.slice(-6)]).toEqual([0, 1, 2, 0, 1, 2]);
  expect(output.faceOffsets[count]).toBe(count);
  expect(output.addedVertices).toHaveLength(0);
  expect(() =>
    assembleFiniteSparseFaceMesh(source, indices, new Map(), {
      maxTypedBytes: 16_000_003,
    }),
  ).toThrow(/memory/i);
});

it("rejects a sparse refinement that would leave its neighbor with a T-junction", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]);
  const indices = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const ids: [number, number, number] = [0, 1, 2],
    face: [Vec3, Vec3, Vec3] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ];
  const boundaries = [
    {
      edge: 0 as const,
      t: 0.25,
      point: [0.25, 0, 0] as Vec3,
      canonical: { t: 0.25, reversed: false },
    },
  ];
  const mesh = triangulateFiniteFace(face, [], {
    boundaryContacts: boundaries,
  });
  expect(() =>
    assembleFiniteSparseFaceMesh(
      source,
      indices,
      new Map([[0, { ids, boundaries, mesh }]]),
    ),
  ).toThrow(/neighbor|junction/i);
  const neighborIds: [number, number, number] = [1, 0, 3],
    neighborFace: [Vec3, Vec3, Vec3] = [
      [1, 0, 0],
      [0, 0, 0],
      [0, -1, 0],
    ];
  const other = [
    {
      edge: 0 as const,
      t: 0.5,
      point: [0.5, 0, 0] as Vec3,
      canonical: { t: 0.5, reversed: true },
    },
  ];
  const neighborMesh = triangulateFiniteFace(neighborFace, [], {
    boundaryContacts: other,
  });
  expect(() =>
    assembleFiniteSparseFaceMesh(
      source,
      indices,
      new Map([
        [0, { ids, boundaries, mesh }],
        [1, { ids: neighborIds, boundaries: other, mesh: neighborMesh }],
      ]),
    ),
  ).toThrow(/neighbor|junction/i);
});

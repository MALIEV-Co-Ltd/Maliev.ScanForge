import { expect, it } from "vitest";
import { triangulateFiniteFace } from "../src/scan-split-finite-face";
import type { Vec3 } from "../src/types";

const face: [Vec3, Vec3, Vec3] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];
const edge = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
it("triangulates a boundary contact between adjacent Float32 coordinates in precise mode", () => {
  const triangle: [Vec3, Vec3, Vec3] = [
    [100000000, 0, 0],
    [100000008, 8, 0],
    [99999968, 16, 0],
  ];
  const contact = {
    edge: 0 as const,
    t: 0.5,
    point: [100000004, 4, 0] as Vec3,
    canonical: { t: 0.5, reversed: false },
  };
  const result = triangulateFiniteFace(triangle, [], {
    boundaryContacts: [contact],
    preciseCoordinates: true,
  });
  expect(result.vertices[result.boundaryVertices[0]]).toEqual(contact.point);
  let area = 0;
  for (const [a, b, c] of result.triangles) {
    const p = result.vertices[a],
      q = result.vertices[b],
      r = result.vertices[c];
    const signed =
      (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    expect(signed).toBeGreaterThan(0);
    area += signed;
  }
  expect(area).toBe(384);
});

it("retains a precise two-boundary cutter segment during triangulation", () => {
  const triangle: [Vec3, Vec3, Vec3] = [
    [100000000, 0, 0],
    [100000008, 8, 0],
    [99999968, 16, 0],
  ];
  const first: Vec3 = [100000004, 4, 0],
    second: Vec3 = [99999992, 4, 0];
  const result = triangulateFiniteFace(triangle, [[first, second]], {
    preciseCoordinates: true,
    boundaryContacts: [
      { edge: 0, t: 0.5, point: first, canonical: { t: 0.5, reversed: false } },
      {
        edge: 2,
        t: 0.75,
        point: second,
        canonical: { t: 0.25, reversed: true },
      },
    ],
    endpointBindings: [
      { segment: 0, endpoint: 0, contact: 0 },
      { segment: 0, endpoint: 1, contact: 1 },
    ],
  });
  expect(result.vertices[result.boundaryVertices[0]]).toEqual(first);
  expect(result.vertices[result.boundaryVertices[1]]).toEqual(second);
  expect(result.constraints).toHaveLength(1);
});

it("triangulates a precise interior segment on a tilted face", () => {
  const triangle: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [7, 5, 21],
    [2, 2, 17],
  ];
  const point = (u: number, v: number): Vec3 => [
    7 * u + 2 * v,
    5 * u + 2 * v,
    21 * u + 17 * v,
  ];
  const result = triangulateFiniteFace(
    triangle,
    [[point(0.2, 0.2), point(0.4, 0.2)]],
    { preciseCoordinates: true },
  );
  expect(result.constraints).toHaveLength(1);
  const offPlane = point(0.2, 0.2);
  offPlane[2] += 0.01;
  expect(() =>
    triangulateFiniteFace(triangle, [[offPlane, point(0.4, 0.2)]], {
      preciseCoordinates: true,
    }),
  ).toThrow(/outside/i);
});
function verify(segments: [Vec3, Vec3][]) {
  const result = triangulateFiniteFace(face, segments);
  const uses = new Map<string, number>();
  let area = 0;
  for (const [a, b, c] of result.triangles) {
    const p = result.vertices[a],
      q = result.vertices[b],
      r = result.vertices[c];
    const signed =
      (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    expect(signed).toBeGreaterThan(0);
    area += signed;
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = edge(x, y);
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  expect(area).toBeCloseTo(1, 8);
  for (const [encoded, count] of uses) {
    expect(count === 1 || count === 2).toBe(true);
    if (count === 1) {
      const [a, b] = encoded.split(":").map(Number),
        p = result.vertices[a],
        q = result.vertices[b];
      const boundary = (v: Vec3) => [
        Math.abs(v[0]) < 1e-9,
        Math.abs(v[1]) < 1e-9,
        Math.abs(v[0] + v[1] - 1) < 1e-9,
      ];
      const x = boundary(p),
        y = boundary(q);
      expect(x.some((value, index) => value && y[index])).toBe(true);
    }
  }
  for (const [a, b] of result.constraints) expect(uses.get(edge(a, b))).toBe(2);
  for (const [start, end] of segments) {
    const dx = end[0] - start[0],
      dy = end[1] - start[1],
      length2 = dx * dx + dy * dy;
    const parameter = (p: Vec3) =>
      ((p[0] - start[0]) * dx + (p[1] - start[1]) * dy) / length2;
    const onLine = (p: Vec3) =>
      Math.abs((p[0] - start[0]) * dy - (p[1] - start[1]) * dx) <=
      length2 * 1e-8;
    const intervals = result.constraints
      .map(([a, b]) => [result.vertices[a], result.vertices[b]] as [Vec3, Vec3])
      .filter(([a, b]) => onLine(a) && onLine(b))
      .map(([a, b]) => [parameter(a), parameter(b)].sort((x, y) => x - y))
      .sort((a, b) => a[0] - b[0]);
    let endCovered = 0;
    for (const [lo, hi] of intervals)
      if (lo <= endCovered + 1e-8) endCovered = Math.max(endCovered, hi);
    expect(endCovered).toBeGreaterThanOrEqual(1 - 1e-8);
  }
  return result;
}

it("retains a wholly interior finite segment without extending it", () => {
  const result = verify([
    [
      [0.5, 0.1, 0],
      [0.5, 0.2, 0],
    ],
  ]);
  expect(result.constraints).toHaveLength(1);
  expect(result.triangles.length).toBeGreaterThan(1);
});

it("splits crossing finite constraints at their common intersection", () => {
  const result = verify([
    [
      [0.1, 0.2, 0],
      [0.6, 0.2, 0],
    ],
    [
      [0.3, 0.1, 0],
      [0.3, 0.5, 0],
    ],
  ]);
  expect(result.constraints).toHaveLength(4);
  expect(
    result.vertices.some(
      (v) => Math.abs(v[0] - 0.3) < 1e-9 && Math.abs(v[1] - 0.2) < 1e-9,
    ),
  ).toBe(true);
});

it("is deterministic when the same interior segment is reversed", () => {
  const a = triangulateFiniteFace(face, [
    [
      [0.5, 0.1, 0],
      [0.5, 0.2, 0],
    ],
  ]);
  const b = triangulateFiniteFace(face, [
    [
      [0.5, 0.2, 0],
      [0.5, 0.1, 0],
    ],
  ]);
  expect(b).toEqual(a);
});

it("splits overlapping collinear constraints into unique edge intervals", () => {
  const result = verify([
    [
      [0.1, 0.2, 0],
      [0.6, 0.2, 0],
    ],
    [
      [0.3, 0.2, 0],
      [0.7, 0.2, 0],
    ],
  ]);
  expect(result.constraints).toHaveLength(3);
});

it("supports a finite constraint joining two source boundary edges", () => {
  const result = verify([
    [
      [0, 0.25, 0],
      [0.5, 0.5, 0],
    ],
  ]);
  expect(result.constraints).toHaveLength(1);
});

it("preserves multiple intersecting and dangling constraints", () => {
  const result = verify([
    [
      [0.1, 0.2, 0],
      [0.65, 0.2, 0],
    ],
    [
      [0.1, 0.4, 0],
      [0.4, 0.4, 0],
    ],
    [
      [0.25, 0.1, 0],
      [0.25, 0.6, 0],
    ],
  ]);
  expect(result.constraints).toHaveLength(7);
});

it("rejects degenerate or outside constraints without mutating input", () => {
  const outside: [Vec3, Vec3][] = [
    [
      [0.2, 0.2, 0],
      [2, 0, 0],
    ],
  ];
  const original = JSON.stringify(outside);
  expect(() => triangulateFiniteFace(face, outside)).toThrow(/outside/i);
  expect(JSON.stringify(outside)).toBe(original);
  expect(() =>
    triangulateFiniteFace(face, [
      [
        [0.2, 0.2, 0],
        [0.2, 0.2, 0],
      ],
    ]),
  ).toThrow(/degenerate/i);
});

it("keeps short parallel segments distinct at their actual perpendicular separation", () => {
  const result = verify([
    [
      [0.2, 0.2, 0],
      [0.200001, 0.2, 0],
    ],
    [
      [0.2, 0.2000005, 0],
      [0.200001, 0.2000005, 0],
    ],
  ]);
  expect(result.constraints).toHaveLength(2);
});

it("stops before work when cancelled and leaves its inputs unchanged", () => {
  const segment: [Vec3, Vec3] = [
    [0.2, 0.2, 0],
    [0.5, 0.2, 0],
  ];
  const before = JSON.stringify(segment);
  const abort = new AbortController();
  abort.abort();
  expect(() =>
    triangulateFiniteFace(face, [segment], { signal: abort.signal }),
  ).toThrow(/abort/i);
  expect(JSON.stringify(segment)).toBe(before);
});

it("rejects work that exceeds its explicit local work budget", () => {
  expect(() =>
    triangulateFiniteFace(
      face,
      [
        [
          [0.1, 0.2, 0],
          [0.6, 0.2, 0],
        ],
        [
          [0.3, 0.1, 0],
          [0.3, 0.5, 0],
        ],
      ],
      { maxWork: 1 },
    ),
  ).toThrow(/budget/i);
});

it("preserves constraints on a translated and tilted 3D face", () => {
  const tilted: [Vec3, Vec3, Vec3] = [
    [10, 20, 30],
    [10, 22, 30],
    [10, 20, 33],
  ];
  const result = triangulateFiniteFace(tilted, [
    [
      [10, 20.4, 30.3],
      [10, 21, 30.3],
    ],
  ]);
  expect(result.constraints).toHaveLength(1);
  expect(result.vertices.every((p) => p[0] === 10)).toBe(true);
  expect(
    result.vertices.some(
      (p) => Math.abs(p[1] - 20.4) < 1e-10 && Math.abs(p[2] - 30.3) < 1e-10,
    ),
  ).toBe(true);
});

it("preserves deterministic output when constraints are supplied in reverse order", () => {
  const segments: [Vec3, Vec3][] = [
    [
      [0.1, 0.2, 0],
      [0.6, 0.2, 0],
    ],
    [
      [0.3, 0.1, 0],
      [0.3, 0.5, 0],
    ],
  ];
  expect(triangulateFiniteFace(face, [...segments].reverse())).toEqual(
    triangulateFiniteFace(face, segments),
  );
});

it("does not merge distinct Float32-representable nearby constraints", () => {
  const result = verify([
    [
      [0.1, 1e-8, 0],
      [0.2, 1e-8, 0],
    ],
    [
      [0.1, 1.00002e-8, 0],
      [0.2, 1.00002e-8, 0],
    ],
  ]);
  expect(result.constraints).toHaveLength(2);
});

it("rejects distinct constraints that collapse to the same Float32 coordinates", () => {
  expect(() =>
    triangulateFiniteFace(face, [
      [
        [0.1, 0.2, 0],
        [0.2, 0.2, 0],
      ],
      [
        [0.1, 0.200000001, 0],
        [0.2, 0.200000001, 0],
      ],
    ]),
  ).toThrow(/precision/i);
});

it("rejects non-finite coordinates explicitly", () => {
  expect(() =>
    triangulateFiniteFace(face, [
      [
        [NaN, 0.2, 0],
        [0.2, 0.2, 0],
      ],
    ]),
  ).toThrow(/coordinates must be finite/i);
});

it("does not snap distinct interior constraints onto the source boundary", () => {
  const result = verify([
    [
      [0.1, 1e-15, 0],
      [0.2, 1e-15, 0],
    ],
    [
      [0.1, 4e-15, 0],
      [0.2, 4e-15, 0],
    ],
  ]);
  expect(result.constraints).toHaveLength(2);
});

it("retains manifold area and every constraint across deterministic intersecting controls", () => {
  let state = 0x4a3b2c1d;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return 0.05 + (state / 0x100000000) * 0.35;
  };
  for (let sample = 0; sample < 1000; sample++) {
    const segments: [Vec3, Vec3][] = [];
    for (let i = 0; i < 5; i++)
      segments.push([
        [next(), next(), 0],
        [next(), next(), 0],
      ]);
    try {
      verify(segments);
    } catch (error) {
      throw new Error(
        `sample ${sample}: ${JSON.stringify(segments)}; ${error instanceof Error ? error.stack : String(error)}`,
      );
    }
  }
});

it("rejects a facet whose distinct vertices become collinear at Float32 output precision", () => {
  expect(() =>
    triangulateFiniteFace(face, [
      [
        [0.2, 0.2, 0],
        [0.5, 0.49999999, 0],
      ],
    ]),
  ).toThrow(/precision/i);
});

it("rejects off-plane constraint movement that survives Float32 conversion", () => {
  expect(() =>
    triangulateFiniteFace(face, [
      [
        [0.2, 0.2, 5e-11],
        [0.4, 0.2, 5e-11],
      ],
    ]),
  ).toThrow(/precision/i);
});

it("checks an externally observable abort during work without mutating inputs", () => {
  let checks = 0;
  const signal = {
    get aborted() {
      return ++checks > 30;
    },
  } as AbortSignal;
  const segments: [Vec3, Vec3][] = [
    [
      [0.1, 0.2, 0],
      [0.6, 0.2, 0],
    ],
    [
      [0.3, 0.1, 0],
      [0.3, 0.5, 0],
    ],
  ];
  const before = JSON.stringify(segments);
  expect(() => triangulateFiniteFace(face, segments, { signal })).toThrow(
    /abort/i,
  );
  expect(checks).toBeGreaterThan(30);
  expect(JSON.stringify(segments)).toBe(before);
});

it("observes a shared operation budget", () => {
  let checks = 0;
  expect(() =>
    triangulateFiniteFace(face, [], {
      check: () => {
        if (++checks === 3) throw new Error("shared budget");
      },
    }),
  ).toThrow(/shared budget/i);
});

it("canonicalizes nontrivial crossing constraints independently of input order", () => {
  const segments: [Vec3, Vec3][] = [
    [
      [0.05, 0.3137084989599999, 0],
      [0.65, 0.3137084989599999, 0],
    ],
    [
      [0.34427191000000007, 0.05, 0],
      [0.34427191000000007, 0.65, 0],
    ],
  ];
  expect(triangulateFiniteFace(face, [...segments].reverse())).toEqual(
    triangulateFiniteFace(face, segments),
  );
});

it("does not bridge a Float32-visible gap between nearly touching constraints", () => {
  const result = verify([
    [
      [0.1, 1e-15, 0],
      [0.3, 1e-15, 0],
    ],
    [
      [0.2, 2e-15, 0],
      [0.2, 0.2, 0],
    ],
  ]);
  expect(result.constraints).toHaveLength(2);
});

it("inserts a shared-edge contact even when this face has no cut segment", () => {
  const result = triangulateFiniteFace(face, [], {
    boundaryContacts: [{ edge: 0, t: 0.25, point: [0.25, 0, 0] }],
  });
  const index = result.vertices.findIndex((p) => p[0] === 0.25 && p[1] === 0);
  expect(index).toBeGreaterThanOrEqual(0);
  const edgeUses = result.triangles
    .flatMap(([a, b, c]) => [
      [a, b],
      [b, c],
      [c, a],
    ])
    .map(([a, b]) => edge(a, b));
  expect(edgeUses).toContain(edge(0, index));
  expect(edgeUses).toContain(edge(index, 1));
  expect(edgeUses).not.toContain(edge(0, 1));
});

it("returns one local vertex identity per registered boundary contact", () => {
  const out = triangulateFiniteFace(face, [], {
    boundaryContacts: [
      { edge: 0, t: 0.25, point: [0.25, 0, 0] },
      { edge: 1, t: 0.25, point: [0.75, 0.25, 0] },
      { edge: 2, t: 0.25, point: [0, 0.75, 0] },
    ],
  });
  expect(out.boundaryVertices).toHaveLength(3);
  expect(out.boundaryVertices.map((id) => out.vertices[id])).toEqual([
    [0.25, 0, 0],
    [0.75, 0.25, 0],
    [0, 0.75, 0],
  ]);
});

it("finds a Float32-valid triangulation for the captured large-scan boundary cut", () => {
  const face: [Vec3, Vec3, Vec3] = [
    [19.4488468170166, 52.0199089050293, -316.8146667480469],
    [19.47958755493164, 51.96547317504883, -316.7758483886719],
    [19.5074520111084, 52.06113052368164, -316.8014831542969],
  ];
  const boundaries = [
    {
      edge: 1 as const,
      t: 0.00013690190978164144,
      point: [
        19.479591369628906, 51.965484619140625, -316.7758483886719,
      ] as Vec3,
      canonical: { t: 0.00013690190978164144, reversed: false },
    },
    {
      edge: 2 as const,
      t: 0.4753954305799648,
      point: [
        19.479591369628906, 52.041534423828125, -316.8077392578125,
      ] as Vec3,
      canonical: { t: 0.5246045694200352, reversed: true },
    },
  ];
  const segment: [Vec3, Vec3] = [
    [19.479591369628906, 51.96548627072254, -316.77585189812027],
    [19.479591369628906, 52.04153395453321, -316.8077505745242],
  ];
  const bindings = [
    { segment: 0, endpoint: 0 as const, contact: 0 },
    { segment: 0, endpoint: 1 as const, contact: 1 },
  ];
  const out = triangulateFiniteFace(face, [segment], {
    boundaryContacts: boundaries,
    endpointBindings: bindings,
  });
  expect(out.constraints).toHaveLength(1);
  expect(out.triangles).toHaveLength(3);
});

it("rejects a propagation point inside a face rather than on its boundary", () => {
  expect(() =>
    triangulateFiniteFace(face, [], {
      boundaryContacts: [{ edge: 0, t: 0.2, point: [0.2, 0.2, 0] }],
    }),
  ).toThrow(/boundary/i);
});

it("uses a shared 3D edge point on both oppositely oriented faces", () => {
  const point: Vec3 = [Math.fround(0.1), Math.fround(0.3), 0];
  const first: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 3, 0],
    [0, 0, 2],
  ];
  const second: [Vec3, Vec3, Vec3] = [
    [1, 3, 0],
    [0, 0, 0],
    [0, 0, -2],
  ];
  for (const [f, t] of [
    [first, 0.1],
    [second, 0.9],
  ] as const) {
    const out = triangulateFiniteFace(f, [], {
      boundaryContacts: [{ edge: 0, t, point }],
    });
    expect(out.vertices.map((v) => v.map(Math.fround))).toContainEqual(point);
    expect(out.triangles).toHaveLength(2);
  }
});

it("splits a boundary constraint at a propagated contact", () => {
  const out = triangulateFiniteFace(
    face,
    [
      [
        [0.1, 0, 0],
        [0.7, 0, 0],
      ],
    ],
    {
      boundaryContacts: [{ edge: 0, t: 0.4, point: [0.4, 0, 0] }],
    },
  );
  const id = out.vertices.findIndex(
    (p) => Math.fround(p[0]) === Math.fround(0.4) && p[1] === 0,
  );
  expect(id).toBeGreaterThanOrEqual(0);
  expect(out.constraints.filter((e) => e.includes(id))).toHaveLength(2);
});

it("rejects forged canonical edge metadata", () => {
  expect(() =>
    triangulateFiniteFace(face, [], {
      boundaryContacts: [
        {
          edge: 0,
          t: 0.25,
          point: [0.25, 0, 0],
          canonical: { t: 0.5, reversed: false },
        },
      ],
    }),
  ).toThrow(/canonical/i);
  expect(() =>
    triangulateFiniteFace(face, [], {
      boundaryContacts: [
        {
          edge: 0,
          t: 0.25,
          point: [0.26, 0, 0],
          canonical: { t: 0.25, reversed: false },
        },
      ],
    }),
  ).toThrow(/boundary/i);
});

it("inserts contacts on each local edge", () => {
  const out = triangulateFiniteFace(face, [], {
    boundaryContacts: [
      { edge: 0, t: 0.25, point: [0.25, 0, 0] },
      { edge: 1, t: 0.25, point: [0.75, 0.25, 0] },
      { edge: 2, t: 0.25, point: [0, 0.75, 0] },
    ],
  });
  expect(out.triangles).toHaveLength(4);
  for (const p of [
    [0.25, 0, 0],
    [0.75, 0.25, 0],
    [0, 0.75, 0],
  ])
    expect(out.vertices).toContainEqual(p);
});

it("binds a rounded cut endpoint to its authoritative shared edge", () => {
  const f: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 3, 0],
    [0, 0, 2],
  ];
  const point: Vec3 = [Math.fround(0.1), Math.fround(0.3), 0];
  const out = triangulateFiniteFace(f, [[point, [0.2, 0.6, 0.2]]], {
    boundaryContacts: [{ edge: 0, t: 0.1, point }],
    endpointBindings: [{ segment: 0, endpoint: 0, contact: 0 }],
  });
  expect(out.vertices.map((v) => v.map(Math.fround))).toContainEqual(point);
  expect(out.constraints).toHaveLength(1);
});

it("rejects an endpoint binding to an unrelated point", () => {
  expect(() =>
    triangulateFiniteFace(
      face,
      [
        [
          [0.2, 0.2, 0],
          [0.3, 0.2, 0],
        ],
      ],
      {
        boundaryContacts: [{ edge: 0, t: 0.1, point: [0.1, 0, 0] }],
        endpointBindings: [{ segment: 0, endpoint: 0, contact: 0 }],
      },
    ),
  ).toThrow(/binding/i);
});

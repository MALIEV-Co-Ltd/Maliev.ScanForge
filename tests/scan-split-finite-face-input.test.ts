import { expect, it } from "vitest";
import { inspectFiniteTriangleContact } from "../src/scan-edit-general-split";
import { buildSparseFiniteEdgeContactsIndexed } from "../src/scan-split-finite-edges";
import { buildFiniteFaceInput } from "../src/scan-split-finite-face-input";
import { triangulateFiniteFace } from "../src/scan-split-finite-face";
import { assembleFiniteFaceMesh } from "../src/scan-split-finite-assembly";
import { groupFiniteTrianglesCompact } from "../src/scan-split-finite-group";
import type { Vec3 } from "../src/types";

it("binds distinct precise contacts by their exact edge parameters", () => {
  const t = 0.5;
  const next = t + Number.EPSILON;
  const hit = {
    points: [
      [t, 0, 0],
      [t, 0.25, 0],
    ] as Vec3[],
    coplanar: false,
    sourceEdges: [[{ edge: 0, t }], []],
  };
  const registered = [
    {
      edge: [0, 1] as [number, number],
      contacts: [t, next].map((value) => ({
        t: value,
        point: [value, 0, 0] as Vec3,
        canonical: { t: value, reversed: false },
      })),
    },
  ];
  const result = buildFiniteFaceInput([0, 1, 2], [hit], registered, {
    preciseCoordinates: true,
  });
  expect(result.endpointBindings).toEqual([
    { segment: 0, endpoint: 0, contact: 0 },
  ]);
  const between = t + Number.EPSILON / 2;
  const ambiguousHit = {
    ...hit,
    sourceEdges: [[{ edge: 0, t: between }], []],
  };
  expect(() =>
    buildFiniteFaceInput([0, 1, 2], [ambiguousHit], registered, {
      preciseCoordinates: true,
    }),
  ).toThrow(/ambiguous/);
});

it("binds actual finite intersections through the indexed contact registry for adjacent faces", () => {
  const vertices: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ];
  const faces: [number, number, number][] = [
    [0, 1, 2],
    [1, 0, 3],
  ];
  const cutter: [Vec3, Vec3, Vec3] = [
    [0.25, -2, -1],
    [0.25, 2, -1],
    [0.25, 0, 1],
  ];
  const intersections = faces.map((ids) =>
    inspectFiniteTriangleContact(
      ids.map((i) => vertices[i]) as [Vec3, Vec3, Vec3],
      cutter,
    ),
  );
  const contacts = intersections.flatMap((hit, f) =>
    hit.sourceEdges.flatMap((edges) =>
      edges.map(({ edge, t }) => ({
        edge: [faces[f][edge], faces[f][(edge + 1) % 3]] as [number, number],
        t,
        source: "cutter",
      })),
    ),
  );
  const registry = buildSparseFiniteEdgeContactsIndexed(
    new Float32Array(vertices.flat()),
    new Uint32Array(faces.flat()),
    contacts,
  );
  const output = faces.map((ids, i) => {
    const face = ids.map((n) => vertices[n]) as [Vec3, Vec3, Vec3];
    const input = buildFiniteFaceInput(
      ids,
      [intersections[i]],
      registry.get(i) ?? [],
    );
    const mesh = triangulateFiniteFace(face, input.segments, {
      boundaryContacts: input.boundaryContacts,
      endpointBindings: input.endpointBindings,
    });
    return { ids, boundaries: input.boundaryContacts, mesh };
  });
  for (const { mesh } of output) {
    expect(mesh.constraints).toHaveLength(1);
    const contact = mesh.vertices.findIndex(
      (v) => v[0] === 0.25 && v[1] === 0 && v[2] === 0,
    );
    expect(contact).toBeGreaterThanOrEqual(0);
    expect(mesh.constraints[0]).toContain(contact);
  }
  const assembled = assembleFiniteFaceMesh(
    new Float32Array(vertices.flat()),
    output,
  );
  expect(
    new Set(
      groupFiniteTrianglesCompact(assembled.triangles, assembled.constraints),
    ).size,
  ).toBe(2);
  expect([...assembled.constraints]).toHaveLength(4);
});

it("rejects an unbound source-edge intersection rather than guessing", () => {
  const hit = {
    points: [
      [0.25, 0, 0],
      [0.25, 0.5, 0],
    ] as Vec3[],
    coplanar: false,
    sourceEdges: [[{ edge: 0, t: 0.25 }], []],
  };
  expect(() => buildFiniteFaceInput([0, 1, 2], [hit], [])).toThrow(/contact/i);
});

it("binds the same tilted shared edge contact from both finite intersections", () => {
  const vertices: Vec3[] = [
    [0, 0, 0],
    [1, 3, 0],
    [0, 0, 2],
    [0, 0, -2],
  ];
  const faces: [number, number, number][] = [
    [0, 1, 2],
    [1, 0, 3],
  ];
  const cutter: [Vec3, Vec3, Vec3] = [
    [0.1, -4, -5],
    [0.1, 6, -5],
    [0.1, -1, 5],
  ];
  const hits = faces.map((ids) =>
    inspectFiniteTriangleContact(
      ids.map((i) => vertices[i]) as [Vec3, Vec3, Vec3],
      cutter,
    ),
  );
  const entries = hits.flatMap((hit, f) =>
    hit.sourceEdges.flatMap((edges) =>
      edges.map(({ edge, t }) => ({
        edge: [faces[f][edge], faces[f][(edge + 1) % 3]] as [number, number],
        t,
        source: "cutter",
      })),
    ),
  );
  const registry = buildSparseFiniteEdgeContactsIndexed(
    new Float32Array(vertices.flat()),
    new Uint32Array(faces.flat()),
    entries,
  );
  const outputs = faces.map((ids, i) => {
    const input = buildFiniteFaceInput(ids, [hits[i]], registry.get(i) ?? []);
    const mesh = triangulateFiniteFace(
      ids.map((n) => vertices[n]) as [Vec3, Vec3, Vec3],
      input.segments,
      input,
    );
    return { ids, boundaries: input.boundaryContacts, mesh };
  });
  const common = registry
    .get(0)!
    .find((r) => r.edge[0] === 0 && r.edge[1] === 1)!.contacts[0].point;
  for (const { mesh } of outputs)
    expect(mesh.vertices.map((v) => v.map(Math.fround))).toContainEqual(common);
  const assembled = assembleFiniteFaceMesh(
    new Float32Array(vertices.flat()),
    outputs,
  );
  expect(
    new Set(
      groupFiniteTrianglesCompact(assembled.triangles, assembled.constraints),
    ).size,
  ).toBe(2);
});

it("enforces the adapter work budget and observable cancellation without mutating input", () => {
  const ids: [number, number, number] = [0, 1, 2];
  const hit = {
    points: [
      [0.25, 0, 0],
      [0.25, 0.5, 0],
    ] as Vec3[],
    coplanar: false,
    sourceEdges: [[], []],
  };
  const before = JSON.stringify([ids, hit]);
  expect(() => buildFiniteFaceInput(ids, [hit], [], { maxWork: 1 })).toThrow(
    /budget/i,
  );
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    buildFiniteFaceInput(ids, [hit], [], { signal: controller.signal }),
  ).toThrow(/abort/i);
  let steps = 0;
  expect(() =>
    buildFiniteFaceInput(ids, [hit], [], {
      check: () => {
        if (++steps === 3) throw new Error("shared budget");
      },
    }),
  ).toThrow(/shared budget/i);
  expect(JSON.stringify([ids, hit])).toBe(before);
});

it("propagates registered coplanar contacts without inventing cut segments", () => {
  const face: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const ids: [number, number, number] = [0, 1, 2];
  const hit = inspectFiniteTriangleContact(face, [
    [0.25, 0, 0],
    [0.75, 0, 0],
    [0.5, -1, 0],
  ]);
  const edges = hit.sourceEdges.flatMap((items) =>
    items.map(({ edge, t }) => ({
      edge: [ids[edge], ids[(edge + 1) % 3]] as [number, number],
      t,
      source: "coplanar",
    })),
  );
  const records = buildSparseFiniteEdgeContactsIndexed(
    new Float32Array(face.flat()),
    new Uint32Array(ids),
    edges,
  ).get(0)!;
  const input = buildFiniteFaceInput(ids, [hit], records);
  expect(input.segments).toEqual([]);
  expect(input.boundaryContacts).toHaveLength(2);
  const out = triangulateFiniteFace(face, input.segments, input);
  expect(out.constraints).toEqual([]);
  expect(out.vertices).toContainEqual([0.25, 0, 0]);
  expect(out.vertices).toContainEqual([0.75, 0, 0]);
});

it("carries a near-end offset through local binding and indexed assembly", () => {
  const tiny = Math.fround(1e-20),
    target = Math.fround(2e-20);
  const face: [Vec3, Vec3, Vec3] = [
      [1, 0, 0],
      [tiny, 0, 0],
      [0, 1, 0],
    ],
    ids: [number, number, number] = [0, 1, 2];
  const fromEnd = (target - tiny) / (1 - tiny);
  const hit = {
    points: [
      [target, 0, 0],
      [0.25, 0.25, 0],
    ] as Vec3[],
    coplanar: false,
    sourceEdges: [[{ edge: 0, t: 1, fromEnd }], []],
  };
  const registry = buildSparseFiniteEdgeContactsIndexed(
    new Float32Array(face.flat()),
    new Uint32Array(ids),
    [{ edge: [0, 1], t: 1, fromEnd, source: "cut" }],
  );
  const input = buildFiniteFaceInput(ids, [hit], registry.get(0) ?? []);
  expect(input.endpointBindings).toHaveLength(1);
  const mesh = triangulateFiniteFace(face, input.segments, input);
  const assembled = assembleFiniteFaceMesh(new Float32Array(face.flat()), [
    { ids, boundaries: input.boundaryContacts, mesh },
  ]);
  expect([...assembled.addedVertices]).toContain(target);
});

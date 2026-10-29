import { describe, expect, it } from "vitest";
import {
  parseMesh,
  parseProject,
  serializeProject,
  serializeProjectBlob,
  validatePositions,
} from "../src/io";
import type { Entity } from "../src/types";
import { createGridPatch } from "../src/surfaces";
import { rectangleSketch } from "../src/sketch";
import { markRestoredCoordinates } from "../src/finite-typed-values";

it("revalidates restored coordinates after mutation with the same sparse-array semantics", () => {
  const coordinates = markRestoredCoordinates([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  expect(() => validatePositions(coordinates)).not.toThrow();
  coordinates[2] = Number.NaN;
  expect(() => validatePositions(coordinates)).toThrow();
  delete coordinates[2];
  expect(() => validatePositions(coordinates)).not.toThrow();
  coordinates[2] = undefined as unknown as number;
  expect(() => validatePositions(coordinates)).toThrow();
  coordinates[2] = -0;
  expect(() => validatePositions(coordinates)).not.toThrow();
});
const entity: Entity = {
  id: "test",
  name: "Triangle",
  kind: "mesh",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  visible: true,
  color: "#00ffaa",
  opacity: 1,
};
it("validates and owns retained authoring link metadata", () => {
  const input = {
    format: "maliev-scanforge",
    version: 1,
    name: "links",
    units: "mm",
    entities: [
      {
        ...entity,
        authoringLinks: { featureId: "f", output: 1, references: ["source"] },
      },
    ],
  };
  const parsed = parseProject(JSON.stringify(input));
  expect(parsed.entities[0].authoringLinks).toEqual(
    input.entities[0].authoringLinks,
  );
  for (const authoringLinks of [
    null,
    { featureId: "", output: 0, references: [] },
    { featureId: "f", output: -1, references: [] },
    { featureId: "f", output: 0, references: ["source", "source"] },
    { featureId: "f", output: 0, references: [null] },
    { featureId: "f", output: 0, references: [], recipe: {} },
  ])
    expect(() =>
      parseProject(
        JSON.stringify({ ...input, entities: [{ ...entity, authoringLinks }] }),
      ),
    ).toThrow("Invalid retained authoring references");
});
describe("file boundaries", () => {
  it("retains CAD edge segments through both project writers and validates them", async () => {
    const cad = {
      ...entity,
      kind: "cad" as const,
      brep: "exact",
      edgePositions: [0, 0, 0, 1, 0, 0],
    };
    for (const text of [
      serializeProject("CAD", [cad]),
      await (await serializeProjectBlob("CAD", [cad])).text(),
    ])
      expect(parseProject(text).entities[0].edgePositions).toEqual(
        cad.edgePositions,
      );
    for (const edgePositions of [
      [0, 0, 0],
      [0, 0, 0, 1e10, 0, 0],
      [0, 0, 0, "x", 0, 0],
    ])
      expect(() =>
        parseProject(
          JSON.stringify({
            format: "maliev-scanforge",
            version: 1,
            name: "CAD",
            units: "mm",
            entities: [{ ...cad, edgePositions }],
          }),
        ),
      ).toThrow("Invalid CAD edge geometry");
  });
  it("retains parametric recipes through both project paths and rejects dangling dependencies", async () => {
    const body: Entity = {
      ...entity,
      kind: "cad",
      brep: "seed",
      parametric: {
        feature: {
          id: "seed",
          name: "Box",
          recipe: {
            kind: "primitive",
            input: { kind: "box", center: [0, 0, 0], size: [10, 20, 30] },
          },
        },
        output: 0,
      },
    };
    const dependent: Entity = {
      ...body,
      id: "pattern",
      parametric: {
        feature: {
          id: "pattern",
          name: "Pattern",
          recipe: {
            kind: "pattern",
            source: { featureId: "seed" },
            pattern: { kind: "linear", count: 3, step: [30, 0, 0] },
          },
        },
        output: 0,
      },
    };
    for (const text of [
      serializeProject("Graph", [body, dependent]),
      await (await serializeProjectBlob("Graph", [body, dependent])).text(),
    ]) {
      const loaded = parseProject(text);
      expect(loaded.entities.map((e) => e.parametric)).toEqual([
        body.parametric,
        dependent.parametric,
      ]);
      expect(loaded.entities[0].kernelId).toBeUndefined();
    }
    expect(() => parseProject(serializeProject("Bad", [dependent]))).toThrow(
      /missing/i,
    );
    expect(() =>
      parseProject(
        serializeProject("Bad", [{ ...body, parametric: null as never }]),
      ),
    ).toThrow(/binding/);
  });
  it("roundtrips sampled source counts and rejects malformed counts", async () => {
    const scanSource = {
      bytes: 1_100_000_084,
      triangles: 22_000_000,
      displayedTriangles: 250_000,
    };
    for (const saved of [
      serializeProject("Preview", [{ ...entity, scanSource }]),
      await (
        await serializeProjectBlob("Preview", [{ ...entity, scanSource }])
      ).text(),
    ])
      expect(parseProject(saved).entities[0].scanSource).toEqual(scanSource);
    expect(() =>
      parseProject(
        serializeProject("Invalid", [
          {
            ...entity,
            scanSource: { ...scanSource, displayedTriangles: 22_000_001 },
          },
        ]),
      ),
    ).toThrow("source counts");
  });
  it("persists accepted native counts and rejects inconsistent accepted geometry", () => {
    const scanSource = {
      bytes: 184,
      triangles: 2,
      acceptedTriangles: 1,
      displayedTriangles: 1,
    };
    expect(
      parseProject(serializeProject("Native", [{ ...entity, scanSource }]))
        .entities[0].scanSource,
    ).toEqual(scanSource);
    for (const acceptedTriangles of [0, 3, NaN, 0.5])
      expect(() =>
        parseProject(
          serializeProject("Invalid", [
            { ...entity, scanSource: { ...scanSource, acceptedTriangles } },
          ]),
        ),
      ).toThrow("source counts");
  });
  it("persists rational surface controls and constrained sketch drafts through both save paths", async () => {
    const surfacePatch = createGridPatch(4, 4, 20, 30, 3);
    const authoring = { sketch: rectangleSketch(20, 30) };
    const entities = [{ ...entity, surfacePatch, surfaceScanId: "source" }];
    const saves = [
      serializeProject("Authoring", entities, authoring),
      await (
        await serializeProjectBlob("Authoring", entities, authoring)
      ).text(),
    ];
    for (const saved of saves) {
      const restored = parseProject(saved);
      expect(restored.authoring).toEqual(authoring);
      expect(restored.entities[0].surfacePatch).toEqual(surfacePatch);
      expect(restored.entities[0].surfaceScanId).toBe("source");
    }
  });
  it("rejects malformed surface and constraint authoring at the project boundary", () => {
    const valid = JSON.parse(serializeProject("Authoring", [entity]));
    expect(() =>
      parseProject(
        JSON.stringify({
          ...valid,
          entities: [
            {
              ...entity,
              surfacePatch: { format: "scanforge-nurbs", version: 1 },
            },
          ],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseProject(
        JSON.stringify({
          ...valid,
          authoring: {
            sketch: {
              ...rectangleSketch(),
              constraints: [{ id: "bad", kind: "execute", point: "p0" }],
            },
          },
        }),
      ),
    ).toThrow();
    expect(parseProject(JSON.stringify(valid)).authoring).toBeUndefined();
  });
  it("roundtrips independent project geometry and strips ephemeral handles", () => {
    const saved = serializeProject("Project", [
      { ...entity, kernelId: "ephemeral", brep: "DBRep_DrawableShape\n" },
    ]);
    expect(saved).not.toContain("ephemeral");
    const project = parseProject(saved);
    expect(project.entities[0].positions).toEqual(entity.positions);
    expect(project.entities[0].brep).toBe("DBRep_DrawableShape\n");
  });
  it("rejects foreign versions, invalid coordinates, duplicate IDs and invalid colors", () => {
    const valid = JSON.parse(serializeProject("Project", [entity]));
    expect(() =>
      parseProject(JSON.stringify({ ...valid, version: 999 })),
    ).toThrow();
    expect(() =>
      parseProject(JSON.stringify({ ...valid, entities: [entity, entity] })),
    ).toThrow();
    expect(() =>
      parseProject(
        JSON.stringify({
          ...valid,
          entities: [{ ...entity, color: "url(remote)" }],
        }),
      ),
    ).toThrow();
    expect(() => validatePositions([0, 0, NaN, 1, 0, 0, 0, 1, 0])).toThrow();
    expect(() =>
      validatePositions(new Float32Array([0, 0, Infinity, 1, 0, 0, 0, 1, 0])),
    ).toThrow();
    expect(() =>
      validatePositions(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
    ).not.toThrow();
    expect(() => validatePositions([0, 0, 0])).toThrow();
    const sparse = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    delete sparse[2];
    expect(() => validatePositions(sparse)).not.toThrow();
    sparse[2] = undefined as unknown as number;
    expect(() => validatePositions(sparse)).toThrow();
    sparse[2] = Number.MAX_VALUE;
    expect(() => validatePositions(sparse)).not.toThrow();
  });
  it("imports an ASCII STL triangle preserving millimetre coordinates", () => {
    const stl =
      "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 5 0\nendloop\nendfacet\nendsolid triangle";
    expect(
      Array.from(parseMesh(new TextEncoder().encode(stl).buffer, "stl")),
    ).toEqual([0, 0, 0, 10, 0, 0, 0, 5, 0]);
  });
  it("imports OBJ triangles and rejects empty meshes and point-cloud PLY", () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3";
    expect(
      Array.from(parseMesh(new TextEncoder().encode(obj).buffer, "obj")),
    ).toEqual(entity.positions);
    expect(() =>
      parseMesh(new TextEncoder().encode("v 0 0 0").buffer, "obj"),
    ).toThrow();
    const ply =
      "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n";
    expect(() =>
      parseMesh(new TextEncoder().encode(ply).buffer, "ply"),
    ).toThrow("Point clouds");
  });
  it("preserves typed geometry and more than 100 objects in v1 project JSON", async () => {
    const entities = Array.from({ length: 101 }, (_, i) => ({
      ...entity,
      id: String(i),
      positions: new Float32Array(entity.positions),
      kernelId: "transient",
    }));
    const serialized = serializeProject("Many objects", entities);
    expect(parseProject(serialized).entities).toHaveLength(101);
    const blob = await serializeProjectBlob("Many objects", entities);
    expect(parseProject(await blob.text()).entities[100].positions).toEqual(
      entity.positions,
    );
    expect(await blob.text()).not.toContain("transient");
  });
});

import { expect, it } from "vitest";
import type { Entity } from "../src/types";
import type { ReferenceConstructionDefinition } from "../src/reference-construction";
import { resolveStoredReferenceConstructionInputs } from "../src/reference-construction-resolver";
import { evaluateReferenceConstruction } from "../src/reference-construction-evaluation";

function point(id: string, key: string, x: number): Entity {
  return {
    id,
    name: "Same display name",
    kind: "referencePoint",
    positions: [],
    visible: true,
    locked: true,
    color: "#aaa",
    opacity: 1,
    constructionOrderKey: key.repeat(16),
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "point",
        mode: "coordinates",
        position: [x, 0, 0],
        sources: [],
      },
      geometry: { kind: "point", position: [x, 0, 0] },
      evaluation: { completionWord: 256 },
    },
  };
}
const a = point("a", "01", -0),
  b = point("b", "02", 4);
const source = (e: Entity) => ({
  id: e.id,
  constructionOrderKey: e.constructionOrderKey!,
});
const pick = (id: string) => ({
  entityId: id,
  storage: "native-pick-record-f32" as const,
  coordinates: [-0, 2, 3] as const,
});

it("binds canonical source identities independently of scene order, visibility, locks and display names", () => {
  const hidden = { ...b, visible: false };
  const definition: ReferenceConstructionDefinition = {
    version: 1,
    kind: "point",
    mode: "pair",
    sources: [source(a), source(b)],
  };
  const inputs = resolveStoredReferenceConstructionInputs(
    [hidden, a],
    definition,
  );
  expect(inputs).toEqual({
    kind: "point",
    sources: [
      {
        source: source(a),
        primitive: {
          kind: "point",
          position: [-0, 0, 0],
          objectResolved: true,
        },
      },
      {
        source: source(b),
        primitive: { kind: "point", position: [4, 0, 0], objectResolved: true },
      },
    ],
  });
  expect(
    evaluateReferenceConstruction(definition, inputs, {
      geometry: { kind: "point", position: [9, 9, 9] },
      state: { completionWord: 0 },
    }).geometry,
  ).toEqual({ kind: "point", position: [2, 0, 0] });
});

it("detaches exact semantic coordinates and binding records without modifying source state", () => {
  const entity = point("precise", "03", 1 + 2 ** -40);
  const definition: ReferenceConstructionDefinition = {
    version: 1,
    kind: "point",
    mode: "center",
    sources: [source(entity)],
  };
  const before = JSON.stringify(entity);
  const inputs = resolveStoredReferenceConstructionInputs([entity], definition);
  if (inputs.kind !== "point" || inputs.sources[0].primitive.kind !== "point")
    throw new Error("Expected point binding");
  expect(inputs.sources[0].primitive.position[0]).toBe(1 + 2 ** -40);
  expect(inputs.sources[0].primitive.position).not.toBe(
    entity.reference!.geometry.kind === "point"
      ? entity.reference!.geometry.position
      : undefined,
  );
  expect(inputs.sources[0].source).not.toBe(definition.sources[0]);
  expect(JSON.stringify(entity)).toBe(before);
});

it("keeps ordered repeated picks separate from the common dependency set", () => {
  const definition: ReferenceConstructionDefinition = {
    version: 1,
    kind: "line",
    mode: "pair",
    sources: [source(a), source(b)],
    records: [pick("b"), pick("a"), pick("b")],
  };
  const inputs = resolveStoredReferenceConstructionInputs([a, b], definition);
  if (inputs.kind !== "line") throw new Error("Expected line binding");
  expect(inputs.records.map((row) => row.record.entityId)).toEqual([
    "b",
    "a",
    "b",
  ]);
  expect(inputs.records.map((row) => row.primitive)).toEqual([
    { kind: "point", position: [4, 0, 0], objectResolved: true },
    { kind: "point", position: [-0, 0, 0], objectResolved: true },
    { kind: "point", position: [4, 0, 0], objectResolved: true },
  ]);
  expect(inputs.records[0].record).not.toBe(definition.records[0]);
  expect(Object.is(inputs.records[0].record.coordinates[0], -0)).toBe(true);
  const first = inputs.records[0].primitive,
    repeated = inputs.records[2].primitive;
  if (first.kind !== "point" || repeated.kind !== "point")
    throw Error("Expected repeated point primitives");
  expect(first).not.toBe(repeated);
  expect(first.position).not.toBe(repeated.position);
  Reflect.set(first.position, 0, 99);
  expect(repeated.position).toEqual([4, 0, 0]);
  expect(b.reference!.geometry).toEqual({ kind: "point", position: [4, 0, 0] });
});

it("extracts stored lines with raw direction and Double endpoint arithmetic", () => {
  const entity: Entity = {
    ...point("line", "03", 0),
    kind: "referenceLine",
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "endpoints",
        start: [16777217, 0, 0],
        end: [16777223, 0, 0],
        sources: [],
        records: [],
      },
      geometry: {
        kind: "line",
        start: [16777217, 0, 0],
        direction: [2, 0, 0],
        length: 3,
      },
      evaluation: { completionWord: 256 },
    },
  };
  const inputs = resolveStoredReferenceConstructionInputs([entity], {
    version: 1,
    kind: "line",
    mode: "average",
    sources: [source(entity)],
    records: [pick(entity.id), pick(entity.id)],
  });
  if (inputs.kind !== "line") throw new Error("Expected line binding");
  expect(inputs.records[0].primitive).toEqual({
    kind: "axis",
    start: [16777217, 0, 0],
    end: [16777223, 0, 0],
    objectResolved: true,
  });
  expect(inputs.records[0].primitive).not.toBe(inputs.records[1].primitive);
  const first = inputs.records[0].primitive,
    repeated = inputs.records[1].primitive;
  if (first.kind !== "axis" || repeated.kind !== "axis")
    throw Error("Expected repeated axis primitives");
  expect(first.start).not.toBe(repeated.start);
  expect(first.end).not.toBe(repeated.end);
  Reflect.set(first.start, 0, 99);
  Reflect.set(first.end, 0, 101);
  expect(repeated.start).toEqual([16777217, 0, 0]);
  expect(repeated.end).toEqual([16777223, 0, 0]);
  expect(entity.reference!.geometry).toEqual({
    kind: "line",
    start: [16777217, 0, 0],
    direction: [2, 0, 0],
    length: 3,
  });
});

it("rejects missing common sources and stale keys before evaluating geometry", () => {
  expect(() =>
    resolveStoredReferenceConstructionInputs([a], {
      version: 1,
      kind: "point",
      mode: "center",
      sources: [source(b)],
    }),
  ).toThrow(/Missing construction source/);
  expect(() =>
    resolveStoredReferenceConstructionInputs([a], {
      version: 1,
      kind: "point",
      mode: "center",
      sources: [{ id: a.id, constructionOrderKey: "09".repeat(16) }],
    }),
  ).toThrow(/identity/);
});

it("rejects duplicate scene IDs and collisions even on unselected objects", () => {
  const definition: ReferenceConstructionDefinition = {
    version: 1,
    kind: "point",
    mode: "center",
    sources: [source(a)],
  };
  expect(() =>
    resolveStoredReferenceConstructionInputs([a, a], definition),
  ).toThrow(/Duplicate/);
  expect(() =>
    resolveStoredReferenceConstructionInputs(
      [a, { ...b, constructionOrderKey: a.constructionOrderKey }],
      definition,
    ),
  ).toThrow(/collision/);
});

it("rejects an active pick outside its declared common set without inventing failed extraction for a missing object", () => {
  expect(() =>
    resolveStoredReferenceConstructionInputs([a], {
      version: 1,
      kind: "line",
      mode: "pair",
      sources: [source(a)],
      records: [pick("missing")],
    }),
  ).toThrow(/outside its common source set/);
});

it("rejects unresolved source families and malformed semantic sources", () => {
  const mesh: Entity = {
    ...a,
    id: "mesh",
    kind: "mesh",
    reference: undefined,
    positions: [0, 0, 0],
  };
  expect(() =>
    resolveStoredReferenceConstructionInputs([mesh], {
      version: 1,
      kind: "point",
      mode: "center",
      sources: [source(mesh)],
    }),
  ).toThrow(/not bound/);
  expect(() =>
    resolveStoredReferenceConstructionInputs([{ ...a, positions: [0, 0, 0] }], {
      version: 1,
      kind: "point",
      mode: "center",
      sources: [source(a)],
    }),
  ).toThrow(/empty display positions/);
});

it("does not extract inactive numeric/common or empty-common average records", () => {
  const mesh: Entity = {
    ...a,
    id: "mesh",
    kind: "mesh",
    reference: undefined,
    positions: [0, 0, 0],
  };
  expect(
    resolveStoredReferenceConstructionInputs([mesh], {
      version: 1,
      kind: "point",
      mode: "coordinates",
      position: [0, 0, 0],
      sources: [source(mesh)],
    }),
  ).toEqual({ kind: "point", sources: [] });
  expect(
    resolveStoredReferenceConstructionInputs([], {
      version: 1,
      kind: "line",
      mode: "average",
      sources: [],
      records: [pick("missing")],
    }),
  ).toEqual({ kind: "line", records: [] });
});

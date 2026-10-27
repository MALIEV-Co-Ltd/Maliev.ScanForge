import { expect, it } from "vitest";
import { refreshReferenceConstructions } from "../src/reference-construction-lifecycle";
import { resolveStoredReferenceConstructionInputs } from "../src/reference-construction-resolver";
import { resolveConstructionIdentities } from "../src/reference-construction-identity";
import type { ResolvedReferenceConstructionInputs } from "../src/reference-construction-evaluation";
import type {
  ReferenceConstructionDefinition,
  RetainedReferenceLinePick,
} from "../src/reference-construction";
import type {
  ReferenceGeometry,
  ReferenceVector,
} from "../src/reference-construction-values";
import type { ResolvedReferencePrimitive } from "../src/reference-point-evaluation";
import { assertReferenceWorkspaceAdmission } from "../src/reference-entity";
import { referenceDeletionDependents } from "../src/reference-midpoint";
import { duplicateObject, lockedObjectEdit } from "../src/object-operations";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
} from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
  type ProjectSession,
} from "../src/project-file-codec";
import { nativeDatumFitFeature } from "../src/scan-native-datum-feature";
import {
  createNumericDatumPlane,
  numericDatumFrame,
} from "../src/datum-construction";
import type { Entity, Project, Vec3 } from "../src/types";

const key = (value: number) => value.toString(16).padStart(32, "0");
function entity(
  id: string,
  order: number,
  definition: ReferenceConstructionDefinition,
  geometry: ReferenceGeometry,
): Entity {
  return {
    id,
    name: id,
    kind: geometry.kind === "point" ? "referencePoint" : "referenceLine",
    positions: [],
    constructionOrderKey: key(order),
    visible: true,
    color: "#abcdef",
    opacity: 1,
    reference: {
      version: 1,
      definition,
      geometry,
      evaluation: { completionWord: 0x100 },
    },
  };
}
function point(id: string, order: number, position: ReferenceVector): Entity {
  return entity(
    id,
    order,
    { version: 1, kind: "point", mode: "coordinates", position, sources: [] },
    { kind: "point", position },
  );
}
function line(
  id: string,
  order: number,
  start: ReferenceVector,
  direction: ReferenceVector,
  length: number,
): Entity {
  const end: ReferenceVector = [
    start[0] + direction[0] * length,
    start[1] + direction[1] * length,
    start[2] + direction[2] * length,
  ];
  return entity(
    id,
    order,
    {
      version: 1,
      kind: "line",
      mode: "endpoints",
      start,
      end,
      records: [],
      sources: [],
    },
    { kind: "line", start, direction, length },
  );
}
const sources = (scene: Entity[], ids: string[]) =>
  resolveConstructionIdentities(scene, ids).orderedSources;
const pick = (
  source: Entity,
  coordinates: ReferenceVector = [0, 0, 0],
): RetainedReferenceLinePick => ({
  entityId: source.id,
  storage: "native-pick-record-f32",
  coordinates,
});
function chain() {
  const a = point("a", 1, [0, 0, 0]),
    b = point("b", 2, [4, 0, 0]);
  const joined = entity(
    "joined",
    3,
    {
      version: 1,
      kind: "line",
      mode: "pair",
      sources: sources([a, b], [b.id, a.id]),
      records: [pick(a), pick(b, [4, 0, 0])],
    },
    { kind: "line", start: [0, 0, 0], direction: [1, 0, 0], length: 4 },
  );
  const center = entity(
    "center",
    4,
    {
      version: 1,
      kind: "point",
      mode: "center",
      sources: sources([joined], [joined.id]),
    },
    { kind: "point", position: [2, 0, 0] },
  );
  return { a, b, joined, center, scene: [center, joined, b, a] };
}
function admittedChain() {
  const value = chain();
  value.joined.reference!.definition = {
    version: 1,
    kind: "line",
    mode: "endpoints",
    start: [0, 0, 0],
    end: [4, 0, 0],
    sources: [],
    records: [pick(value.a, [-0, 2 ** -149, -0]), pick(value.b, [4, 0, 0])],
  };
  value.center.reference!.definition = {
    version: 1,
    kind: "point",
    mode: "pair",
    sources: sources(value.scene, [value.a.id, value.b.id]),
  };
  return value;
}
function project(entities: Entity[]): Project {
  return {
    format: "maliev-scanforge",
    version: 1,
    name: "Derived lifecycle",
    units: "mm",
    entities,
  };
}
function snapshotResolver(
  snapshots: ReadonlyMap<string, ResolvedReferencePrimitive>,
) {
  // Test-supplied, already acquired analytic primitives; no fit/native extent or pick-space inference.
  return (
    scene: readonly Entity[],
    definition: ReferenceConstructionDefinition,
  ): ResolvedReferenceConstructionInputs => {
    if (definition.kind === "line")
      return resolveStoredReferenceConstructionInputs(scene, definition);
    return {
      kind: "point",
      sources: definition.sources.map((source) => {
        const primitive = snapshots.get(source.id);
        if (primitive) return { source, primitive };
        const single = {
          version: 1 as const,
          kind: "point" as const,
          mode: "center" as const,
          sources: [source],
        };
        const resolved = resolveStoredReferenceConstructionInputs(
          scene,
          single,
        );
        if (resolved.kind !== "point")
          throw Error("Expected semantic point input bundle");
        return resolved.sources[0];
      }),
    };
  };
}

it("stages a semantic point -> pair line -> center chain in dependency order without mutating retained state", () => {
  const { a, b, joined, center } = chain(),
    changed = point(b.id, 2, [8, 0, 0]);
  a.locked = true; // A locked source is readable; it is not being changed.
  const scene = [center, changed, joined, a],
    before = structuredClone(scene);
  const result = refreshReferenceConstructions(scene, [changed.id]);
  expect(result.refreshedEntityIds).toEqual([joined.id, center.id]);
  expect(
    result.entities.find((e) => e.id === joined.id)!.reference!.geometry,
  ).toEqual({
    kind: "line",
    start: [0, 0, 0],
    direction: [1, 0, 0],
    length: 8,
  });
  expect(result.entities[0].reference!.geometry).toEqual({
    kind: "point",
    position: [4, 0, 0],
  });
  expect(
    result.evaluations.map((e) => [
      e.entityId,
      e.outcome,
      e.diagnostics.reason,
    ]),
  ).toEqual([
    [joined.id, "updated", "pair"],
    [center.id, "updated", "center"],
  ]);
  expect(result.entities.find((e) => e.id === a.id)).toBe(a);
  expect(result.entities.find((e) => e.id === changed.id)).toBe(changed);
  expect(scene).toEqual(before);
});

it("retains the sorted common set independently of repeated ordered average-line records", () => {
  const a = line("axis-a", 1, [0, 0, 0], [1, 0, 0], 4),
    b = line("axis-b", 2, [0, 0, 0], [0, 1, 0], 4);
  const definition: ReferenceConstructionDefinition = {
    version: 1,
    kind: "line",
    mode: "average",
    sources: sources([a, b], [b.id, a.id, a.id]),
    records: [pick(a, [-0, 2 ** -149, -0]), pick(a), pick(b)],
  };
  const average = entity("average", 3, definition, {
    kind: "line",
    start: [0, 0, 0],
    direction: [1, 0, 0],
    length: 0,
  });
  const before = structuredClone([average, b, a]),
    result = refreshReferenceConstructions([average, b, a], [a.id]);
  const updated = result.entities[0].reference!,
    geometry = updated.geometry;
  expect(updated.definition).toEqual(definition);
  expect(updated.definition.sources.map((s) => s.id)).toEqual([a.id, b.id]);
  expect(
    updated.definition.kind === "line" &&
      updated.definition.records.map((r) => r.entityId),
  ).toEqual([a.id, a.id, b.id]);
  expect(geometry.kind).toBe("line");
  if (geometry.kind !== "line") throw Error("Expected average line");
  expect(geometry.direction[0] / geometry.direction[1]).toBeCloseTo(2, 12);
  expect(result.evaluations[0].diagnostics.contributingRecords).toBe(3);
  expect([average, b, a]).toEqual(before);
});

it("uses supplied semantic-plane snapshots for a three-plane point without reconstructing native display extents", () => {
  const planes = [
    createNumericDatumPlane(
      numericDatumFrame([1, 0, 0], [1, 0, 0]),
      10,
      "x",
      "x",
    ),
    createNumericDatumPlane(
      numericDatumFrame([0, 2, 0], [0, 1, 0]),
      10,
      "y",
      "y",
    ),
    createNumericDatumPlane(
      numericDatumFrame([0, 0, 3], [0, 0, 1]),
      10,
      "z",
      "z",
    ),
  ].map((e, i) => ({ ...e, constructionOrderKey: key(i + 1) }));
  const definitions = sources(planes, ["z", "x", "y"]);
  const child = entity(
    "intersection",
    4,
    { version: 1, kind: "point", mode: "threePlanes", sources: definitions },
    { kind: "point", position: [7, 8, 9] },
  );
  const snapshots = new Map<string, ResolvedReferencePrimitive>(
    planes.map((e, i) => [
      e.id,
      {
        kind: "plane",
        origin: e.planeFrame!.center,
        normal: e.planeFrame!.normal,
        offset: -(i + 1),
      },
    ]),
  );
  const result = refreshReferenceConstructions([child, ...planes], ["x"], {
    resolveInputs: snapshotResolver(snapshots),
  });
  expect(result.entities[0].reference!.geometry).toEqual({
    kind: "point",
    position: [1, 2, 3],
  });
  expect(result.evaluations[0]).toMatchObject({
    entityId: child.id,
    outcome: "updated",
    diagnostics: { reason: "three-planes" },
  });
});

it("accepts an explicitly acquired sphere-center primitive, but never guesses an unavailable fit payload", () => {
  const fit = {
    kind: "sphere" as const,
    center: [2, 4, 6] as Vec3,
    axis: [0, 0, 1] as Vec3,
    radius: 2,
    rms: 0,
    maxError: 0,
  };
  const sphere: Entity = {
    id: "sphere",
    name: "sphere",
    kind: "sphere",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    fit,
    constructionOrderKey: key(1),
    visible: true,
    color: "#abcdef",
    opacity: 1,
  };
  const child = entity(
    "sphere-center",
    2,
    {
      version: 1,
      kind: "point",
      mode: "center",
      sources: sources([sphere], [sphere.id]),
    },
    { kind: "point", position: [7, 8, 9] },
  );
  expect(() =>
    refreshReferenceConstructions([sphere, child], [sphere.id]),
  ).toThrow(/source|primitive|bound|semantic/i);
  const acquired = nativeDatumFitFeature(fit);
  const result = refreshReferenceConstructions([sphere, child], [sphere.id], {
    resolveInputs: snapshotResolver(
      new Map([
        [
          sphere.id,
          { kind: "point", position: acquired.origin as ReferenceVector },
        ],
      ]),
    ),
  });
  expect(result.entities[1].reference!.geometry).toEqual({
    kind: "point",
    position: fit.center,
  });
  expect(result.entities[1].reference!.definition.sources).toEqual(
    child.reference!.definition.sources,
  );
});

it("retains both geometry and dirty word1 on a nearly parallel point pair instead of forcing completion", () => {
  const axis = line("axis", 1, [0, 0, 0], [1, 0, 0], 4),
    plane: Entity = {
      ...createNumericDatumPlane(
        numericDatumFrame([0, 0, 3], [0, 0, 1]),
        10,
        "plane",
        "plane",
      ),
      constructionOrderKey: key(2),
    };
  const child = entity(
    "pair-point",
    3,
    {
      version: 1,
      kind: "point",
      mode: "pair",
      sources: sources([axis, plane], [axis.id, plane.id]),
    },
    { kind: "point", position: [7, 8, 9] },
  );
  const result = refreshReferenceConstructions(
    [child, plane, axis],
    [axis.id],
    {
      resolveInputs: snapshotResolver(
        new Map([
          [
            plane.id,
            { kind: "plane", origin: [0, 0, 3], normal: [0, 0, 1], offset: -3 },
          ],
        ]),
      ),
    },
  );
  expect(result.entities[0].reference!.geometry).toEqual(
    child.reference!.geometry,
  );
  expect(result.entities[0].reference!.evaluation.completionWord).toBe(1);
  expect(result.evaluations[0]).toMatchObject({
    outcome: "unchanged",
    diagnostics: { reason: "axis-plane-nearly-parallel" },
  });
  expect(child.reference!.evaluation.completionWord).toBe(0x100);
});

it("preserves the native origin/fallback outcome for resolved extraction failure without treating a missing API source as that outcome", () => {
  const source = point("source", 1, [1, 2, 3]),
    child = entity(
      "child",
      2,
      {
        version: 1,
        kind: "point",
        mode: "center",
        sources: sources([source], [source.id]),
      },
      { kind: "point", position: [7, 8, 9] },
    );
  const result = refreshReferenceConstructions([source, child], [source.id], {
    resolveInputs: snapshotResolver(
      new Map([[source.id, { kind: "unavailable" }]]),
    ),
  });
  expect(result.entities[1].reference!.geometry).toEqual({
    kind: "point",
    position: [0, 0, 0],
  });
  expect(result.entities[1].reference!.evaluation.completionWord).toBe(0x100);
  expect(result.evaluations[0]).toMatchObject({
    outcome: "origin",
    diagnostics: { reason: "source-extraction-failed" },
  });
  expect(() => refreshReferenceConstructions([child], [child.id])).toThrow(
    /missing|source/i,
  );
});

it("publishes a valid parallel-axis fallback with its native completion state and keeps acquired input binding strict", () => {
  const a = line("a", 1, [0, 0, 0], [1, 0, 0], 4),
    b = line("b", 2, [0, 2, 0], [1, 0, 0], 4);
  const child = entity(
    "fallback",
    3,
    {
      version: 1,
      kind: "point",
      mode: "pair",
      sources: sources([a, b], [a.id, b.id]),
    },
    { kind: "point", position: [7, 8, 9] },
  );
  const scene = [child, b, a],
    before = structuredClone(scene);
  const result = refreshReferenceConstructions(scene, [a.id]);
  expect(result.entities[0].reference!.geometry).toEqual({
    kind: "point",
    position: [2, 1, 0],
  });
  expect(result.entities[0].reference!.evaluation.completionWord).toBe(0x100);
  expect(result.evaluations[0]).toMatchObject({
    outcome: "fallback",
    diagnostics: { reason: "axis-midpoints" },
  });
  expect(() =>
    refreshReferenceConstructions(scene, [a.id], {
      resolveInputs: (staged, definition) => {
        const resolved = resolveStoredReferenceConstructionInputs(
          staged,
          definition,
        );
        if (resolved.kind !== "point") throw Error("Expected point inputs");
        return { ...resolved, sources: [...resolved.sources].reverse() };
      },
    }),
  ).toThrow(/match|binding|source/i);
  expect(scene).toEqual(before);
});

it("rolls back the whole staged chain on locked children, cycles, missing sources or a late resolver/revision failure", () => {
  const { a, b, joined, center, scene } = chain();
  const before = structuredClone(scene);
  center.locked = true;
  expect(() => refreshReferenceConstructions(scene, [b.id])).toThrow(/locked/i);
  center.locked = false;
  expect(scene).toEqual(
    before.map((e) => (e.id === center.id ? { ...e, locked: false } : e)),
  );
  const cycle = structuredClone(scene);
  cycle.find((e) => e.id === a.id)!.reference!.definition = {
    version: 1,
    kind: "point",
    mode: "center",
    sources: sources(scene, [center.id]),
  };
  expect(() => refreshReferenceConstructions(cycle, [a.id])).toThrow(/cycle/i);
  const missing = scene.filter((e) => e.id !== a.id),
    missingBefore = structuredClone(missing);
  expect(() => refreshReferenceConstructions(missing, [b.id])).toThrow(
    /missing|source/i,
  );
  expect(missing).toEqual(missingBefore);
  expect(() =>
    refreshReferenceConstructions(scene, [b.id], {
      resolveInputs: (staged, definition) => {
        if (definition.kind === "point") throw Error("stale acquired source");
        return resolveStoredReferenceConstructionInputs(staged, definition);
      },
    }),
  ).toThrow(/stale acquired source/);
  expect(joined.reference!.geometry).toEqual(
    before.find((e) => e.id === joined.id)!.reference!.geometry,
  );
  expect(center.reference!.geometry).toEqual(
    before.find((e) => e.id === center.id)!.reference!.geometry,
  );
  expect(() =>
    refreshReferenceConstructions(scene, [b.id], {
      check: () => {
        throw Error("revision changed");
      },
    }),
  ).toThrow(/revision changed/);
});

it("retains the explicit complete-set deletion policy and leaves native duplication gated until its policy is recovered", () => {
  const { a, b, joined, center, scene } = chain();
  expect(referenceDeletionDependents(scene, [a.id])).toEqual([joined.id]);
  expect(referenceDeletionDependents(scene, [a.id, joined.id])).toEqual([
    center.id,
  ]);
  expect(
    referenceDeletionDependents(scene, [a.id, b.id, joined.id, center.id]),
  ).toEqual([]);
  const before = structuredClone(scene);
  expect(() => duplicateObject(joined, "copy", scene)).toThrow(
    /duplication.*not yet supported/i,
  );
  expect(scene).toEqual(before);
});

it("admits completed point modes and typed inactive records through real JSON and binary current/history/future codecs", async () => {
  const { joined, center, scene } = admittedChain();
  joined.reference!.geometry = {
    kind: "line",
    start: [-0, 0, 0],
    direction: [1, -0, 0],
    length: 4,
  };
  const session: ProjectSession = {
    project: project(scene),
    history: [{ label: "Before", entities: structuredClone(scene) }],
    future: [{ label: "After", entities: structuredClone(scene) }],
  };
  expect(() => assertReferenceWorkspaceAdmission(session)).not.toThrow();
  const encoded = [
    parseProject(serializeProject("Derived", scene)),
    parseProject(await (await serializeProjectBlob("Derived", scene)).text()),
  ];
  for (const restored of encoded) {
    expect(() =>
      assertReferenceWorkspaceAdmission({
        project: restored,
        history: [],
        future: [],
      }),
    ).not.toThrow();
    expect(
      restored.entities.find((e) => e.id === joined.id)!.reference,
    ).toEqual(joined.reference);
  }
  const restored = await decodeProjectContents(
    await encodeProjectFileLocally(session),
  );
  expect(() => assertReferenceWorkspaceAdmission(restored)).not.toThrow();
  for (const entities of [
    restored.project.entities,
    restored.history[0].entities,
    restored.future[0].entities,
  ]) {
    const retained = entities.find((e) => e.id === joined.id)!.reference!;
    expect(retained).toEqual(joined.reference);
    expect(
      Object.is(
        retained.geometry.kind === "line" && retained.geometry.start[0],
        -0,
      ),
    ).toBe(true);
    expect(
      retained.definition.kind === "line" &&
        Object.is(retained.definition.records[0].coordinates[0], -0),
    ).toBe(true);
    expect(
      entities.find((e) => e.id === center.id)!.reference!.definition.sources,
    ).toEqual(center.reference!.definition.sources);
  }
});

it.each(["current", "history", "future"] as const)(
  "rejects broken %s source identities before project admission without changing retained data",
  (slot) => {
    const { scene } = admittedChain(),
      session: ProjectSession = {
        project: project(structuredClone(scene)),
        history: [{ label: "Before", entities: structuredClone(scene) }],
        future: [{ label: "After", entities: structuredClone(scene) }],
      };
    const entities =
      slot === "current"
        ? session.project.entities
        : slot === "history"
          ? session.history[0].entities
          : session.future[0].entities;
    entities.find((e) => e.id === "a")!.constructionOrderKey = key(99);
    const before = structuredClone(session);
    expect(() => assertReferenceWorkspaceAdmission(session)).toThrow(
      /identity|binding|source/i,
    );
    expect(session).toEqual(before);
  },
);

it("does not manufacture dependencies from inactive legacy pick records and supports identity-only locked-source migration", () => {
  const source = line("source", 1, [0, 0, 0], [1, 0, 0], 4);
  source.reference!.definition = {
    ...source.reference!.definition,
    kind: "line",
    mode: "endpoints",
    start: [0, 0, 0],
    end: [4, 0, 0],
    records: [
      {
        entityId: "deleted-inactive-source",
        storage: "native-pick-record-f32",
        coordinates: [-0, 2 ** -149, -0],
      },
    ],
  };
  const session: ProjectSession = {
    project: project([source]),
    history: [],
    future: [],
  };
  expect(() => assertReferenceWorkspaceAdmission(session)).not.toThrow();
  expect(
    refreshReferenceConstructions([source], [source.id]).refreshedEntityIds,
  ).toEqual([]);
  const old: Entity = {
    ...createNumericDatumPlane(
      numericDatumFrame([0, 0, 0], [0, 0, 1]),
      10,
      "legacy-plane",
      "legacy-plane",
    ),
    locked: true,
  };
  const migration = resolveConstructionIdentities([old], [old.id]).assignments,
    next = { ...old, constructionOrderKey: migration[0].constructionOrderKey };
  expect(
    lockedObjectEdit([old], [next], {
      constructionIdentityMigration: migration,
    }),
  ).toBeUndefined();
  expect(() =>
    lockedObjectEdit(
      [old],
      [{ ...next, planeFrame: { ...next.planeFrame!, center: [1, 0, 0] } }],
      { constructionIdentityMigration: migration },
    ),
  ).toThrow(/may change only the source key/i);
  expect(old.constructionOrderKey).toBeUndefined();
});

it("admits acquired semantic pair lines in public project admission while preserving their records", () => {
  const { scene } = chain();
  const before = structuredClone(scene);
  expect(() =>
    assertReferenceWorkspaceAdmission({
      project: project(scene),
      history: [],
      future: [],
    }),
  ).not.toThrow();
  expect(scene).toEqual(before);
});
it("admits whole point common sets without imposing evaluator arity, and validates numeric-plane bindings by default", () => {
  const planes = [
    createNumericDatumPlane(
      numericDatumFrame([1, 0, 0], [1, 0, 0]),
      10,
      "x",
      "x",
    ),
    createNumericDatumPlane(
      numericDatumFrame([0, 2, 0], [0, 1, 0]),
      10,
      "y",
      "y",
    ),
    createNumericDatumPlane(
      numericDatumFrame([0, 0, 3], [0, 0, 1]),
      10,
      "z",
      "z",
    ),
  ].map((value, index) => ({ ...value, constructionOrderKey: key(index + 1) }));
  const child = entity(
    "three",
    4,
    {
      version: 1,
      kind: "point",
      mode: "threePlanes",
      sources: sources(planes, ["x", "y", "z"]),
    },
    { kind: "point", position: [9, 9, 9] },
  );
  const scene = [...planes, child];
  expect(
    refreshReferenceConstructions(scene, ["x"]).entities[3].reference!.geometry,
  ).toEqual({ kind: "point", position: [1, 2, 3] });
  expect(() =>
    assertReferenceWorkspaceAdmission({
      project: project(scene),
      history: [],
      future: [],
    }),
  ).not.toThrow();
  child.reference!.definition = {
    version: 1,
    kind: "point",
    mode: "center",
    sources: [],
  };
  expect(() =>
    assertReferenceWorkspaceAdmission({
      project: project(scene),
      history: [],
      future: [],
    }),
  ).not.toThrow();
  child.reference!.definition = {
    version: 1,
    kind: "point",
    mode: "pair",
    sources: sources(planes, ["x", "y", "z"]),
  };
  expect(() =>
    assertReferenceWorkspaceAdmission({
      project: project(scene),
      history: [],
      future: [],
    }),
  ).not.toThrow();
});

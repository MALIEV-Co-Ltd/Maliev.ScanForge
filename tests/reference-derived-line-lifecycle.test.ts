import { expect, it } from "vitest";
import {
  assertReferenceConstructionSceneAdmission,
  buildReferenceLineDefinition,
  refreshReferenceConstructions,
} from "../src/reference-construction-lifecycle";
import { resolveStoredReferenceConstructionInputs } from "../src/reference-construction-resolver";
import { evaluateReferenceConstruction } from "../src/reference-construction-evaluation";
import {
  encodeReferenceConstruction,
  type ReferenceConstructionDefinition,
  type RetainedReferenceLinePick,
} from "../src/reference-construction";
import {
  encodeReferenceGeometry,
  type ReferenceGeometry,
  type ReferenceLineGeometry,
  type ReferenceVector,
} from "../src/reference-construction-values";
import {
  assertReferenceWorkspaceAdmission,
  encodeReferenceEntityData,
} from "../src/reference-entity";
import { referenceDeletionDependents } from "../src/reference-midpoint";
import { duplicateObject } from "../src/object-operations";
import {
  createNumericDatumPlane,
  numericDatumFrame,
} from "../src/datum-construction";
import { serializeProject, parseProject } from "../src/io";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
  type ProjectSession,
} from "../src/project-file-codec";
import type { Entity, FitResult, Project } from "../src/types";

// Application located-source arithmetic, not native hit production. Native
// evaluator/storage is reused after acquisition; no default prior is invented.
const key = (n: number) => n.toString(16).padStart(32, "0");
const binding = (entity: Entity) => ({
  id: entity.id,
  constructionOrderKey: entity.constructionOrderKey!,
});
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
    color: "#abcdef",
    opacity: 1,
    visible: true,
    constructionOrderKey: key(order),
    reference: {
      version: 1,
      definition,
      geometry,
      evaluation: { completionWord: 256 },
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
function axis(id: string, order: number, y = 0): Entity {
  const start: ReferenceVector = [0, y, 0],
    end: ReferenceVector = [10, y, 0];
  return entity(
    id,
    order,
    {
      version: 1,
      kind: "line",
      mode: "endpoints",
      start,
      end,
      sources: [],
      records: [],
    },
    { kind: "line", start, direction: [1, 0, 0], length: 10 },
  );
}
const pick = (
  source: Entity,
  coordinates: ReferenceVector,
): RetainedReferenceLinePick => ({
  entityId: source.id,
  storage: "native-pick-record-f32",
  coordinates,
});
function prior(
  start: ReferenceVector = [2, 99, 0],
  length = 6,
): ReferenceLineGeometry {
  return { kind: "line", start, direction: [1, 0, 0], length };
}
function project(entities: Entity[]): Project {
  return {
    format: "maliev-scanforge",
    version: 1,
    name: "Located line lifecycle",
    units: "mm",
    entities,
  };
}
function session(entities: Entity[]): ProjectSession {
  return {
    project: project(entities),
    history: [{ label: "Before", entities: structuredClone(entities) }],
    future: [{ label: "After", entities: structuredClone(entities) }],
  };
}
function evaluated(
  scene: Entity[],
  definition: ReferenceConstructionDefinition,
  geometry: ReferenceLineGeometry,
) {
  return evaluateReferenceConstruction(
    definition,
    resolveStoredReferenceConstructionInputs(scene, definition),
    { geometry, state: { completionWord: 1 } },
  );
}
function mixedChain() {
  const a = point("a", 1, [0, 0, 0]),
    b = point("b", 2, [4, 0, 0]),
    d = point("d", 3, [10, 0, 0]);
  const joined = entity(
    "joined",
    4,
    {
      version: 1,
      kind: "line",
      mode: "pair",
      sources: [binding(a), binding(b)],
      records: [pick(a, [-0, 2 ** -149, -0]), pick(b, [4, 0, 0])],
    },
    { kind: "line", start: [0, 0, 0], direction: [1, 0, 0], length: 4 },
  );
  const center = entity(
    "center",
    5,
    { version: 1, kind: "point", mode: "center", sources: [binding(joined)] },
    { kind: "point", position: [2, 0, 0] },
  );
  const outer = entity(
    "outer",
    6,
    {
      version: 1,
      kind: "line",
      mode: "pair",
      sources: [binding(d), binding(center)],
      records: [pick(center, [2, 0, 0]), pick(d, [10, 0, 0])],
    },
    { kind: "line", start: [2, 0, 0], direction: [1, 0, 0], length: 8 },
  );
  const last = entity(
    "last",
    7,
    { version: 1, kind: "point", mode: "center", sources: [binding(outer)] },
    { kind: "point", position: [6, 0, 0] },
  );
  return {
    a,
    b,
    d,
    joined,
    center,
    outer,
    last,
    scene: [last, outer, center, joined, d, b, a],
  };
}
function averageFixture() {
  const a = axis("a", 1, 2),
    b = axis("b", 2, 6);
  const definition: ReferenceConstructionDefinition = {
    version: 1,
    kind: "line",
    mode: "average",
    sources: [binding(a), binding(b)],
    records: [pick(a, [-0, 2, 0]), pick(b, [9, 6, 0]), pick(a, [10, 2, -0])],
  };
  const result = entity(
    "average",
    3,
    definition,
    prior([2, 3.333333333333333, 0]),
  );
  return { a, b, result, definition, scene: [result, b, a] };
}

it("acquires a semantic point into exact F32 world suffixes without the numeric N6/DDX bake", () => {
  const a = point("a", 2, [1.0000005, -0, 0.0078125]),
    b = point("b", 1, [9, 2, 3]);
  const scene = [a, b],
    before = structuredClone(scene);
  const built = buildReferenceLineDefinition(scene, "pair", [
    { entityId: a.id },
    { entityId: b.id },
  ]);
  expect(built.definition.kind).toBe("line");
  if (built.definition.kind !== "line") throw Error("Expected acquired line");
  expect(built.definition.records[0].coordinates).toEqual([
    1.0000004768371582, -0, 0.0078125,
  ]);
  const encoded = encodeReferenceConstruction(built.definition);
  if (encoded.kind !== "line") throw Error("Expected line encoding");
  expect(encoded.records[0].bits).toBe("0400803f000000800000003c");
  expect(built.definition.sources.map((row) => row.id)).toEqual([b.id, a.id]);
  expect(built.assignments).toEqual([]);
  expect(scene).toEqual(before);
});

it("locates line fractions from authoritative raw direction times length, never a display midpoint", () => {
  const a = axis("a", 1);
  a.reference!.geometry = {
    kind: "line",
    start: [1, 2, 3],
    direction: [2, 0, 0],
    length: 3,
  };
  const built = buildReferenceLineDefinition([a], "pair", [
    { entityId: a.id, parameter: 0.25 },
    { entityId: a.id, parameter: 1 },
  ]);
  if (built.definition.kind !== "line") throw Error("Expected acquired line");
  expect(built.definition.records.map((row) => row.coordinates)).toEqual([
    [2.5, 2, 3],
    [7, 2, 3],
  ]);
  expect(built.definition.sources).toEqual([binding(a)]);
});

it("retains requested cross-source order and repeated weighting separately from canonical dependencies", () => {
  const a = axis("a", 2, 2),
    b = axis("b", 1, 6);
  const built = buildReferenceLineDefinition([a, b], "average", [
    { entityId: a.id, parameter: 1 },
    { entityId: b.id, parameter: 0 },
    { entityId: a.id, parameter: 0.25 },
  ]);
  if (built.definition.kind !== "line") throw Error("Expected acquired line");
  expect(built.definition.sources.map((row) => row.id)).toEqual([b.id, a.id]);
  expect(built.definition.records.map((row) => row.entityId)).toEqual([
    a.id,
    b.id,
    a.id,
  ]);
  expect(built.definition.records.map((row) => row.coordinates)).toEqual([
    [10, 2, 0],
    [0, 6, 0],
    [2.5, 2, 0],
  ]);
  expect(Reflect.ownKeys(built.definition.records[0]).sort()).toEqual([
    "coordinates",
    "entityId",
    "storage",
  ]);
});

it("reads locked, hidden and nonselectable semantic sources without mutating presentation or source identity", () => {
  const a = {
      ...axis("a", 1),
      locked: true,
      visible: false,
      selectable: false,
    },
    b = point("b", 2, [0, 2, 0]);
  const scene = [a, b],
    before = structuredClone(scene);
  expect(
    buildReferenceLineDefinition(scene, "pair", [
      { entityId: a.id, parameter: 0 },
      { entityId: b.id },
    ]).definition.sources,
  ).toEqual([binding(a), binding(b)]);
  expect(scene).toEqual(before);
});

const invalidPicks: unknown[] = [
  [{ entityId: "a" }, { entityId: "b" }],
  [{ entityId: "a", parameter: -0.1 }, { entityId: "b" }],
  [{ entityId: "a", parameter: 1.1 }, { entityId: "b" }],
  [{ entityId: "a", parameter: NaN }, { entityId: "b" }],
  [{ entityId: "a", parameter: Infinity }, { entityId: "b" }],
  [{ entityId: "a", parameter: "0.5" }, { entityId: "b" }],
  [
    { entityId: "a", parameter: 0.5 },
    { entityId: "b", parameter: 0 },
  ],
  [{ entityId: "missing" }, { entityId: "b" }],
  [
    { entityId: "a", parameter: 0.5, coordinates: [0, 0, 0] },
    { entityId: "b" },
  ],
  [{ entityId: "a", parameter: 0.5, bits: "00".repeat(12) }, { entityId: "b" }],
  [
    { entityId: "a", parameter: 0.5, constructionOrderKey: key(99) },
    { entityId: "b" },
  ],
  [null, { entityId: "b" }],
];
it.each(invalidPicks.map((picks) => ({ picks })))(
  "rejects malformed, unmapped or caller-authored located acquisition: %j",
  ({ picks }) => {
    const scene = [axis("a", 1), point("b", 2, [0, 2, 0])],
      before = structuredClone(scene);
    expect(() =>
      Reflect.apply(buildReferenceLineDefinition, undefined, [
        scene,
        "pair",
        picks,
      ]),
    ).toThrow(/source|parameter|pick|field|coordinate|identity/i);
    expect(scene).toEqual(before);
  },
);

it("rejects ambiguous duplicate source identities and out-of-world source locations", () => {
  const a = point("a", 1, [1e9 + 1, 0, 0]),
    b = point("b", 2, [0, 0, 0]);
  expect(() =>
    buildReferenceLineDefinition([a, b], "pair", [
      { entityId: a.id },
      { entityId: b.id },
    ]),
  ).toThrow(/bound|world|coordinate/i);
  expect(() =>
    buildReferenceLineDefinition([b, { ...b }], "pair", [
      { entityId: b.id },
      { entityId: b.id },
    ]),
  ).toThrow(/duplicate|unique|ambiguous|identity/i);
});

it("requires semantic lines for average while pair may consume semantic points", () => {
  const a = point("a", 1, [0, 0, 0]),
    b = point("b", 2, [4, 0, 0]);
  expect(() =>
    buildReferenceLineDefinition([a, b], "average", [
      { entityId: a.id },
      { entityId: b.id },
    ]),
  ).toThrow(/average|axis|line|source/i);
  expect(() =>
    buildReferenceLineDefinition([a, b], "pair", [
      { entityId: a.id },
      { entityId: b.id },
    ]),
  ).not.toThrow();
});

it.each(["pointcloud", "mesh", "plane", "fitted", "cad"] as const)(
  "keeps unresolved %s line source families outside this located-semantic adapter",
  (family) => {
    const fitted: FitResult = {
      kind: "sphere",
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 1,
      rms: 0,
      maxError: 0,
    };
    const a = axis("a", 1),
      b: Entity =
        family === "plane"
          ? {
              ...createNumericDatumPlane(
                numericDatumFrame([0, 0, 0], [0, 0, 1]),
                10,
                "b",
                "b",
              ),
              constructionOrderKey: key(2),
            }
          : {
              id: "b",
              name: "b",
              kind:
                family === "pointcloud"
                  ? "pointcloud"
                  : family === "cad"
                    ? "cad"
                    : family === "fitted"
                      ? "sphere"
                      : "mesh",
              positions: [0, 0, 0],
              color: "#fff",
              opacity: 1,
              visible: true,
              constructionOrderKey: key(2),
              ...(family === "cad" ? { kernelId: "unresolved-cad" } : {}),
              ...(family === "fitted" ? { fit: fitted } : {}),
            };
    expect(() =>
      buildReferenceLineDefinition([a, b], "pair", [
        { entityId: a.id, parameter: 0 },
        { entityId: b.id },
      ]),
    ).toThrow(/source|semantic|family|bound|geometry/i);
  },
);

it("bounds acquisition work locally without editing sources or inferring a native count rule", () => {
  const a = axis("a", 1),
    before = structuredClone(a);
  const picks = Array.from({ length: 1001 }, () => ({
    entityId: a.id,
    parameter: 0.5,
  }));
  expect(() => buildReferenceLineDefinition([a], "average", picks)).toThrow(
    /limit|resource|work|record/i,
  );
  expect(a).toEqual(before);
});

it("uses an explicit accepted average prior and repeated axes rather than inventing a zero seed", () => {
  const { a, b, definition } = averageFixture();
  const knownPrior = prior(),
    result = evaluated([a, b], definition, knownPrior);
  expect(result.geometry).toEqual(prior([2, 3.333333333333333, 0]));
  expect(result.diagnostics.reason).toBe("average-prior-extent");
  expect(result.diagnostics.contributingRecords).toBe(3);
  expect(result.state.completionWord).toBe(256);
  expect(knownPrior).toEqual(prior());
});

it("retains actual pair prior geometry when coincident source endpoints reject a write", () => {
  const a = point("a", 1, [5, 6, 7]),
    b = point("b", 2, [5, 6, 7]);
  const definition: ReferenceConstructionDefinition = {
    version: 1,
    kind: "line",
    mode: "pair",
    sources: [binding(a), binding(b)],
    records: [pick(a, [5, 6, 7]), pick(b, [5, 6, 7])],
  };
  const actualPrior = prior([12, 13, 14], 7),
    result = evaluated([a, b], definition, actualPrior);
  expect(encodeReferenceGeometry(result.geometry)).toEqual(
    encodeReferenceGeometry(actualPrior),
  );
  expect(result.outcome).toBe("unchanged");
  expect(result.diagnostics.reason).toBe("degenerate-endpoints");
  expect(result.state.completionWord).toBe(256);
});

it("admits and refreshes a full point -> line -> point -> line -> point closure in topological order", () => {
  const c = mixedChain(),
    changed = point("b", 2, [8, 0, 0]);
  const scene = c.scene.map((row) => (row.id === changed.id ? changed : row)),
    before = structuredClone(scene);
  expect(() => assertReferenceConstructionSceneAdmission(scene)).not.toThrow();
  const refreshed = refreshReferenceConstructions(scene, [changed.id]);
  expect(refreshed.refreshedEntityIds).toEqual([
    "joined",
    "center",
    "outer",
    "last",
  ]);
  expect(
    refreshed.entities.find((row) => row.id === "last")!.reference!.geometry,
  ).toEqual({ kind: "point", position: [7, 0, 0] });
  expect(refreshed.evaluations.map((row) => row.entityId)).toEqual(
    refreshed.refreshedEntityIds,
  );
  expect(scene).toEqual(before);
  for (const id of ["joined", "outer"]) {
    expect(
      encodeReferenceConstruction(
        refreshed.entities.find((row) => row.id === id)!.reference!.definition,
      ),
    ).toEqual(
      encodeReferenceConstruction(
        scene.find((row) => row.id === id)!.reference!.definition,
      ),
    );
  }
});

it("refreshes average primitives while preserving acquired F32 suffixes instead of following the old fractions", () => {
  const c = averageFixture(),
    changed = axis("b", 2, 10),
    scene = [c.result, changed, c.a];
  const encoded = encodeReferenceConstruction(c.definition),
    result = refreshReferenceConstructions(scene, [changed.id]);
  const refreshed = result.entities.find(
    (row) => row.id === c.result.id,
  )!.reference!;
  expect(refreshed.geometry).toEqual(prior([2, 4.666666666666666, 0]));
  expect(encodeReferenceConstruction(refreshed.definition)).toEqual(encoded);
  expect(result.refreshedEntityIds).toEqual([c.result.id]);
});

it("rolls back staged line and point results when a deep descendant is locked", () => {
  const c = mixedChain();
  c.last.locked = true;
  const scene = c.scene.map((row) =>
      row.id === "b" ? point("b", 2, [8, 0, 0]) : row,
    ),
    before = structuredClone(scene);
  expect(() => refreshReferenceConstructions(scene, ["b"])).toThrow(/locked/i);
  expect(scene).toEqual(before);
});

it("cancels midway through a mixed closure without publishing partially refreshed geometry or records", () => {
  const c = mixedChain(),
    before = structuredClone(c.scene);
  expect(() =>
    refreshReferenceConstructions(c.scene, ["b"], {
      resolveInputs: (staged, definition) => {
        if (definition.kind === "point")
          throw Error("operation cancelled after staged line");
        return resolveStoredReferenceConstructionInputs(staged, definition);
      },
    }),
  ).toThrow(/cancelled/i);
  expect(c.scene).toEqual(before);
});

it("rejects missing and rebound active sources atomically rather than using the stored F32 location as geometry", () => {
  const c = mixedChain(),
    missing = c.scene.filter((row) => row.id !== "a"),
    before = structuredClone(missing);
  expect(() => assertReferenceConstructionSceneAdmission(missing)).toThrow(
    /missing|source/i,
  );
  expect(() => refreshReferenceConstructions(missing, ["b"])).toThrow(
    /missing|source/i,
  );
  expect(missing).toEqual(before);
  const rebound = c.scene.map((row) =>
    row.id === "a" ? { ...row, constructionOrderKey: key(99) } : row,
  );
  expect(() => assertReferenceConstructionSceneAdmission(rebound)).toThrow(
    /identity|binding|source/i,
  );
});

it("rejects an active record outside its canonical common set without discarding repeated valid records", () => {
  const c = mixedChain();
  const definition = c.joined.reference!.definition;
  if (definition.kind !== "line") throw Error("Expected line");
  c.joined.reference!.definition = {
    ...definition,
    records: [pick(c.d, [10, 0, 0]), ...definition.records],
  };
  const before = structuredClone(c.scene);
  expect(() => assertReferenceConstructionSceneAdmission(c.scene)).toThrow(
    /record|source|binding|depend/i,
  );
  expect(c.scene).toEqual(before);
});

it("detects mixed point/line cycles before staged evaluation and leaves all saved values intact", () => {
  const c = mixedChain();
  c.a.reference!.definition = {
    version: 1,
    kind: "point",
    mode: "center",
    sources: [binding(c.joined)],
  };
  const before = structuredClone(c.scene);
  expect(() => assertReferenceConstructionSceneAdmission(c.scene)).toThrow(
    /cycle/i,
  );
  expect(() => refreshReferenceConstructions(c.scene, ["b"])).toThrow(/cycle/i);
  expect(c.scene).toEqual(before);
});

it("keeps numeric endpoints' inactive records exact without resurrecting missing dependencies", () => {
  const a = axis("numeric", 1),
    geometry = encodeReferenceGeometry(a.reference!.geometry);
  a.reference!.definition = {
    version: 1,
    kind: "line",
    mode: "endpoints",
    start: [0, 0, 0],
    end: [10, 0, 0],
    sources: [],
    records: [
      {
        entityId: "deleted-owner",
        storage: "native-pick-record-f32",
        coordinates: [-0, 2 ** -149, -0],
      },
    ],
  };
  expect(() => assertReferenceConstructionSceneAdmission([a])).not.toThrow();
  expect(referenceDeletionDependents([a], ["deleted-owner"])).toEqual([]);
  expect(refreshReferenceConstructions([a], [a.id]).refreshedEntityIds).toEqual(
    [],
  );
  const reopened = parseProject(serializeProject("Inactive records", [a]))
    .entities[0];
  expect(encodeReferenceConstruction(reopened.reference!.definition)).toEqual(
    encodeReferenceConstruction(a.reference!.definition),
  );
  expect(encodeReferenceGeometry(reopened.reference!.geometry)).toEqual(
    geometry,
  );
});

it("roundtrips admitted pair and average lines through JSON without recomputing retained geometry or completion words", () => {
  const c = mixedChain(),
    avg = averageFixture();
  avg.result.id = "average-result";
  avg.result.constructionOrderKey = key(20);
  // Keep independent scenes so their stable source keys do not collide.
  for (const scene of [c.scene, avg.scene]) {
    scene[0].reference!.evaluation.completionWord = 1;
    const before = scene.map((row) =>
      encodeReferenceEntityData(row.reference!),
    );
    const restored = parseProject(serializeProject("Located line", scene));
    expect(() =>
      assertReferenceConstructionSceneAdmission(restored.entities),
    ).not.toThrow();
    expect(
      restored.entities.map((row) => encodeReferenceEntityData(row.reference!)),
    ).toEqual(before);
  }
});

it("preserves F32 picks, common source identities, actual priors and dirty state in binary current/history/future", async () => {
  const c = mixedChain(),
    input = session(c.scene);
  input.project.entities[0].reference!.evaluation.completionWord = 1;
  const expected = [
    input.project.entities,
    input.history[0].entities,
    input.future[0].entities,
  ].map((rows) => rows.map((row) => encodeReferenceEntityData(row.reference!)));
  expect(() => assertReferenceWorkspaceAdmission(input)).not.toThrow();
  const restored = await decodeProjectContents(
    await encodeProjectFileLocally(input),
  );
  expect(() => assertReferenceWorkspaceAdmission(restored)).not.toThrow();
  expect(
    [
      restored.project.entities,
      restored.history[0].entities,
      restored.future[0].entities,
    ].map((rows) =>
      rows.map((row) => encodeReferenceEntityData(row.reference!)),
    ),
  ).toEqual(expected);
});

it.each(["current", "history", "future"] as const)(
  "rejects broken located-line source identities in %s admission before recovery mutates any state",
  (slot) => {
    const input = session(mixedChain().scene);
    const rows =
      slot === "current"
        ? input.project.entities
        : slot === "history"
          ? input.history[0].entities
          : input.future[0].entities;
    rows.find((row) => row.id === "a")!.constructionOrderKey = key(99);
    const before = structuredClone(input);
    expect(() => assertReferenceWorkspaceAdmission(input)).toThrow(
      /identity|binding|source/i,
    );
    expect(input).toEqual(before);
  },
);

it("requires complete deletion closure across mixed derived lines and points and keeps duplication gated", () => {
  const c = mixedChain(),
    before = structuredClone(c.scene);
  expect(referenceDeletionDependents(c.scene, ["a"])).toEqual(["joined"]);
  expect(
    referenceDeletionDependents(c.scene, ["a", "joined", "center"]),
  ).toEqual(["outer"]);
  expect(
    referenceDeletionDependents(c.scene, [
      "a",
      "joined",
      "center",
      "outer",
      "last",
    ]),
  ).toEqual([]);
  expect(() => duplicateObject(c.joined, "copy", c.scene)).toThrow(
    /duplication.*not yet supported/i,
  );
  expect(c.scene).toEqual(before);
});

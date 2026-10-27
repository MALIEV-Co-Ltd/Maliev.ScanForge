import type { Entity } from "./types";
import {
  copyReferenceConstruction,
  type ReferenceConstructionDefinition,
} from "./reference-construction";
import { resolveConstructionIdentities } from "./reference-construction-identity";
import {
  copyReferenceEntityData,
  validateReferenceEntity,
  validateConstructionOrderKeys,
} from "./reference-entity";
import {
  acquireLocatedReferenceLinePick,
  resolveReferenceLineSource,
  resolveReferencePointSource,
  resolveStoredReferenceConstructionInputs,
  type DerivedReferenceLineMode,
  type LocatedReferenceSourcePick,
} from "./reference-construction-resolver";
import {
  evaluateReferenceConstruction,
  type ResolvedReferenceConstructionInputs,
  type ReferenceConstructionEvaluation,
} from "./reference-construction-evaluation";
import { datumEntityDependencies } from "./datum-dependencies";
import { referenceGeometrySceneBounds } from "./reference-scene-bounds";

/** Operation-local admission; project decoding has no scene-count limit. */
export const REFERENCE_CONSTRUCTION_SCENE_LIMIT = 10000;
export const REFERENCE_CONSTRUCTION_WORK_LIMIT = 2000000;
/** Acquisition/refresh operation budget, not native enablement or a project cap. */
export const REFERENCE_CONSTRUCTION_LINE_RECORD_LIMIT = 1000;
export type DerivedReferencePointMode = "center" | "pair" | "threePlanes";

/** Acquire retained hits once; evaluation always receives an explicit prior separately. */
export function buildReferenceLineDefinition(
  scene: readonly Entity[],
  mode: DerivedReferenceLineMode,
  sourcePicks: readonly LocatedReferenceSourcePick[],
) {
  if (mode !== "pair" && mode !== "average")
    throw new Error("Invalid derived reference line mode.");
  if (!Array.isArray(sourcePicks))
    throw new Error("Located reference source picks require an array.");
  if (scene.length > REFERENCE_CONSTRUCTION_SCENE_LIMIT)
    throw new Error("Reference construction scene limit exceeded.");
  if (sourcePicks.length > REFERENCE_CONSTRUCTION_LINE_RECORD_LIMIT)
    throw new Error("Reference construction line record limit exceeded.");
  const identities = resolveConstructionIdentities(
    scene,
    Array.from(sourcePicks, (pick) => pick?.entityId),
  );
  const byId = new Map(scene.map((entity) => [entity.id, entity]));
  const records = Array.from(sourcePicks, (pick) =>
    acquireLocatedReferenceLinePick(byId.get(pick.entityId)!, pick, mode),
  );
  const definition = copyReferenceConstruction({
    version: 1,
    kind: "line",
    mode,
    records,
    sources: identities.orderedSources,
  });
  return { definition, assignments: identities.assignments };
}

export function buildReferencePointDefinition(
  scene: readonly Entity[],
  mode: DerivedReferencePointMode,
  sourceEntityIds: readonly string[],
) {
  if (!["center", "pair", "threePlanes"].includes(mode))
    throw new Error("Invalid derived reference point mode.");
  if (scene.length > REFERENCE_CONSTRUCTION_SCENE_LIMIT)
    throw new Error("Reference construction scene limit exceeded.");
  const identities = resolveConstructionIdentities(scene, sourceEntityIds);
  const byId = new Map(scene.map((entity) => [entity.id, entity]));
  for (const source of identities.orderedSources)
    resolveReferencePointSource(byId.get(source.id)!);
  const definition = copyReferenceConstruction({
    version: 1,
    kind: "point",
    mode,
    sources: identities.orderedSources,
  });
  return { definition, assignments: identities.assignments };
}

function assertBindings(
  scene: ReadonlyMap<string, Entity>,
  definition: ReferenceConstructionDefinition,
) {
  if (
    (definition.mode === "coordinates" || definition.mode === "endpoints") &&
    definition.sources.length
  )
    throw new Error(
      "Stored coordinate references cannot retain common-source dependencies.",
    );
  for (const source of definition.sources) {
    const entity = scene.get(source.id);
    if (!entity)
      throw new Error("Missing reference construction source: " + source.id);
    if (entity.constructionOrderKey !== source.constructionOrderKey)
      throw new Error(
        "Reference construction source identity binding changed.",
      );
  }
  if (definition.kind === "line" && definition.mode !== "endpoints") {
    const common = new Set(definition.sources.map((source) => source.id));
    for (const record of definition.records)
      if (!common.has(record.entityId))
        throw new Error(
          "Active reference line record is outside its common source set.",
        );
  }
}

/** Admit completed semantic point/line families without reevaluation or work-count caps. */
export function assertReferenceConstructionSceneAdmission(
  entities: readonly Entity[],
): void {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  if (byId.size !== entities.length)
    throw new Error("Duplicate reference scene identity.");
  validateConstructionOrderKeys(entities);
  const references = new Map<string, ReferenceConstructionDefinition>();
  const resolvedSources = new Set<string>();
  for (const entity of entities) {
    const data = validateReferenceEntity(entity);
    if (!data) continue;
    const definition = data.definition;
    if (
      (definition.mode === "coordinates" || definition.mode === "endpoints") &&
      definition.sources.length === 0
    ) {
      references.set(entity.id, definition);
      continue;
    }
    assertBindings(byId, definition);
    for (const source of definition.sources)
      if (
        !resolvedSources.has(
          `${definition.kind}:${definition.mode}:${source.id}`,
        )
      ) {
        if (definition.kind === "point")
          resolveReferencePointSource(byId.get(source.id)!);
        else if (definition.mode !== "endpoints")
          resolveReferenceLineSource(byId.get(source.id)!, definition.mode);
        resolvedSources.add(
          `${definition.kind}:${definition.mode}:${source.id}`,
        );
      }
    references.set(entity.id, definition);
  }
  // Iterative Kahn traversal avoids recursive import stack growth.
  const counts = new Map<string, number>(),
    reverse = new Map<string, string[]>();
  for (const [id, definition] of references) {
    const parents = definition.sources.filter((source) =>
      references.has(source.id),
    );
    counts.set(id, parents.length);
    for (const source of parents) {
      const children = reverse.get(source.id) ?? [];
      children.push(id);
      reverse.set(source.id, children);
    }
  }
  const ready = [...counts]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  for (let index = 0; index < ready.length; index++)
    for (const child of reverse.get(ready[index]) ?? []) {
      counts.set(child, counts.get(child)! - 1);
      if (counts.get(child) === 0) ready.push(child);
    }
  if (ready.length !== references.size)
    throw new Error("Reference dependencies contain a cycle.");
}

export interface ReferenceConstructionRefreshOptions {
  check?: () => void;
  resolveInputs?: (
    stagedScene: readonly Entity[],
    definition: ReferenceConstructionDefinition,
  ) => ResolvedReferenceConstructionInputs;
}

/** Atomically stage the affected closure; retained records and live entities stay untouched. */
export function refreshReferenceConstructions(
  entities: Entity[],
  changedIds: readonly string[],
  options: ReferenceConstructionRefreshOptions = {},
) {
  const check = options.check ?? (() => {}),
    resolve = options.resolveInputs ?? resolveStoredReferenceConstructionInputs;
  check();
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  if (byId.size !== entities.length)
    throw new Error("Duplicate reference scene identity.");
  const roots = new Set(changedIds);
  validateConstructionOrderKeys(entities);
  for (const id of roots)
    if (!byId.has(id)) throw new Error("Reference refresh root is missing.");
  const graph = datumEntityDependencies(entities),
    reverse = new Map<string, string[]>();
  for (const row of graph)
    for (const source of new Set(row.references)) {
      const children = reverse.get(source) ?? [];
      children.push(row.id);
      reverse.set(source, children);
    }
  const affected = new Set(roots),
    pending = [...roots];
  for (let index = 0; index < pending.length; index++) {
    check();
    for (const id of reverse.get(pending[index]) ?? [])
      if (!affected.has(id)) {
        affected.add(id);
        pending.push(id);
      }
  }
  // Even an isolated root must not carry a broken source identity.
  for (const id of roots) {
    const data = validateReferenceEntity(byId.get(id)!);
    if (data) assertBindings(byId, data.definition);
  }
  const evaluations: {
    entityId: string;
    outcome: ReferenceConstructionEvaluation["outcome"];
    diagnostics: ReferenceConstructionEvaluation["diagnostics"];
  }[] = [];
  const refreshedEntityIds: string[] = [];
  const hasDependents = pending.some((id) => !roots.has(id));
  if (hasDependents && entities.length > REFERENCE_CONSTRUCTION_SCENE_LIMIT)
    throw new Error("Reference construction scene limit exceeded.");
  let work =
    entities.length +
    graph.reduce((sum, row) => sum + row.references.length, 0);
  const charge = (amount = 1) => {
    check();
    work += amount;
    if (work > REFERENCE_CONSTRUCTION_WORK_LIMIT)
      throw new Error("Reference construction refresh work limit exceeded.");
  };
  if (hasDependents) charge(0);
  const counts = new Map(
    graph
      .filter((row) => affected.has(row.id))
      .map((row) => [
        row.id,
        new Set(row.references.filter((id) => affected.has(id))).size,
      ]),
  );
  const ready = graph
    .filter((row) => affected.has(row.id) && counts.get(row.id) === 0)
    .map((row) => row.id);
  for (let index = 0; index < ready.length; index++) {
    if (hasDependents) charge();
    else check();
    const id = ready[index],
      child = byId.get(id)!;
    if (!roots.has(id)) {
      if (child.locked)
        throw new Error("A dependent reference is locked: " + id);
      const data = validateReferenceEntity(child);
      if (!data)
        throw new Error(
          "Reference dependency rebuild is required for unsupported dependent: " +
            id,
        );
      assertBindings(byId, data.definition);
      if (
        data.definition.kind === "line" &&
        data.definition.mode !== "endpoints" &&
        data.definition.records.length >
          REFERENCE_CONSTRUCTION_LINE_RECORD_LIMIT
      )
        throw new Error(
          "Reference construction line record refresh limit exceeded.",
        );
      charge(
        entities.length * 6 +
          (data.definition.kind === "line"
            ? data.definition.records.length
            : data.definition.sources.length),
      );
      const result = evaluateReferenceConstruction(
        data.definition,
        resolve([...byId.values()], data.definition),
        { geometry: data.geometry, state: { completionWord: 1 } },
      );
      referenceGeometrySceneBounds(result.geometry);
      byId.set(id, {
        ...child,
        reference: copyReferenceEntityData({
          ...data,
          geometry: result.geometry,
          evaluation: result.state,
        }),
      });
      refreshedEntityIds.push(id);
      evaluations.push({
        entityId: id,
        outcome: result.outcome,
        diagnostics: result.diagnostics,
      });
    }
    for (const childId of reverse.get(id) ?? [])
      if (affected.has(childId)) {
        counts.set(childId, counts.get(childId)! - 1);
        if (counts.get(childId) === 0) ready.push(childId);
      }
  }
  if (ready.length !== affected.size)
    throw new Error("Reference dependencies contain a cycle.");
  check();
  return {
    entities: refreshedEntityIds.length
      ? entities.map((entity) => byId.get(entity.id)!)
      : entities,
    refreshedEntityIds,
    evaluations,
  };
}

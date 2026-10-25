import type { Entity } from "./types";
import {
  copyReferenceEntityData,
  validateReferenceEntity,
} from "./reference-entity";
import { resolveConstructionIdentities } from "./reference-construction-identity";
import { resolveStoredReferenceConstructionInputs } from "./reference-construction-resolver";
import {
  evaluateReferenceConstruction,
  type ReferenceConstructionState,
} from "./reference-construction-evaluation";
import type { ReferenceConstructionDefinition } from "./reference-construction";
import { referenceGeometrySceneBounds } from "./reference-scene-bounds";
import { datumEntityDependencies } from "./datum-dependencies";

/** Application work admission, not a native object-count limit. */
export const REFERENCE_MIDPOINT_LIMIT = 10000;
export const REFERENCE_MIDPOINT_WORK_LIMIT = 2000000;

/** Recovered raw constructor storage; never itself a public preview/Apply result. */
export function createReferencePointSeed(): ReferenceConstructionState {
  return {
    geometry: { kind: "point", position: [3.4028234663852886e38, 0, 0] },
    state: { completionWord: 0x100 },
  };
}

export function isStoredReferenceLine(entity: Entity): boolean {
  try {
    const data = validateReferenceEntity(entity);
    return (
      entity.kind === "referenceLine" &&
      data?.definition.kind === "line" &&
      data.definition.mode === "endpoints" &&
      data.definition.sources.length === 0
    );
  } catch {
    return false;
  }
}

export function referenceMidpointDefinition(
  entities: readonly Entity[],
  sourceId: string,
): ReferenceConstructionDefinition {
  if (entities.length > REFERENCE_MIDPOINT_LIMIT)
    throw new Error("Reference midpoint scene limit exceeded.");
  const identities = resolveConstructionIdentities(entities, [sourceId]);
  const source = entities.find((entity) => entity.id === sourceId);
  if (
    !source ||
    !isStoredReferenceLine(source) ||
    identities.assignments.length
  )
    throw new Error(
      "Midpoint requires an existing semantic stored endpoints line with a saved identity.",
    );
  return {
    version: 1,
    kind: "point",
    mode: "center",
    sources: identities.orderedSources,
  };
}

export function validateReferenceMidpoint(
  entities: readonly Entity[],
  definition: ReferenceConstructionDefinition,
  eligibleSources?: ReadonlyMap<string, Entity>,
): void {
  if (
    definition.kind !== "point" ||
    definition.mode !== "center" ||
    definition.sources.length !== 1
  )
    throw new Error(
      "Derived reference acceptance requires source-specific finalization.",
    );
  const sourceId = definition.sources[0].id;
  const matches = eligibleSources
    ? undefined
    : entities.filter((entity) => entity.id === sourceId);
  const source = eligibleSources
    ? eligibleSources.get(sourceId)
    : matches?.length === 1
      ? matches[0]
      : undefined;
  if (!source || (!eligibleSources && !isStoredReferenceLine(source)))
    throw new Error(
      "Midpoint requires an existing semantic stored endpoints line with a saved identity.",
    );
  if (
    source.constructionOrderKey !== definition.sources[0].constructionOrderKey
  )
    throw new Error("Reference midpoint source identity binding changed.");
}

export function evaluateReferenceMidpoint(
  entities: readonly Entity[],
  definition: ReferenceConstructionDefinition,
  prior: ReferenceConstructionState,
) {
  validateReferenceMidpoint(entities, definition);
  const result = evaluateReferenceConstruction(
    definition,
    resolveStoredReferenceConstructionInputs(entities, definition),
    prior,
  );
  if (result.outcome !== "updated" || result.diagnostics.reason !== "center")
    throw new Error("Reference midpoint did not evaluate successfully.");
  referenceGeometrySceneBounds(result.geometry);
  return result;
}

/** Stage affected children in dependency order; live entities are never mutated. */
export function refreshReferenceMidpoints(
  entities: Entity[],
  rootId: string,
  check: () => void = () => {},
) {
  check();
  let work = 0;
  const charge = (amount = 1) => {
    check();
    work += amount;
    if (work > REFERENCE_MIDPOINT_WORK_LIMIT)
      throw new Error("Reference midpoint refresh work limit exceeded.");
  };
  const graph = datumEntityDependencies(entities);
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  if (byId.size !== entities.length)
    throw new Error("Duplicate reference scene identity.");
  if (!byId.has(rootId)) throw new Error("Reference refresh root is missing.");
  const reverse = new Map<string, string[]>();
  for (const row of graph)
    for (const sourceId of row.references) {
      const children = reverse.get(sourceId) ?? [];
      children.push(row.id);
      reverse.set(sourceId, children);
    }
  const affected = new Set([rootId]);
  const pending = [rootId];
  for (let index = 0; index < pending.length; index++) {
    check();
    for (const id of reverse.get(pending[index]) ?? [])
      if (!affected.has(id)) {
        affected.add(id);
        pending.push(id);
      }
  }
  if (affected.size === 1 && !(reverse.get(rootId) ?? []).includes(rootId))
    return { entities, refreshedEntityIds: [] as string[] };
  if (entities.length > REFERENCE_MIDPOINT_LIMIT)
    throw new Error("Reference midpoint scene limit exceeded.");
  charge(
    entities.length +
      graph.reduce((count, row) => count + row.references.length, 0),
  );
  const counts = new Map(
    graph
      .filter((row) => affected.has(row.id))
      .map((row) => [
        row.id,
        row.references.filter((id) => affected.has(id)).length,
      ]),
  );
  const ready = graph
    .filter((row) => affected.has(row.id) && counts.get(row.id) === 0)
    .map((row) => row.id);
  const refreshedEntityIds: string[] = [];
  for (let index = 0; index < ready.length; index++) {
    charge();
    const id = ready[index];
    const child = byId.get(id)!;
    if (id !== rootId) {
      if (child.locked)
        throw new Error("A dependent reference is locked: " + id);
      const data = validateReferenceEntity(child);
      if (!data)
        throw new Error(
          "Reference dependency rebuild is required for unsupported dependent: " +
            id,
        );
      charge(entities.length * 6);
      const refreshed = evaluateReferenceMidpoint(
        [...byId.values()],
        data.definition,
        { geometry: data.geometry, state: { completionWord: 1 } },
      );
      byId.set(id, {
        ...child,
        reference: copyReferenceEntityData({
          ...data,
          geometry: refreshed.geometry,
          evaluation: refreshed.state,
        }),
      });
      refreshedEntityIds.push(id);
    }
    for (const dependent of reverse.get(id) ?? [])
      if (affected.has(dependent)) {
        counts.set(dependent, counts.get(dependent)! - 1);
        if (counts.get(dependent) === 0) ready.push(dependent);
      }
  }
  if (ready.length !== affected.size)
    throw new Error("Reference dependencies contain a cycle.");
  return {
    entities: entities.map((entity) => byId.get(entity.id)!),
    refreshedEntityIds,
  };
}

/** Explicit semantic-link deletion guard, independent of the geometry tool gate. */
export function referenceDeletionDependents(
  entities: readonly Entity[],
  ids: readonly string[],
): string[] {
  const removed = new Set(ids);
  return entities
    .filter(
      (entity) =>
        !removed.has(entity.id) &&
        validateReferenceEntity(entity)?.definition.sources.some((source) =>
          removed.has(source.id),
        ),
    )
    .map((entity) => entity.id);
}

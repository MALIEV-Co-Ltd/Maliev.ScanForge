import type { Entity } from "./types";
import { validateReferenceEntity } from "./reference-entity";
import { resolveConstructionIdentities } from "./reference-construction-identity";
import { resolveStoredReferenceConstructionInputs } from "./reference-construction-resolver";
import {
  evaluateReferenceConstruction,
  type ReferenceConstructionState,
} from "./reference-construction-evaluation";
import type { ReferenceConstructionDefinition } from "./reference-construction";
import { referenceGeometrySceneBounds } from "./reference-scene-bounds";
import { refreshReferenceConstructions } from "./reference-construction-lifecycle";

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
  const result = refreshReferenceConstructions(entities, [rootId], { check });
  return {
    entities: result.entities,
    refreshedEntityIds: result.refreshedEntityIds,
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

import type { Entity } from "./types";
import { resolveConstructionIdentities } from "./reference-construction-identity";
import { isReferenceEntity } from "./reference-entity";
import type { ConstructionIdentityAssignment } from "./reference-construction-identity";

/** Trusted commit metadata, never a caller-editable transport field. */
export interface ModelCommitPolicy {
  /** Shared modeling publication may hide inputs atomically with its geometry edit. */
  readonly modelVisibilityFor?: readonly string[];
  /** Trusted noise preview: same facet IDs, selection follows the new coordinates. */
  readonly preserveFacetSelectionFor?: string;
  readonly constructionIdentityMigration?: readonly ConstructionIdentityAssignment[];
  /** New saved sketches published atomically with their owning model operation. */
  readonly newModelSketches?: readonly import("./types").SavedSketch[];
}

function migratedSourceIds(
  before: Entity[],
  after: Entity[],
  policy?: ModelCommitPolicy,
): Set<string> {
  const supplied = policy?.constructionIdentityMigration;
  if (supplied === undefined) return new Set();
  if (!Array.isArray(supplied))
    throw new Error("Invalid construction identity migration.");
  const ids = new Set<string>();
  for (const assignment of supplied) {
    if (
      !assignment ||
      typeof assignment.id !== "string" ||
      typeof assignment.constructionOrderKey !== "string" ||
      Object.keys(assignment).length !== 2 ||
      ids.has(assignment.id)
    )
      throw new Error("Invalid or duplicate construction identity migration.");
    ids.add(assignment.id);
  }
  const expected = new Map(
    resolveConstructionIdentities(before, [...ids]).assignments.map((row) => [
      row.id,
      row.constructionOrderKey,
    ]),
  );
  resolveConstructionIdentities(after, []);
  for (const assignment of supplied) {
    const old = before.find((row) => row.id === assignment.id),
      next = after.find((row) => row.id === assignment.id);
    if (
      !old ||
      !next ||
      old.constructionOrderKey !== undefined ||
      expected.get(assignment.id) !== assignment.constructionOrderKey ||
      next.constructionOrderKey !== assignment.constructionOrderKey
    )
      throw new Error(
        "Construction identity migration must add the deterministic missing source key.",
      );
    const oldKeys = Reflect.ownKeys(old).filter(
      (key) => key !== "constructionOrderKey",
    );
    const nextKeys = Reflect.ownKeys(next).filter(
      (key) => key !== "constructionOrderKey",
    );
    if (
      oldKeys.length !== nextKeys.length ||
      oldKeys.some(
        (key) =>
          !nextKeys.includes(key) ||
          !Object.is(Reflect.get(old, key), Reflect.get(next, key)),
      )
    )
      throw new Error(
        "Construction identity migration may change only the source key.",
      );
  }
  for (const old of before) {
    const next = after.find((row) => row.id === old.id);
    if (
      next &&
      old.constructionOrderKey !== next.constructionOrderKey &&
      !ids.has(old.id)
    )
      throw new Error(
        "Construction identity migration cannot replace another object key.",
      );
  }
  return ids;
}

/** Flip each target once, retaining geometry, selection and unselected identities. */
export function toggleObjectVisibility(
  entities: Entity[],
  entityIds: readonly string[],
): Entity[] {
  const ids = new Set(entityIds);
  if (!ids.size)
    throw new Error("Select at least one object to toggle visibility.");
  for (const id of ids)
    if (!entities.some((entity) => entity.id === id))
      throw new Error(`Object does not exist: ${id}`);
  return entities.map((entity) =>
    ids.has(entity.id) ? { ...entity, visible: !entity.visible } : entity,
  );
}

export function objectPickable(
  entity: Pick<Entity, "locked" | "selectable">,
): boolean {
  return !entity.locked && entity.selectable !== false;
}

/** Copy geometry and metadata without duplicating a parametric feature identity. */
export function duplicateObject(
  source: Entity,
  id: string,
  entities: Entity[],
): Entity {
  if (isReferenceEntity(source))
    throw new Error("Reference construction duplication is not yet supported.");
  const constructionOrderKey =
    source.constructionOrderKey === undefined
      ? undefined
      : resolveConstructionIdentities(
          [
            ...entities,
            ...(entities.some((entity) => entity.id === source.id)
              ? []
              : [source]),
            { id },
          ],
          [id],
        ).orderedSources[0].constructionOrderKey;
  let name = `${source.name} copy`;
  for (let index = 2; entities.some((entity) => entity.name === name); index++)
    name = `${source.name} copy ${index}`;
  return {
    ...structuredClone(source),
    id,
    name,
    visible: true,
    locked: false,
    selectable: true,
    parametric: undefined,
    ...(constructionOrderKey !== undefined ? { constructionOrderKey } : {}),
  };
}

/** Display and protection controls remain available on locked geometry. */
export function lockedObjectEdit(
  before: Entity[],
  after: Entity[],
  policy?: ModelCommitPolicy,
): Entity | undefined {
  const migrations = migratedSourceIds(before, after, policy);
  const editable = new Set([
    "name",
    "color",
    "opacity",
    "visible",
    "locked",
    "selectable",
  ]);
  return before.find((old) => {
    if (!old.locked) return false;
    const next = after.find((entity) => entity.id === old.id);
    return (
      !next ||
      Object.keys({ ...old, ...next }).some(
        (key) =>
          !editable.has(key) &&
          !(key === "constructionOrderKey" && migrations.has(old.id)) &&
          old[key as keyof Entity] !== next[key as keyof Entity],
      )
    );
  });
}

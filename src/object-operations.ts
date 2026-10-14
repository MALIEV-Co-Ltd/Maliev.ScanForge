import type { Entity } from "./types";

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
  };
}

/** Display and protection controls remain available on locked geometry. */
export function lockedObjectEdit(
  before: Entity[],
  after: Entity[],
): Entity | undefined {
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
          old[key as keyof Entity] !== next[key as keyof Entity],
      )
    );
  });
}

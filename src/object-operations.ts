import type { Entity } from "./types";

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

import type { Entity } from "./types";

/** Atomic naming in Objects-panel order; geometry and selection stay unchanged. */
export function renameObjects(
  entities: Entity[],
  ids: readonly string[],
  value: string,
): Entity[] {
  const name = value.trim();
  if (!name || name.length > 200)
    throw new Error("Enter an object name of 1–200 characters.");
  const targets = new Set(ids);
  if (!targets.size) throw new Error("Select an object to rename.");
  if (
    targets.size !== ids.length ||
    ids.some((id) => !entities.some((e) => e.id === id))
  )
    throw new Error("Choose distinct existing objects to rename.");
  let index = 0;
  return entities.map((entity) => {
    if (!targets.has(entity.id)) return entity;
    const next = targets.size > 1 ? `${name} - ${++index}` : name;
    if (next.length > 200)
      throw new Error("Numbered object names must fit within 200 characters.");
    return { ...entity, name: next };
  });
}

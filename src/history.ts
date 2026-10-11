import type { Entity } from "./types";
export interface Revision {
  entities: Entity[];
  label: string;
}
export function changeLabel(before: Entity[], after: Entity[]): string {
  const added = after.filter(
    (entity) => !before.some((old) => old.id === entity.id),
  );
  if (added.length)
    return `Create ${added.map((entity) => entity.name).join(", ")}`;
  const removed = before.filter(
    (entity) => !after.some((next) => next.id === entity.id),
  );
  if (removed.length)
    return `Delete ${removed.map((entity) => entity.name).join(", ")}`;
  for (const next of after) {
    const old = before.find((entity) => entity.id === next.id);
    if (!old) continue;
    if (old.positions !== next.positions) return `Modify ${next.name}`;
    if (old.visible !== next.visible)
      return `${next.visible ? "Show" : "Hide"} ${next.name}`;
    if (old.name !== next.name) return `Rename ${old.name}`;
    if (old.color !== next.color || old.opacity !== next.opacity)
      return `Display ${next.name}`;
  }
  return "Update model";
}

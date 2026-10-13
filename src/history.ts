import type { Entity } from "./types";
export interface Revision {
  entities: Entity[];
  label: string;
}
/** Seek atomically across both undo and redo snapshots, without replaying edits. */
export function seekModelRevision(
  history: Revision[],
  entities: Entity[],
  future: Revision[],
  index: number,
): { history: Revision[]; entities: Entity[]; future: Revision[] } {
  const count = history.length + future.length;
  if (!Number.isInteger(index) || index < 0 || index > count)
    throw new RangeError("Model revision is outside the retained timeline");
  if (index === history.length) return { history, entities, future };
  const labels = [...history, ...future].map((revision) => revision.label);
  const states = [
    ...history.map((revision) => revision.entities),
    entities,
    ...future.map((revision) => revision.entities),
  ];
  return {
    history: labels
      .slice(0, index)
      .map((label, i) => ({ label, entities: states[i] })),
    entities: restoreModelDisplay(states[index], entities),
    future: labels
      .slice(index)
      .map((label, i) => ({ label, entities: states[index + i + 1] })),
  };
}
/** Display and selection authoring changes never enter the modeling timeline. */
export function modelChanged(before: Entity[], after: Entity[]): boolean {
  if (before.length !== after.length) return true;
  return after.some((next) => {
    const old = before.find((e) => e.id === next.id);
    return (
      !old ||
      old.kind !== next.kind ||
      old.positions !== next.positions ||
      old.kernelId !== next.kernelId ||
      old.brep !== next.brep ||
      old.surfacePatch !== next.surfacePatch ||
      old.parametric !== next.parametric
    );
  });
}
export function restoreModelDisplay(
  target: Entity[],
  current: Entity[],
): Entity[] {
  return target.map((entity) => {
    const live = current.find((e) => e.id === entity.id);
    if (!live) return entity;
    return {
      ...entity,
      name: live.name,
      color: live.color,
      opacity: live.opacity,
      visible: live.visible,
      selectable: live.selectable,
      locked: live.locked,
      meshSelection:
        entity.positions === live.positions
          ? live.meshSelection
          : entity.meshSelection,
    };
  });
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

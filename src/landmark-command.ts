import type { Entity } from "./types";

/** Original 0x1407d68a0 policy; flags 2 and 1 are preferred and selected. */
export function nativeLandmarkSourceIndex(
  objects: readonly { scan: boolean; flags: number }[],
) {
  let count = 0,
    selectedCount = 0;
  let last: number | null = null,
    selected: number | null = null;
  for (let index = 0; index < objects.length; index++) {
    const object = objects[index];
    if (!object.scan) continue;
    if (object.flags & 2) return index;
    count++;
    last = index;
    if (object.flags & 1) {
      selectedCount++;
      selected = index;
    }
  }
  return selectedCount === 1 ? selected : count === 1 ? last : null;
}

/** Shared command adapter. Cloud support and editor guards are application policy. */
export function landmarkCommandSource(
  scene: readonly Entity[],
  activeId: string | null,
  selectedIds: readonly string[],
) {
  const selected = new Set(selectedIds);
  const index = nativeLandmarkSourceIndex(
    scene.map((entity) => ({
      scan:
        (entity.kind === "mesh" || entity.kind === "pointcloud") &&
        !entity.kernelId &&
        !entity.parametric &&
        !entity.surfacePatch &&
        !entity.locked &&
        entity.visible &&
        entity.selectable !== false &&
        entity.positions.length >= 3,
      flags:
        (entity.id === activeId ? 2 : 0) | (selected.has(entity.id) ? 1 : 0),
    })),
  );
  return index === null ? undefined : scene[index];
}

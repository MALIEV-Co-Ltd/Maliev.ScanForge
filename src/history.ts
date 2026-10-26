import type { Entity, Project } from "./types";
import {
  applyModelSketchChanges,
  captureModelSketchChanges,
  type ModelSketchChange,
} from "./model-sketch-history";
import { canonicalCloud, cloudPlacement } from "./point-cloud-placement";
import { indexedMeshMatches } from "./indexed-mesh";
import { meshGeometryNormals, meshFacetNormals } from "./mesh-geometry-normals";
export interface Revision {
  entities: Entity[];
  label: string;
  /** Visibility changed by the modeling operation itself, rather than a display toggle. */
  restoreVisibilityFor?: string[];
  sketchChanges?: ModelSketchChange[];
}
/** Seek atomically across both undo and redo snapshots, without replaying edits. */
export function seekModelRevision(
  history: Revision[],
  entities: Entity[],
  future: Revision[],
  index: number,
  authoring?: NonNullable<Project["authoring"]>,
): {
  history: Revision[];
  entities: Entity[];
  future: Revision[];
  authoring?: NonNullable<Project["authoring"]>;
} {
  const count = history.length + future.length;
  if (!Number.isInteger(index) || index < 0 || index > count)
    throw new RangeError("Model revision is outside the retained timeline");
  if (index === history.length)
    return { history, entities, future, ...(authoring ? { authoring } : {}) };
  const revisions = [...history, ...future];
  const crossed = revisions.slice(
    Math.min(index, history.length),
    Math.max(index, history.length),
  );
  if (!authoring && crossed.some((row) => row.sketchChanges?.length))
    throw Error(
      "Saved sketch authoring is required to traverse this model revision.",
    );
  if (authoring) {
    const direction = index < history.length ? -1 : 1;
    for (
      let i = direction < 0 ? history.length - 1 : history.length;
      direction < 0 ? i >= index : i < index;
      i += direction
    ) {
      const revision = revisions[i];
      if (!revision.sketchChanges?.length) continue;
      const reverse = captureModelSketchChanges(
        authoring,
        revision.sketchChanges,
      );
      authoring = applyModelSketchChanges(authoring, revision.sketchChanges);
      revisions[i] = { ...revision, sketchChanges: reverse };
    }
  }
  const visibility = new Set(
    revisions
      .slice(Math.min(index, history.length), Math.max(index, history.length))
      .flatMap((r) => r.restoreVisibilityFor ?? []),
  );
  const states = [
    ...history.map((revision) => revision.entities),
    entities,
    ...future.map((revision) => revision.entities),
  ];
  return {
    ...(authoring ? { authoring } : {}),
    history: revisions
      .slice(0, index)
      .map((revision, i) => ({ ...revision, entities: states[i] })),
    entities: restoreModelDisplay(states[index], entities, visibility),
    future: revisions
      .slice(index)
      .map((revision, i) => ({ ...revision, entities: states[index + i + 1] })),
  };
}
/** Ordinary display and selection changes do not enter the modeling timeline. */
export function modelChanged(before: Entity[], after: Entity[]): boolean {
  if (before.length !== after.length) return true;
  return after.some((next) => {
    const old = before.find((e) => e.id === next.id);
    return (
      !old ||
      old.kind !== next.kind ||
      old.constructionOrderKey !== next.constructionOrderKey ||
      old.reference !== next.reference ||
      old.coordinateFrame !== next.coordinateFrame ||
      old.rollMapping !== next.rollMapping ||
      cloudPlacement(old)?.matrixBits !== cloudPlacement(next)?.matrixBits ||
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
  restoreVisibilityFor: ReadonlySet<string> = new Set(),
): Entity[] {
  return target.map((entity) => {
    // Legacy history is initialized only when activated. Preserve the retained
    // snapshot and borrow its geometry; subsequent history steps retain this field.
    if (
      entity.kind === "mesh" &&
      !entity.kernelId &&
      entity.indexedMesh &&
      (!(entity.indexedMesh.geometryNormals instanceof Float32Array) ||
        !(entity.indexedMesh.facetNormals instanceof Float32Array)) &&
      indexedMeshMatches(entity.indexedMesh, entity.positions)
    )
      entity = {
        ...entity,
        indexedMesh: {
          ...entity.indexedMesh,
          geometryNormals: meshGeometryNormals(entity.indexedMesh),
          facetNormals: meshFacetNormals(entity.indexedMesh),
        },
      };
    const live = current.find((e) => e.id === entity.id);
    if (!live) return entity;
    return canonicalCloud({
      ...entity,
      name: live.name,
      color: live.color,
      pointSize: live.pointSize,
      pointAutoDensity: live.pointAutoDensity,
      pointDensity: live.pointDensity,
      pointColorMode: live.pointColorMode,
      opacity: live.opacity,
      visible: restoreVisibilityFor.has(entity.id)
        ? entity.visible
        : live.visible,
      selectable: live.selectable,
      locked: live.locked,
      meshSelection:
        entity.positions === live.positions
          ? live.meshSelection
          : entity.meshSelection,
    });
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
    if (
      old.positions !== next.positions ||
      old.reference !== next.reference ||
      old.coordinateFrame !== next.coordinateFrame ||
      old.rollMapping !== next.rollMapping ||
      old.constructionOrderKey !== next.constructionOrderKey
    )
      return `Modify ${next.name}`;
    if (old.visible !== next.visible)
      return `${next.visible ? "Show" : "Hide"} ${next.name}`;
    if (old.name !== next.name) return `Rename ${old.name}`;
    if (
      old.color !== next.color ||
      old.opacity !== next.opacity ||
      old.pointSize !== next.pointSize ||
      old.pointAutoDensity !== next.pointAutoDensity ||
      old.pointDensity !== next.pointDensity ||
      old.pointColorMode !== next.pointColorMode
    )
      return `Display ${next.name}`;
  }
  return "Update model";
}

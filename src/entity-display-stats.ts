import type { Entity, MeshStats, Vec3 } from "./types";
import { referenceEntitySummary } from "./reference-entity";
import { referenceFrameSummary } from "./reference-frame";
import { displayMeshStats } from "./scan-render-data";
import { pointCloudStats } from "./point-cloud";

export type EntityDisplayStats =
  | ({ kind: "mesh" | "pointcloud" } & MeshStats)
  | {
      kind: "reference";
      points: number;
      lines: number;
      triangles: 0;
      min: Vec3;
      max: Vec3;
      size: Vec3;
      center: Vec3;
    };

/** Semantic summaries never enter triangle statistics or their position cache. */
export function entityDisplayStats(entity: Entity): EntityDisplayStats {
  const semantic =
    referenceFrameSummary(entity) ?? referenceEntitySummary(entity);
  if (semantic) {
    const min: Vec3 = [...semantic.bounds.min],
      max: Vec3 = [...semantic.bounds.max];
    return {
      kind: "reference",
      points: semantic.points,
      lines: semantic.lines,
      triangles: 0,
      min,
      max,
      size: min.map((value, axis) => max[axis] - value) as Vec3,
      center: min.map((value, axis) =>
        value === max[axis] ? value : value * 0.5 + max[axis] * 0.5,
      ) as Vec3,
    };
  }
  return entity.kind === "pointcloud"
    ? { kind: "pointcloud", ...pointCloudStats(entity.positions) }
    : { kind: "mesh", ...displayMeshStats(entity.positions) };
}

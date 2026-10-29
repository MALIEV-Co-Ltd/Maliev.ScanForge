import type { Entity } from "./types";
import type { ScanEditRequest } from "./scan-edit";
import { supportsSampledGeometry } from "./reference-entity";
import { validatePlaneFrame } from "./plane-frame";

export function isScanSplitCutter(entity: Entity): boolean {
  return (
    entity.kind !== "pointcloud" &&
    supportsSampledGeometry(entity) &&
    entity.positions.length >= 9 &&
    entity.positions.length % 9 === 0
  );
}

/** Reference planes are infinite; ordinary surface meshes retain their bounds. */
export function scanSplitCutter(
  entity: Entity,
): Pick<ScanEditRequest, "plane" | "target" | "targetIsNonMesh"> {
  if (!isScanSplitCutter(entity))
    throw Error(
      "Choose a triangle mesh, surface or reference plane as the split cutter.",
    );
  if (entity.kind === "plane") {
    if (entity.planeFrame) {
      validatePlaneFrame(entity.planeFrame, entity.positions, entity.kind);
      return {
        plane: {
          origin: [...entity.planeFrame.center],
          normal: [...entity.planeFrame.normal],
        },
      };
    }
    if (entity.fit?.kind === "plane")
      return {
        plane: { origin: [...entity.fit.center], normal: [...entity.fit.axis] },
      };
  }
  return {
    target: entity.positions,
    targetIsNonMesh: entity.kind !== "mesh" || !!entity.kernelId,
  };
}

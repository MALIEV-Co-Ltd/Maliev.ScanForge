import type { Entity, Vec3 } from "./types";
import type { ProcessingResult } from "./processing-client";
import { transformPoint } from "./registration";
import { rotatePointNormals } from "./point-cloud";
import { indexedRenderNormals } from "./indexed-mesh";

export interface LandmarkAlignment {
  moving: Entity;
  fixed: Entity;
  picks: { entityId: string; point: Vec3 }[];
  preview?: ProcessingResult;
}
export function beginLandmarkAlignment(
  moving: Entity,
  fixed: Entity,
): LandmarkAlignment {
  if (
    moving.id === fixed.id ||
    (moving.kind !== "mesh" && moving.kind !== "pointcloud") ||
    moving.kernelId ||
    moving.parametric ||
    moving.surfacePatch
  )
    throw new Error("Choose a moving scan and a different fixed object.");
  return { moving, fixed, picks: [] };
}
export function pickLandmark(
  session: LandmarkAlignment,
  entityId: string,
  point: Vec3,
): LandmarkAlignment {
  if (entityId !== session.moving.id && entityId !== session.fixed.id)
    throw new Error("Pick a point on the moving scan or the fixed target.");
  if (point.length !== 3 || !point.every(Number.isFinite))
    throw new Error("Landmarks must contain finite world coordinates.");
  return {
    ...session,
    preview: undefined,
    picks: [...session.picks, { entityId, point: [...point] }],
  };
}
export function landmarkPairs(session: LandmarkAlignment) {
  return {
    moving: session.picks
      .filter((p) => p.entityId === session.moving.id)
      .map((p) => p.point),
    fixed: session.picks
      .filter((p) => p.entityId === session.fixed.id)
      .map((p) => p.point),
  };
}
export function landmarkRequest(session: LandmarkAlignment) {
  const pairs = landmarkPairs(session);
  if (pairs.moving.length < 3 || pairs.moving.length !== pairs.fixed.length)
    throw new Error(
      "Pick at least three corresponding points on each object in the same order.",
    );
  return {
    kind: "paired" as const,
    positions: session.moving.positions,
    sourceIndexed:
      session.moving.kind === "mesh" ? session.moving.indexedMesh : undefined,
    sourceLandmarks: pairs.moving.flat(),
    targetLandmarks: pairs.fixed.flat(),
  };
}
export function landmarkSceneUnchanged(
  session: LandmarkAlignment,
  entities: Entity[],
) {
  return (
    entities.find((e) => e.id === session.moving.id)?.positions ===
      session.moving.positions &&
    entities.find((e) => e.id === session.fixed.id)?.positions ===
      session.fixed.positions
  );
}
export function acceptLandmarkAlignment(
  session: LandmarkAlignment,
  entities: Entity[],
): Entity[] {
  if (
    !session.preview?.positions ||
    !session.preview.registration ||
    !landmarkSceneUnchanged(session, entities)
  )
    throw new Error(
      "Preview alignment again before accepting; the scene or landmarks changed.",
    );
  if (session.preview.positions.length !== session.moving.positions.length)
    throw new Error("Alignment preview does not match the moving scan.");
  return entities.map((e) =>
    e.id === session.moving.id
      ? {
          ...e,
          positions: session.preview!.positions!,
          indexedMesh: session.preview!.indexedMesh,
          normals: session.preview!.indexedMesh?.normals
            ? indexedRenderNormals(session.preview!.indexedMesh)
            : e.normals
              ? rotatePointNormals(
                  e.normals,
                  session.preview!.registration!.transform.rotation,
                )
              : undefined,
          fit: undefined,
        }
      : e,
  );
}
export function landmarkMarkers(session: LandmarkAlignment) {
  let moving = 0,
    fixed = 0;
  return session.picks.map((p) => ({
    point:
      p.entityId === session.moving.id && session.preview?.registration
        ? transformPoint(p.point, session.preview.registration.transform)
        : p.point,
    label: p.entityId === session.moving.id ? `M${++moving}` : `F${++fixed}`,
  }));
}

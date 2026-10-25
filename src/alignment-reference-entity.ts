import type { Entity } from "./types";
import { isReferenceEntity, validateReferenceEntity } from "./reference-entity";
import type { NativeDatumFeatureGeometry } from "./scan-native-datum-feature";
import { validateReferenceFrameEntity } from "./reference-frame";
import { validatePlaneFrame } from "./plane-frame";
import { nativeDatumPlaneGeometry } from "./scan-native-datum-apply";

/** Discovery eligibility is independent of permission to move the source. */
export function hasAlignmentReferences(entity: Entity): boolean {
  return !!(
    entity.kernelId ||
    entity.fit ||
    isReferenceEntity(entity) ||
    entity.kind === "referenceFrame" ||
    (entity.kind === "plane" && entity.planeFrame)
  );
}

export interface StoredDatumReference {
  key: string;
  label: string;
  kind: "point" | "direction" | "plane";
  point: number[];
  direction?: number[];
  surfaceKind: "coordinateFrame" | "constructionPlane";
}

/** Stored frame axes are anchored at their origin, independent of display extent. */
export function storedFrameDatumReferences(
  entity: Entity,
  centerAt?: readonly number[],
): StoredDatumReference[] {
  const plane = (center: readonly number[], normal: readonly number[]) => {
    const value = nativeDatumPlaneGeometry(
      center,
      normal,
      -(normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2]),
      centerAt,
    );
    return { point: value.point, direction: value.normal };
  };
  if (entity.kind === "referenceFrame") {
    const { frame } = validateReferenceFrameEntity(entity)!;
    const result: StoredDatumReference[] = [
      {
        key: "frame/origin",
        label: "Origin",
        kind: "point",
        point: [...frame.origin],
        surfaceKind: "coordinateFrame",
      },
    ];
    for (const [name, direction] of [
      ["X", frame.u],
      ["Y", frame.v],
      ["Z", frame.normal],
    ] as const)
      result.push({
        key: `frame/${name}`,
        label: `${name} axis`,
        kind: "direction",
        point: [...frame.origin],
        direction: [...direction],
        surfaceKind: "coordinateFrame",
      });
    for (const [name, normal] of [
      ["XY", frame.normal],
      ["YZ", frame.u],
      ["XZ", frame.v],
    ] as const)
      result.push({
        key: `frame/${name}`,
        label: `${name} plane`,
        kind: "plane",
        ...plane(frame.origin, normal),
        surfaceKind: "coordinateFrame",
      });
    return result;
  }
  if (
    entity.kind === "plane" &&
    entity.planeFrame &&
    !entity.fit &&
    !entity.kernelId
  ) {
    validatePlaneFrame(entity.planeFrame, entity.positions, entity.kind);
    return [
      {
        key: "plane/XY",
        label: "Plane",
        kind: "plane",
        ...plane(entity.planeFrame.center, entity.planeFrame.normal),
        surfaceKind: "constructionPlane",
      },
    ];
  }
  return [];
}

/** Read stored semantic geometry; this does not evaluate its construction recipe. */
export function referenceDatumFeature(
  entity: Entity,
): NativeDatumFeatureGeometry | undefined {
  const data = validateReferenceEntity(entity);
  if (!data) return undefined;
  const geometry = data.geometry;
  return geometry.kind === "point"
    ? { kind: "referencePoint", origin: geometry.position }
    : {
        kind: "referenceLine",
        origin: geometry.start,
        direction: geometry.direction,
        length: geometry.length,
      };
}

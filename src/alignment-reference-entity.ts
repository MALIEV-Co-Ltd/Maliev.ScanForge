import type { Entity } from "./types";
import { isReferenceEntity, validateReferenceEntity } from "./reference-entity";
import type { NativeDatumFeatureGeometry } from "./scan-native-datum-feature";

/** Discovery eligibility is independent of permission to move the source. */
export function hasAlignmentReferences(entity: Entity): boolean {
  return !!(entity.kernelId || entity.fit || isReferenceEntity(entity));
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

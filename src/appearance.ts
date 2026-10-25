/** Neutral base material for newly created or imported parts. Project colors remain authored data. */
export const DEFAULT_PART_COLOR = "#a6a6a6";
/** Authoring geometry is visually distinct from exact, STEP-exportable parts. */
export const DEFAULT_FREEFORM_COLOR = "#aa83cf";
export const DEFAULT_REFERENCE_COLOR = "#60b6ad";
export const DEFAULT_POINT_CLOUD_COLOR = "#aaff00";
export const DEFAULT_POINT_SIZE = 1;
export const DEFAULT_POINT_DENSITY = 100;

export function validatePointCloudDisplay(entity: {
  kind: string;
  pointSize?: number;
  pointColorMode?: string;
  pointAutoDensity?: boolean;
  pointDensity?: number;
}): void {
  if (
    (entity.pointSize !== undefined &&
      (!Number.isFinite(entity.pointSize) ||
        entity.pointSize < 1 ||
        entity.pointSize > 10)) ||
    (entity.pointColorMode !== undefined &&
      !["source", "solid"].includes(entity.pointColorMode)) ||
    (entity.pointAutoDensity !== undefined &&
      typeof entity.pointAutoDensity !== "boolean") ||
    (entity.pointDensity !== undefined &&
      (!Number.isFinite(entity.pointDensity) ||
        entity.pointDensity < 10 ||
        entity.pointDensity > 100))
  )
    throw new Error("Invalid point-cloud display options.");
}

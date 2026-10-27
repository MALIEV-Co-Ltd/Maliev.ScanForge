import type { Entity, Vec3 } from "./types";

export interface PrimitiveFitRegion {
  center: Vec3;
  radius: number;
}
/** Shared primitive-fit samples; preserve source precision, membership and stride. */
export function primitiveFitSamples(
  source: Pick<Entity, "kind" | "positions">,
  selection?: Uint8Array | null,
  region?: PrimitiveFitRegion,
): number[] {
  return primitiveFitInput(source, selection, region).positions;
}

export function primitiveFitInput(
  source: Pick<Entity, "kind" | "positions">,
  selection?: Uint8Array | null,
  region?: PrimitiveFitRegion,
): { positions: number[]; totalVertices: number } {
  if (
    region &&
    (!Array.isArray(region.center) ||
      region.center.length !== 3 ||
      !region.center.every(Number.isFinite) ||
      !Number.isFinite(region.radius) ||
      region.radius <= 0)
  )
    throw new Error(
      "Fitting region requires a finite center and positive radius.",
    );
  const positions = source.positions;
  const slotWidth = source.kind === "pointcloud" ? 3 : 9;
  const hasSelection = selection?.some(Boolean) ?? false;
  const eligible = (offset: number) =>
    (!hasSelection || !!selection?.[Math.floor(offset / slotWidth)]) &&
    (!region ||
      Math.hypot(
        positions[offset] - region.center[0],
        positions[offset + 1] - region.center[1],
        positions[offset + 2] - region.center[2],
      ) <= region.radius);
  let count = 0;
  for (let offset = 0; offset < positions.length; offset += 3)
    if (eligible(offset)) count++;
  const stride = Math.max(1, Math.ceil(count / 20_000));
  const sampled: number[] = [];
  let eligibleIndex = 0;
  for (let offset = 0; offset < positions.length; offset += 3)
    if (eligible(offset) && eligibleIndex++ % stride === 0)
      sampled.push(
        positions[offset],
        positions[offset + 1],
        positions[offset + 2],
      );
  return { positions: sampled, totalVertices: count };
}

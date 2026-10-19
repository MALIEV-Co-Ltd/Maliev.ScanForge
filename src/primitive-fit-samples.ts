import type { Entity, Vec3 } from "./types";

/** GUI primitive-fit samples; preserve existing mask, precision and stride semantics. */
export function primitiveFitSamples(
  source: Pick<Entity, "kind" | "positions">,
  selection?: Uint8Array | null,
  region?: { center: Vec3; radius: number },
): number[] {
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
  return sampled;
}

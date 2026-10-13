import type { Vec3 } from "./types";

/** Original registration gate's line-distance metric. The line fit itself is
 * supplied by the caller; this does not substitute a different PCA solver.
 */
export function nativeAlignmentLineRms(
  points: readonly Vec3[],
  center: Vec3,
  direction: Vec3,
  enabled?: Uint8Array,
): number {
  if (enabled && enabled.length !== points.length)
    throw new Error("Line metric mask must match the point count.");
  if (![...center, ...direction].every(Number.isFinite))
    throw new Error("Line metric requires finite center and direction.");
  let error = 0;
  let count = 0;
  for (let id = 0; id < points.length; id++) {
    if (enabled && !enabled[id]) continue;
    const point = points[id];
    if (point.length !== 3 || !point.every(Number.isFinite))
      throw new Error("Line metric requires finite XYZ points.");
    const x = Math.fround(point[0]) - center[0];
    const y = Math.fround(point[1]) - center[1];
    const z = Math.fround(point[2]) - center[2];
    if (![x, y, z].every(Number.isFinite))
      throw new Error("Line metric points exceed Float32 precision.");
    const projection = y * direction[1] + x * direction[0] + z * direction[2];
    const rx = x - direction[0] * projection;
    const ry = y - direction[1] * projection;
    const rz = z - direction[2] * projection;
    // Preserve the original sqrt followed by resquaring before accumulation.
    const distance = Math.sqrt(rx * rx + ry * ry + rz * rz);
    error += distance * distance;
    count++;
  }
  return count ? Math.sqrt(error / count) : 3.4028234663852886e38;
}

/** Original outer caller proceeds when fitting fails or line RMS is >= 1.
 * Unordered (NaN) comparisons also proceed, as in its COMISD/JBE branch.
 */
export function nativeAlignmentLineGate(fitted: boolean, rms: number): boolean {
  return !fitted || !(rms < 1);
}

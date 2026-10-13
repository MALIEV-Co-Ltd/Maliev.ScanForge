import type { Vec3 } from "./types";
import { nativeAlignmentEigen3 } from "./scan-native-alignment-eigen";

/** Original source-point line fit used before paired-point registration. */
export function nativeAlignmentLineFit(points: readonly Vec3[]) {
  const rounded = points.map((point): Vec3 => {
    if (point.length !== 3 || !point.every(Number.isFinite))
      throw new Error("Line fit requires finite XYZ points.");
    const result = point.map(Math.fround) as Vec3;
    if (!result.every(Number.isFinite))
      throw new Error("Line fit points exceed Float32 precision.");
    return result;
  });
  const center: Vec3 = [0, 0, 0];
  const direction: Vec3 = [0, 0, 0];
  if (rounded.length < 2) return { accepted: false, center, direction };
  if (rounded.length === 2) {
    center.splice(0, 3, ...rounded[0]);
    for (let i = 0; i < 3; i++) direction[i] = rounded[1][i] - rounded[0][i];
  } else {
    let xx = 0,
      yy = 0,
      zz = 0,
      x = 0,
      y = 0,
      z = 0;
    let xy = 0,
      xz = 0,
      yz = 0;
    for (const [px, py, pz] of rounded) {
      xx += px * px;
      yy += py * py;
      zz += pz * pz;
      x += px;
      y += py;
      z += pz;
      xy += py * px;
      xz += pz * px;
      yz += pz * py;
    }
    const count = rounded.length;
    xx -= (x * x) / count;
    yy -= (y * y) / count;
    zz -= (z * z) / count;
    xy -= (y * x) / count;
    xz -= (z * x) / count;
    yz -= (z * y) / count;
    const eigen = nativeAlignmentEigen3([xx, xy, xz, xy, yy, yz, xz, yz, zz]);
    if (!eigen.accepted) return { accepted: false, center, direction };
    center.splice(0, 3, x / count, y / count, z / count);
    direction.splice(
      0,
      3,
      eigen.vectors[0],
      eigen.vectors[3],
      eigen.vectors[6],
    );
  }
  const lengthSquared =
    direction[0] * direction[0] +
    direction[1] * direction[1] +
    direction[2] * direction[2];
  if (lengthSquared <= Number.EPSILON) direction.splice(0, 3, 1, 0, 0);
  else {
    const length = Math.sqrt(lengthSquared);
    if (length >= Number.EPSILON) {
      const reciprocal = 1 / length;
      for (let i = 0; i < 3; i++) direction[i] *= reciprocal;
    }
  }
  const projection =
    center[0] * direction[0] +
    center[1] * direction[1] +
    center[2] * direction[2];
  const threshold =
    (center[0] * center[0] + center[1] * center[1] + center[2] * center[2]) *
    Number.EPSILON;
  if (Math.abs(projection) > threshold)
    for (let i = 0; i < 3; i++) center[i] -= direction[i] * projection;
  return { accepted: true, center, direction };
}

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

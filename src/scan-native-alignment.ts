import type { Vec3 } from "./types";

/** Recovered quaternion conversion used by native paired-point refinement.
 * This is a solver component, not a complete alignment implementation.
 */
export function nativeAlignmentRotation(
  quaternion: readonly [number, number, number, number],
): number[] {
  let [w, x, y, z] = quaternion;
  const lengthSquared = w * w + x * x + y * y + z * z;
  if (
    Math.abs(lengthSquared - 1) > 2 ** -23 &&
    Math.abs(lengthSquared) > Number.EPSILON
  ) {
    const reciprocal = 1 / Math.sqrt(lengthSquared);
    w *= reciprocal;
    x *= reciprocal;
    y *= reciprocal;
    z *= reciprocal;
  }
  const twiceX = x + x;
  const twiceY = y + y;
  const twiceZW = (z + z) * w;
  const twiceZZ = (z + z) * z;
  return [
    1 - (twiceZZ + twiceY * y),
    twiceX * y - twiceZW,
    twiceX * z + twiceY * w,
    twiceX * y + twiceZW,
    1 - (twiceZZ + twiceX * x),
    twiceY * z - twiceX * w,
    twiceX * z - twiceY * w,
    twiceY * z + twiceX * w,
    1 - (twiceY * y + twiceX * x),
  ];
}

/** Native optimizer objective, distinct from the outer squared-error ranking.
 * Callers supply paired Float32 points and a row-major 3x4 matrix.
 */
export function nativeAlignmentObjective(
  matrix: readonly number[],
  source: readonly Vec3[],
  target: readonly Vec3[],
): number {
  if (matrix.length !== 12 || source.length !== target.length)
    throw new Error(
      "Alignment objective requires a 3x4 matrix and paired points.",
    );
  let error = 0;
  for (let id = 0; id < source.length; id++) {
    const [x, y, z] = source[id];
    const [tx, ty, tz] = target[id];
    error =
      error +
      Math.abs(
        tx -
          Math.fround(
            y * matrix[1] + x * matrix[0] + z * matrix[2] + matrix[3],
          ),
      ) +
      Math.abs(
        ty -
          Math.fround(
            x * matrix[4] + y * matrix[5] + z * matrix[6] + matrix[7],
          ),
      ) +
      Math.abs(
        tz -
          Math.fround(
            x * matrix[8] + y * matrix[9] + z * matrix[10] + matrix[11],
          ),
      );
  }
  return error;
}

/** Outer candidate metric. Inputs are paired Float32 points; per-point squares
 * are combined before accumulation, as in the original instruction sequence.
 */
export function nativeAlignmentSquaredError(
  matrix: readonly number[],
  source: readonly Vec3[],
  target: readonly Vec3[],
): number {
  if (matrix.length !== 12 || source.length !== target.length)
    throw new Error("Alignment error requires a 3x4 matrix and paired points.");
  let error = 0;
  for (let id = 0; id < source.length; id++) {
    const [x, y, z] = source[id];
    const [tx, ty, tz] = target[id];
    const dx =
      Math.fround(y * matrix[1] + x * matrix[0] + z * matrix[2] + matrix[3]) -
      tx;
    const dy =
      Math.fround(x * matrix[4] + y * matrix[5] + z * matrix[6] + matrix[7]) -
      ty;
    const dz =
      Math.fround(x * matrix[8] + y * matrix[9] + z * matrix[10] + matrix[11]) -
      tz;
    error += dx * dx + dy * dy + dz * dz;
  }
  return error;
}

/** Original RMS wrapper returns zero for empty paired inputs. */
export function nativeAlignmentRms(
  matrix: readonly number[],
  source: readonly Vec3[],
  target: readonly Vec3[],
): number {
  const error = nativeAlignmentSquaredError(matrix, source, target);
  return source.length ? Math.sqrt(error / source.length) : error;
}

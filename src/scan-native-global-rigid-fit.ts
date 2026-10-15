import { nativeGlobalEigen4 } from "./scan-native-global-eigen";

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** Original global-registration pair accumulator and Horn quaternion solve.
 * This fits already-established pairs; it does not invent correspondences or
 * replace the separate global scheduling, overlap and convergence rules.
 */
export function nativeGlobalRigidFit(
  source: readonly (readonly number[])[],
  target: readonly (readonly number[])[],
) {
  if (source.length !== target.length)
    throw new Error("Global rigid fit requires paired records.");
  const sums = new Array<number>(6).fill(0);
  const covariance = new Array<number>(9).fill(0);
  let distanceSum = 0;
  for (let i = 0; i < source.length; i++) {
    const p = source[i],
      q = target[i];
    if (
      p.length !== 3 ||
      q.length !== 3 ||
      ![...p, ...q].every(Number.isFinite)
    )
      throw new Error("Global rigid fit requires finite XYZ pairs.");
    for (let a = 0; a < 3; a++) {
      sums[a] += p[a];
      sums[a + 3] += q[a];
      for (let b = 0; b < 3; b++) covariance[a * 3 + b] += p[a] * q[b];
    }
    const x = p[0] - q[0],
      y = p[1] - q[1],
      z = p[2] - q[2];
    distanceSum += Math.sqrt(y * y + x * x + z * z);
  }
  if (source.length < 3)
    return { accepted: false, matrix: identity(), meanDistance: 0 };
  const reciprocal = 1 / source.length;
  const [sx, sy, sz, tx, ty, tz] = sums.map((v) => reciprocal * v);
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++)
      covariance[a * 3 + b] =
        reciprocal * covariance[a * 3 + b] - [sx, sy, sz][a] * [tx, ty, tz][b];
  const h = covariance;
  const n01 = h[5] - h[7],
    n02 = h[6] - h[2],
    n03 = h[1] - h[3];
  const n12 = h[1] + h[3],
    n13 = h[2] + h[6],
    n23 = h[5] + h[7];
  const eigen = nativeGlobalEigen4([
    h[0] + h[4] + h[8],
    n01,
    n02,
    n03,
    n01,
    h[0] - (h[8] + h[4]),
    n12,
    n13,
    n02,
    n12,
    h[4] - (h[0] + h[8]),
    n23,
    n03,
    n13,
    n23,
    h[8] - (h[0] + h[4]),
  ]);
  const meanDistance = reciprocal * distanceSum;
  if (!eigen.accepted)
    return { accepted: false, matrix: identity(), meanDistance };
  const w = eigen.vectors[0],
    x = eigen.vectors[4],
    y = eigen.vectors[8],
    z = eigen.vectors[12];
  const ww = w * w,
    xx = x * x,
    yy = y * y,
    zz = z * z;
  const yx = y * x,
    wz = w * z,
    zx = z * x,
    yw = y * w;
  const matrix = identity();
  matrix[0] = xx + ww - yy - zz;
  matrix[5] = ww + yy - xx - zz;
  matrix[10] = zz + ww - xx - yy;
  matrix[1] = yx - wz + (yx - wz);
  matrix[4] = wz + yx + (wz + yx);
  matrix[2] = yw + zx + (yw + zx);
  matrix[8] = zx - yw + (zx - yw);
  const yz = y * z,
    wx = w * x;
  matrix[6] = yz - wx + (yz - wx);
  matrix[9] = wx + yz + (wx + yz);
  matrix[3] = tx - (sx * matrix[0] + matrix[1] * sy + matrix[2] * sz + 0);
  matrix[7] = ty - (sy * matrix[5] + matrix[4] * sx + matrix[6] * sz + 0);
  matrix[11] = tz - (matrix[8] * sx + matrix[9] * sy + sz * matrix[10] + 0);
  return { accepted: true, matrix, meanDistance };
}

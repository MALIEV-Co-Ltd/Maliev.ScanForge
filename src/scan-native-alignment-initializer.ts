import type { Vec3 } from "./types";
import { inverseMirrorFrame } from "./scan-mirror-frame";

function normalize(vector: Vec3): Vec3 {
  const [x, y, z] = vector;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length >= Number.EPSILON) {
    const reciprocal = 1 / length;
    return [x * reciprocal, y * reciprocal, z * reciprocal];
  }
  return vector;
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  b[2] * a[1] - b[1] * a[2],
  b[0] * a[2] - b[2] * a[0],
  b[1] * a[0] - b[0] * a[1],
];
function centeredFrame(points: readonly Vec3[], x: Vec3, second: Vec3) {
  const z = normalize(cross(x, second));
  const y = normalize(cross(z, x));
  const m = inverseMirrorFrame([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
  ]);
  const center = [0, 1, 2].map(
    (axis) => (points[0][axis] + points[1][axis] + points[2][axis]) / 3,
  );
  for (let row = 0; row < 3; row++) {
    const offset = row * 4;
    m[offset + 3] =
      center[0] * m[offset] +
      center[1] * m[offset + 1] +
      center[2] * m[offset + 2] +
      m[offset + 3];
  }
  // Native coordinate storage uses the positive Float32 maximum as a sentinel.
  if (
    !Number.isNaN(m[3]) &&
    Math.abs(Math.fround(m[3]) - 3.4028234663852886e38) >= 2 ** -23
  )
    for (const offset of [3, 7, 11]) m[offset] = -m[offset];
  return m;
}
/** Original three-pair initializer, before optimization or candidate ranking. */
export function nativeAlignmentTriplet(
  source: readonly Vec3[],
  target: readonly Vec3[],
): number[] | undefined {
  if (
    source.length !== 3 ||
    target.length !== 3 ||
    ![...source, ...target].every(
      (point) => point.length === 3 && point.every(Number.isFinite),
    )
  )
    throw new Error(
      "Alignment initialization requires three finite point pairs.",
    );
  const vector = (points: readonly Vec3[], index: number): Vec3 => [
    points[index][0] - points[0][0],
    points[index][1] - points[0][1],
    points[index][2] - points[0][2],
  ];
  const vectors = [
    vector(source, 1),
    vector(target, 1),
    vector(source, 2),
    vector(target, 2),
  ];
  for (const [x, y, z] of vectors)
    if (!(y * y + x * x + z * z >= 2 ** -23)) return undefined;
  const [sx, tx, sy, ty] = vectors.map(normalize);
  const dot = (a: Vec3, b: Vec3) => a[1] * b[1] + a[0] * b[0] + a[2] * b[2];
  if (Math.abs(dot(sy, sx)) > 0.9962 || Math.abs(dot(ty, tx)) > 0.9962)
    return undefined;
  const a = inverseMirrorFrame(centeredFrame(target, tx, ty));
  const b = centeredFrame(source, sx, sy);
  const result = new Array<number>(12);
  for (let row = 0; row < 3; row++) {
    const offset = row * 4;
    for (let column = 0; column < 3; column++)
      result[offset + column] =
        a[offset] * b[column] +
        a[offset + 1] * b[column + 4] +
        a[offset + 2] * b[column + 8];
    result[offset + 3] =
      b[3] * a[offset] +
      b[7] * a[offset + 1] +
      b[11] * a[offset + 2] +
      a[offset + 3];
  }
  return result;
}

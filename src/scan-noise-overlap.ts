type Point = readonly number[];
const epsilon = 2 ** -23;
const faceLimit = 0.5 + epsilon;
const edgeLimit = 1 + epsilon;
const cornerLimit = 1.5 + epsilon;

function faceCode(p: Point): number {
  return (
    (p[0] <= faceLimit ? (p[0] < -faceLimit ? 2 : 0) : 1) |
    (p[1] <= faceLimit ? (p[1] < -faceLimit ? 8 : 0) : 4) |
    (p[2] <= faceLimit ? (p[2] < -faceLimit ? 32 : 0) : 16)
  );
}
function edgeCode([x, y, z]: Point): number {
  return [
    x + y,
    x - y,
    y - x,
    -x - y,
    z + x,
    x - z,
    z - x,
    -x - z,
    z + y,
    y - z,
    z - y,
    -y - z,
  ].reduce((code, value, bit) => code | (value > edgeLimit ? 1 << bit : 0), 0);
}
function cornerCode([x, y, z]: Point): number {
  return [
    x + y + z,
    x + y - z,
    x - y + z,
    x - y - z,
    y - x + z,
    y - x - z,
    z - (x + y),
    -x - y - z,
  ].reduce(
    (code, value, bit) => code | (value > cornerLimit ? 1 << bit : 0),
    0,
  );
}
function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  for (let i = 0; i < 3; i++)
    if (!(
      p[i] <= Math.max(a[i], b[i], c[i]) + epsilon &&
      Math.min(a[i], b[i], c[i]) - epsilon <= p[i]
    ))
      return false;
  const side = (u: Point, v: Point) => {
    const x = Math.fround(
      (p[2] - u[2]) * (v[1] - u[1]) - (v[2] - u[2]) * (p[1] - u[1]),
    );
    const y = Math.fround(
      (v[2] - u[2]) * (p[0] - u[0]) - (p[2] - u[2]) * (v[0] - u[0]),
    );
    const z = Math.fround(
      (p[1] - u[1]) * (v[0] - u[0]) - (v[1] - u[1]) * (p[0] - u[0]),
    );
    return (
      (x > -1e-5 ? 2 : 0) |
      (x < 1e-5 ? 1 : 0) |
      (y > -1e-5 ? 8 : 0) |
      (y < 1e-5 ? 4 : 0) |
      (z > -1e-5 ? 32 : 0) |
      (z < 1e-5 ? 16 : 0)
    );
  };
  const code = side(a, b) & side(b, c) & side(c, a);
  return !!(code & 48 && code & 12 && code & 3);
}

function edgeIntersects(a: Point, b: Point, code: number): boolean {
  for (let axis = 0; axis < 3; axis++)
    for (let sign = 0; sign < 2; sign++) {
      const bit = 1 << (axis * 2 + sign);
      if (!(code & bit)) continue;
      const t = ((sign ? -0.5 : 0.5) - a[axis]) * (1 / (b[axis] - a[axis]));
      const p = a.map((value, i) => Math.fround((b[i] - value) * t + value));
      const outside =
        (p[0] <= faceLimit ? (p[0] < -faceLimit ? 2 : 0) : 1) |
        (p[1] <= faceLimit ? (p[1] < -faceLimit ? 8 : 0) : 4) |
        (p[2] > faceLimit ? 16 : p[2] < -faceLimit ? 32 : 0);
      if (!(outside & (63 ^ bit))) return true;
    }
  return false;
}

/** Native normalized cube intersection; coordinates are relative to the node center and full extents. */
export function noiseTriangleCubeOverlap(
  a: Point,
  b: Point,
  c: Point,
): boolean {
  let ac = faceCode(a),
    bc = faceCode(b),
    cc = faceCode(c);
  if (!ac || !bc || !cc) return true;
  if (ac & bc & cc) return false;
  ac |= edgeCode(a) << 8;
  bc |= edgeCode(b) << 8;
  cc |= edgeCode(c) << 8;
  if (ac & bc & cc) return false;
  ac |= cornerCode(a) << 24;
  bc |= cornerCode(b) << 24;
  cc |= cornerCode(c) << 24;
  if (ac & bc & cc) return false;
  if (!(ac & bc) && edgeIntersects(a, b, ac | bc)) return true;
  if (!(ac & cc) && edgeIntersects(a, c, ac | cc)) return true;
  if (!(bc & cc) && edgeIntersects(b, c, bc | cc)) return true;
  const nz = (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (c[2] - a[2]) * (b[0] - a[0]);
  const nx = (c[2] - a[2]) * (b[1] - a[1]) - (b[2] - a[2]) * (c[1] - a[1]);
  const plane = ny * a[1] + nx * a[0] + nz * a[2];
  for (const [sy, sz, denominator] of [
    [1, 1, nx + ny + nz],
    [1, -1, nx + ny - nz],
    [-1, 1, nz + (nx - ny)],
    [-1, -1, nx - ny - nz],
  ]) {
    const t = plane / denominator;
    if (Math.abs(t) <= 0.5 && pointInTriangle([t, sy * t, sz * t], a, b, c))
      return true;
  }
  return false;
}

const f = Math.fround;
const maximum = f(3.4028234663852886e38);
const edgeParameter = (numerator: number, denominator: number) =>
  numerator <= 0 ? 0 : denominator <= numerator ? 1 : numerator / denominator;

/** Original signed triangle leaf, operating on prepared Float32 vertices and
 * normals with a Double query/radius. The caller validates geometry and owns
 * reusable output buffers. No per-query arrays, records or closures are made.
 * A plane cutoff retains the projection buffer; degeneracy retains native NaN
 * behavior for the enclosing nearest-hit comparison to reject.
 */
export function nativeGlobalTriangleDistance(
  point: ArrayLike<number>,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  c: ArrayLike<number>,
  normal: ArrayLike<number>,
  radius: number,
  projection: Float64Array,
  edgeFlags: Uint8Array,
): number {
  edgeFlags[0] = 0;
  const qx = point[0] - a[0],
    qy = point[1] - a[1],
    qz = point[2] - a[2];
  if (radius < Math.abs(normal[0] * qx + normal[1] * qy + normal[2] * qz))
    return maximum;
  const ux = f(b[0] - a[0]),
    uy = f(b[1] - a[1]),
    uz = f(b[2] - a[2]),
    vx = f(c[0] - a[0]),
    vy = f(c[1] - a[1]),
    vz = f(c[2] - a[2]);
  const aa = uy * uy + ux * ux + uz * uz,
    ab = vy * uy + vx * ux + vz * uz,
    cc = vy * vy + vx * vx + vz * vz,
    d = ux * qx + uy * qy + uz * qz,
    e = vx * qx + vy * qy + vz * qz,
    determinant = cc * aa - ab * ab;
  let s = -e * ab - -d * cc,
    t = -d * ab - -e * aa,
    region = 0;
  if (determinant < t + s) {
    if (s >= 0) {
      if (t < 0) {
        region = 3;
        const first = -d + aa,
          second = -e + ab;
        if (second < first) {
          const numerator = first - second,
            denominator = aa - (ab + ab) + cc;
          if (numerator < denominator) {
            t = numerator / denominator;
            s = 1 - t;
          } else {
            t = 1;
            s = 0;
          }
        } else {
          s = edgeParameter(d, aa);
          t = 0;
        }
      } else {
        region = 2;
        const numerator = -e + cc - ab - -d;
        if (numerator <= 0) {
          s = 0;
          t = 1;
        } else {
          const denominator = aa - (ab + ab) + cc;
          if (numerator < denominator) {
            s = numerator / denominator;
            t = 1 - s;
          } else {
            s = 1;
            t = 0;
          }
        }
      }
    } else {
      region = 6;
      const first = -e + cc,
        second = -d + ab;
      if (first <= second) {
        s = 0;
        t = edgeParameter(e, cc);
      } else {
        const numerator = first - second,
          denominator = aa - (ab + ab) + cc;
        if (numerator < denominator) {
          s = numerator / denominator;
          t = 1 - s;
        } else {
          s = 1;
          t = 0;
        }
      }
    }
  } else if (s >= 0) {
    if (t >= 0) {
      const reciprocal = 1 / determinant;
      s *= reciprocal;
      t *= reciprocal;
    } else {
      region = 1;
      s = edgeParameter(d, aa);
      t = 0;
    }
  } else if (t >= 0) {
    region = 4;
    s = 0;
    t = edgeParameter(e, cc);
  } else {
    region = 5;
    if (d > 0) {
      s = edgeParameter(d, aa);
      t = 0;
    } else {
      s = 0;
      t = edgeParameter(e, cc);
    }
  }
  edgeFlags[0] = region;
  projection[0] = f(f(ux * s + a[0]) + vx * t);
  projection[1] = f(f(uy * s + a[1]) + vy * t);
  projection[2] = f(f(uz * s + a[2]) + vz * t);
  const dx = point[0] - projection[0],
    dy = point[1] - projection[1],
    dz = point[2] - projection[2];
  const distance = Math.sqrt(dy * dy + dx * dx + dz * dz);
  return normal[1] * dy + normal[0] * dx + normal[2] * dz < 0
    ? -distance
    : distance;
}

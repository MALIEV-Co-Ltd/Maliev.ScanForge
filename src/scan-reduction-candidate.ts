import type { Vec3 } from "./types";

/** Upper triangular symmetric quadric: xx, xy, xz, xw, yy, yz, yw, zz, zw, ww. */
export interface ReductionVertex {
  point: Vec3;
  quadric: ArrayLike<number>;
  boundary: boolean;
}

/** Native collapse candidate; ordering, singular threshold and tie writes matter. */
export function reductionCandidate(
  left: ReductionVertex,
  right: ReductionVertex,
) {
  const q = Array.from(
    { length: 10 },
    (_, i) => right.quadric[i] + left.quadric[i],
  );
  const [a, b, c, d, e, f, g, h, i, j] = q;
  const determinant =
    b * c * f +
    a * e * h +
    c * (b * f) -
    c * (c * e) -
    f * (f * a) -
    h * (b * b);
  let point: Vec3;
  let cost: number;
  if (Math.abs(determinant) <= 2 ** -23 || (left.boundary && right.boundary)) {
    const [x, y, z] = left.point;
    const [u, v, w] = right.point;
    const mx = (x + u) * 0.5,
      my = (y + v) * 0.5,
      mz = (w + z) * 0.5;
    const bb = b + b,
      cc = c + c,
      dd = d + d,
      ff = f + f,
      gg = g + g,
      ii = i + i;
    const first =
      a * x * x +
      bb * x * y +
      cc * x * z +
      x * dd +
      e * y * y +
      y * ff * z +
      gg * y +
      h * z * z +
      ii * z +
      j;
    const second =
      a * u * u +
      bb * u * v +
      cc * u * w +
      u * dd +
      e * v * v +
      v * ff * w +
      gg * v +
      h * w * w +
      ii * w +
      j;
    const middle =
      a * mx * mx +
      mx * bb * my +
      mx * cc * mz +
      mx * dd +
      e * my * my +
      my * ff * mz +
      my * gg +
      h * mz * mz +
      mz * ii +
      j;
    cost = middle <= second ? middle : second;
    if (first < cost) cost = first;
    point = [...left.point];
    if (first === cost) point = [...left.point];
    if (second === cost) point = [...right.point];
    if (middle === cost) point = [mx, my, mz];
  } else {
    const inverse = 1 / determinant;
    const nx =
      (d * e * h +
        b * f * i +
        c * g * f -
        f * (d * f) -
        h * (g * b) -
        c * e * i) *
      inverse;
    const y =
      (i * (f * a) +
        d * b * h +
        c * g * c -
        c * (d * f) -
        g * a * h -
        b * c * i) *
      inverse;
    const nz =
      (a * e * i + d * b * f + g * b * c - d * e * c - g * a * f - b * b * i) *
      inverse;
    point = [-nx, y, -nz];
    cost =
      (b + b) * -nx * y +
      a * -nx * -nx +
      (c + c) * -nx * -nz +
      (d + d) * -nx +
      y * e * y +
      (f + f) * y * -nz +
      (g + g) * y +
      h * -nz * -nz +
      (i + i) * -nz +
      j;
  }
  return { point, cost };
}

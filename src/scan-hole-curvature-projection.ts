/** Original origin-based solve (140a55900), including its singular-plane gate. */
export function nativeCurvatureWeights(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  point: readonly number[],
): [number, number, number] | undefined {
  if ([a, b, c, point].some((p) => p.length !== 3 || !p.every(Number.isFinite)))
    throw new Error("Curvature projection requires finite XYZ coordinates.");
  const denominator =
    b[0] * c[1] * a[2] +
    a[0] * b[1] * c[2] +
    c[0] * a[1] * b[2] -
    a[2] * b[1] * c[0] -
    b[2] * c[1] * a[0] -
    a[1] * c[2] * b[0];
  if (!(Number.EPSILON <= Math.abs(denominator))) return undefined;
  const reciprocal = 1 / denominator;
  const first =
    (point[0] * b[1] * c[2] +
      b[0] * c[1] * point[2] +
      point[1] * c[0] * b[2] -
      point[2] * b[1] * c[0] -
      b[2] * c[1] * point[0] -
      point[1] * c[2] * b[0]) *
    reciprocal;
  const second =
    (a[0] * point[1] * c[2] +
      c[1] * point[0] * a[2] +
      point[2] * c[0] * a[1] -
      a[2] * point[1] * c[0] -
      c[1] * point[2] * a[0] -
      point[0] * a[1] * c[2]) *
    reciprocal;
  const third =
    (b[0] * point[1] * a[2] +
      point[2] * a[0] * b[1] +
      point[0] * a[1] * b[2] -
      point[0] * a[2] * b[1] -
      b[2] * point[1] * a[0] -
      point[2] * a[1] * b[0]) *
    reciprocal;
  if (![first, second, third].every(Number.isFinite))
    throw new Error("Curvature projection weights overflowed.");
  return [first, second, third];
}

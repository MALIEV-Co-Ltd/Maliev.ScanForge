const f = Math.fround;

function validate(bounds: Float32Array): void {
  if (bounds.length !== 6 || !bounds.every(Number.isFinite))
    throw new Error("Query bounds require six finite float coordinates");
}

/** Original query pruning expands each coordinate interval independently. */
export function guideQueryBoundsContain(
  bounds: Float32Array,
  point: Float32Array,
  radius: number,
): boolean {
  validate(bounds);
  if (
    point.length !== 3 ||
    !point.every(Number.isFinite) ||
    !Number.isFinite(f(radius))
  )
    throw new Error("Query point and radius must contain finite float values");
  radius = f(radius);
  for (let axis = 0; axis < 3; axis++) {
    if (
      f(bounds[axis] - radius) > point[axis] ||
      point[axis] > f(radius + bounds[axis + 3])
    )
      return false;
  }
  return true;
}

/** Float diagonal uses the original y-square, x-square, z-square sum order. */
export function guideQueryBoundsLength(bounds: Float32Array): number {
  validate(bounds);
  const x = f(bounds[3] - bounds[0]);
  const y = f(bounds[4] - bounds[1]);
  const z = f(bounds[5] - bounds[2]);
  return f(Math.sqrt(f(f(f(y * y) + f(x * x)) + f(z * z))));
}

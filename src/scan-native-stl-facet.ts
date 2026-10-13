/** Recovered fallback STL facet constructor (0x1408c82a0).
 * This is not the optimized binary reader or its vertex table implementation.
 */
export const NATIVE_STL_VERTEX_TOLERANCE = Math.fround(0.0001);
const FLOAT_MAX = Math.fround(3.4028234663852886e38);

export function nativeStlFacetCoordinates(coordinates: ArrayLike<number>) {
  if (coordinates.length !== 9)
    throw new Error("An STL facet requires nine coordinates.");
  const points = Float32Array.from(coordinates);
  if (!points.every((value) => value > -FLOAT_MAX && value < FLOAT_MAX))
    return undefined;
  const edges = [3, 6].map((offset) => {
    const edge = [0, 1, 2].map((axis) =>
      Math.fround(points[offset + axis] - points[axis]),
    );
    const length = Math.sqrt(
      edge[0] * edge[0] + edge[1] * edge[1] + edge[2] * edge[2],
    );
    const inverse = 1 / length;
    return length >= Number.EPSILON
      ? edge.map((value) => value * inverse)
      : edge;
  });
  const [a, b] = edges;
  const x = b[2] * a[1] - b[1] * a[2];
  const y = b[0] * a[2] - b[2] * a[0];
  const z = b[1] * a[0] - b[0] * a[1];
  return y * y + x * x + z * z >= 1.1920928955078125e-7 ? points : undefined;
}

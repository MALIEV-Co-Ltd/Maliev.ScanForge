/** Original facet task arithmetic. Output writes perform the native Float32
 * cache rounding, including sub-epsilon cross products and signed zero. */
export function nativeGlobalFacetNormal(
  vertices: ArrayLike<number>,
  triangles: Uint32Array,
  face: number,
  output: Float32Array,
  offset = 0,
) {
  const slot = face * 3,
    a = triangles[slot] * 3,
    b = triangles[slot + 1] * 3,
    c = triangles[slot + 2] * 3;
  // Native facet evaluation reads Float32 coordinates. Round each value on
  // access so precise authored arrays need no full-size temporary copy.
  const ax = Math.fround(vertices[a]),
    ay = Math.fround(vertices[a + 1]),
    az = Math.fround(vertices[a + 2]);
  const ux = Math.fround(vertices[b]) - ax,
    uy = Math.fround(vertices[b + 1]) - ay,
    uz = Math.fround(vertices[b + 2]) - az,
    vx = Math.fround(vertices[c]) - ax,
    vy = Math.fround(vertices[c + 1]) - ay,
    vz = Math.fround(vertices[c + 2]) - az;
  let x = vz * uy - vy * uz,
    y = vx * uz - vz * ux,
    z = vy * ux - vx * uy;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length > Number.EPSILON) {
    const denominator = Math.fround(length);
    x /= denominator;
    y /= denominator;
    z /= denominator;
  }
  output[offset] = x;
  output[offset + 1] = y;
  output[offset + 2] = z;
  return length <= Number.EPSILON ? 1 : 0;
}

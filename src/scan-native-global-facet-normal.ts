/** Original facet task arithmetic. Output writes perform the native Float32
 * cache rounding, including sub-epsilon cross products and signed zero. */
export function nativeGlobalFacetNormal(
  vertices: Float32Array,
  triangles: Uint32Array,
  face: number,
  output: Float32Array,
  offset = 0,
) {
  const slot = face * 3,
    a = triangles[slot] * 3,
    b = triangles[slot + 1] * 3,
    c = triangles[slot + 2] * 3;
  const ux = vertices[b] - vertices[a],
    uy = vertices[b + 1] - vertices[a + 1],
    uz = vertices[b + 2] - vertices[a + 2],
    vx = vertices[c] - vertices[a],
    vy = vertices[c + 1] - vertices[a + 1],
    vz = vertices[c + 2] - vertices[a + 2];
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

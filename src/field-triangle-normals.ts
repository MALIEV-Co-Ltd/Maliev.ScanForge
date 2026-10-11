export interface TriangleNormalCache {
  normals: Float32Array;
  crossLengths: Float32Array;
  surfaceArea: number;
}

/** Native triangle-storage full recomputation before optional normal smoothing. */
export function buildTriangleNormalCache(
  positions: Float32Array,
  triangles: Uint32Array,
): TriangleNormalCache {
  if (positions.length % 3 || triangles.length % 3)
    throw new Error("Triangle normal cache dimensions are inconsistent.");
  for (const value of positions)
    if (!Number.isFinite(value))
      throw new Error("Triangle normal cache geometry must be finite.");
  for (const vertex of triangles)
    if (vertex >= positions.length / 3)
      throw new Error("Triangle normal cache references an invalid vertex.");
  const normals = new Float32Array(triangles.length);
  const crossLengths = new Float32Array(triangles.length / 3);
  let total = 0;
  for (let face = 0; face < crossLengths.length; face++) {
    const start = face * 3;
    const a = triangles[start] * 3;
    const b = triangles[start + 1] * 3;
    const c = triangles[start + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let x = vz * uy - vy * uz;
    let y = vx * uz - vz * ux;
    let z = ux * vy - vx * uy;
    const length = Math.sqrt(x * x + y * y + z * z);
    if (length >= 1e-100) {
      const reciprocal = 1 / length;
      x *= reciprocal;
      y *= reciprocal;
      z *= reciprocal;
    }
    crossLengths[face] = length;
    total = Math.fround(total + crossLengths[face]);
    if (!Number.isFinite(crossLengths[face]) || !Number.isFinite(total))
      throw new Error("Triangle normal cache area overflowed.");
    normals[start] = x;
    normals[start + 1] = y;
    normals[start + 2] = z;
  }
  return { normals, crossLengths, surfaceArea: Math.fround(total * 0.5) };
}

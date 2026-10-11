export interface TriangleFieldNormals {
  normals: Float32Array;
  degenerateFaces: Uint8Array;
}

/** General polygon-path normal recomputation for three-vertex faces.
 * The distinct native triangle-storage cache path is not implemented here.
 */
export function deriveTriangleFieldNormals(
  positions: Float32Array,
  triangles: Uint32Array,
): TriangleFieldNormals {
  if (positions.length % 3 || triangles.length % 3)
    throw new Error("Triangle normal dimensions are inconsistent.");
  for (const value of positions)
    if (!Number.isFinite(value))
      throw new Error("Triangle normal geometry must be finite.");
  for (const index of triangles)
    if (index >= positions.length / 3)
      throw new Error("Triangle normal references an invalid vertex.");
  const normals = new Float32Array(triangles.length);
  const degenerateFaces = new Uint8Array(triangles.length / 3);
  for (let face = 0; face < degenerateFaces.length; face++) {
    const start = face * 3;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let corner = 0; corner < 3; corner++) {
      const a = triangles[start + corner] * 3;
      const b = triangles[start + ((corner + 1) % 3)] * 3;
      x +=
        (positions[a + 1] - positions[b + 1]) *
        (positions[b + 2] + positions[a + 2]);
      y +=
        (positions[a + 2] - positions[b + 2]) * (positions[b] + positions[a]);
      z +=
        (positions[a] - positions[b]) * (positions[a + 1] + positions[b + 1]);
    }
    // Native accumulation and reciprocal scaling are double; SQRTSS is float.
    const length = Math.fround(Math.sqrt(Math.fround(y * y + x * x + z * z)));
    if (!Number.isFinite(length))
      throw new Error("Triangle normal arithmetic overflowed.");
    if (length <= 1e-24) degenerateFaces[face] = 1;
    else {
      const reciprocal = 1 / length;
      x *= reciprocal;
      y *= reciprocal;
      z *= reciprocal;
    }
    normals[start] = x;
    normals[start + 1] = y;
    normals[start + 2] = z;
  }
  return { normals, degenerateFaces };
}

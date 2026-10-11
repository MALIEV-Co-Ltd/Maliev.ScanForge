/** Recovered triangle-only full recomputation branch; native cache/incremental paths are separate. */
export function deriveTriangleFieldCenters(
  positions: Float32Array,
  triangles: Uint32Array,
): Float32Array {
  if (positions.length % 3 || triangles.length % 3)
    throw new Error("Field center geometry dimensions are inconsistent.");
  for (const value of positions)
    if (!Number.isFinite(value))
      throw new Error("Field center vertices must be finite.");
  for (const vertex of triangles)
    if (vertex >= positions.length / 3)
      throw new Error("Field center references an invalid vertex.");
  const centers = new Float32Array(triangles.length);
  const f = Math.fround;
  for (let face = 0; face < triangles.length; face += 3)
    for (let axis = 0; axis < 3; axis++) {
      // Assembly promotes coordinates, sums vertices 0+1 then 2, and scales in double.
      const sum =
        positions[triangles[face + 2] * 3 + axis] +
        (positions[triangles[face] * 3 + axis] +
          positions[triangles[face + 1] * 3 + axis]);
      centers[face + axis] = f(sum * (1 / 3));
      if (!Number.isFinite(centers[face + axis]))
        throw new Error("Field center arithmetic overflowed.");
    }
  return centers;
}

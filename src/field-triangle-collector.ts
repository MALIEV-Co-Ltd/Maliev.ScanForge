/** Recovered triangle-storage face bounds and initial ascending face order. */
export function collectGuideTriangles(
  positions: Float32Array,
  triangles: Uint32Array,
): { faceBounds: Float32Array[]; faces: Uint32Array } {
  if (
    positions.length % 3 ||
    triangles.length % 3 ||
    triangles.length > 0x7fffffff ||
    !positions.every(Number.isFinite)
  )
    throw new Error("Triangle collector dimensions or coordinates are invalid");
  for (const vertex of triangles)
    if (vertex >= positions.length / 3)
      throw new Error("Triangle collector vertex is invalid");
  const count = triangles.length / 3;
  const faces = new Uint32Array(count);
  const faceBounds: Float32Array[] = [];
  for (let face = 0; face < count; face++) {
    const first = triangles[face * 3] * 3;
    const box = new Float32Array([
      positions[first],
      positions[first + 1],
      positions[first + 2],
      positions[first],
      positions[first + 1],
      positions[first + 2],
    ]);
    for (let corner = 1; corner < 3; corner++) {
      const vertex = triangles[face * 3 + corner] * 3;
      for (let axis = 0; axis < 3; axis++) {
        const coordinate = positions[vertex + axis];
        // Comparisons retain the first value on ties, including signed zero.
        if (coordinate < box[axis]) box[axis] = coordinate;
        if (box[axis + 3] < coordinate) box[axis + 3] = coordinate;
      }
    }
    faceBounds.push(box);
    faces[face] = face;
  }
  return { faceBounds, faces };
}

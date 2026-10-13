/** Translate the worker-owned scan buffer: XY bounds centered on the origin, base on Z=0.
 * Rigid translation preserves orientation, dimensions and triangle winding.
 */
export function placeScanOnOrigin(
  positions: Float32Array,
  pointCloud = false,
  companionVertices: Float32Array[] = [],
): Float32Array {
  if (!positions.length || positions.length % (pointCloud ? 3 : 9))
    throw new Error("Expected complete scan triangles for origin placement.");
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const value = positions[i],
      axis = i % 3;
    if (!Number.isFinite(value))
      throw new Error("Scan coordinates must be finite.");
    min[axis] = Math.min(min[axis], value);
    max[axis] = Math.max(max[axis], value);
  }
  const center = [min[0] / 2 + max[0] / 2, min[1] / 2 + max[1] / 2, min[2]];
  if (
    [0, 1, 2].some(
      (axis) =>
        !Number.isFinite(Math.fround(max[axis] - center[axis])) ||
        !Number.isFinite(Math.fround(min[axis] - center[axis])),
    )
  )
    throw new Error("Scan extent exceeds the supported coordinate range.");
  for (let i = 0; i < positions.length; i++) positions[i] -= center[i % 3];
  for (const vertices of companionVertices)
    for (let i = 0; i < vertices.length; i++) {
      vertices[i] -= center[i % 3];
      if (!Number.isFinite(vertices[i]))
        throw new Error(
          "Indexed scan coordinates exceed the supported coordinate range.",
        );
    }
  return positions;
}

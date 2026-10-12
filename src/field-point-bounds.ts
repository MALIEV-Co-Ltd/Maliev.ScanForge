/** Recovered point-vector bounds expansion; empty input retains the supplied bounds. */
export function buildGuidePointBounds(
  positions: Float32Array,
  initial: Float32Array = new Float32Array([0, 0, 0, -1, 0, 0]),
): Float32Array {
  if (
    positions.length % 3 ||
    initial.length !== 6 ||
    !positions.every(Number.isFinite) ||
    !initial.every(Number.isFinite)
  )
    throw new Error("Point bounds dimensions or coordinates are invalid");
  const bounds = initial.slice();
  if (!positions.length) return bounds;
  let start = 0;
  // The original first-point helper uses only the x interval for invalidity.
  if (bounds[3] < bounds[0]) {
    bounds.set(positions.subarray(0, 3));
    bounds.set(positions.subarray(0, 3), 3);
    start = 3;
  }
  for (let vertex = start; vertex < positions.length; vertex += 3)
    for (let axis = 0; axis < 3; axis++) {
      const coordinate = positions[vertex + axis];
      if (bounds[axis] <= coordinate) {
        if (bounds[axis + 3] < coordinate) bounds[axis + 3] = coordinate;
      } else bounds[axis] = coordinate;
    }
  return bounds;
}

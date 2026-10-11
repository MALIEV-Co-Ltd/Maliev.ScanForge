function validateOffsets(offsets: Uint32Array) {
  if (!offsets.length || offsets[0] !== 0)
    throw new Error("Curvature edge offsets are invalid.");
  for (let edge = 1; edge < offsets.length; edge++)
    if (offsets[edge] < offsets[edge - 1])
      throw new Error("Curvature edge offsets are invalid.");
}

/** Recovered incidence classification in ascending edge order. */
export function classifyCurvatureBoundaryEdges(edgeOffsets: Uint32Array) {
  validateOffsets(edgeOffsets);
  const boundary: number[] = [];
  const nonmanifold: number[] = [];
  for (let edge = 0; edge + 1 < edgeOffsets.length; edge++) {
    const count = edgeOffsets[edge + 1] - edgeOffsets[edge];
    if (count !== 2) (count < 3 ? boundary : nonmanifold).push(edge);
  }
  return {
    boundaryEdges: new Uint32Array(boundary),
    nonmanifoldEdges: new Uint32Array(nonmanifold),
  };
}

/** Recovered supplied-boundary direction writes, preserving native last-write order. */
export function applyCurvatureBoundaryDirections(
  edgeOffsets: Uint32Array,
  halfedges: Uint32Array,
  boundaryEdges: Uint32Array,
  edgeDirections: Float32Array,
  previousDirections: Float32Array,
  previousFlags: Uint8Array,
) {
  validateOffsets(edgeOffsets);
  const edges = edgeOffsets.length - 1;
  const faces = previousFlags.length;
  const occupied = edgeOffsets[edges];
  if (
    edgeDirections.length !== edges * 3 ||
    previousDirections.length !== faces * 3 ||
    occupied > halfedges.length
  )
    throw new Error("Curvature boundary dimensions are inconsistent.");
  for (const array of [edgeDirections, previousDirections])
    if (array.some((value) => !Number.isFinite(value)))
      throw new Error("Curvature boundary directions must be finite.");
  for (let index = 0; index < occupied; index++)
    if (Math.floor(halfedges[index] / 3) >= faces)
      throw new Error(
        "Curvature boundary incidence references an invalid face.",
      );
  for (const edge of boundaryEdges)
    if (edge >= edges)
      throw new Error("Curvature boundary references an invalid edge.");
  const directions = new Float32Array(previousDirections);
  const flags = new Uint8Array(previousFlags);
  for (const edge of boundaryEdges) {
    for (
      let index = edgeOffsets[edge];
      index < edgeOffsets[edge + 1];
      index++
    ) {
      const face = Math.floor(halfedges[index] / 3);
      for (let axis = 0; axis < 3; axis++)
        directions[face * 3 + axis] = edgeDirections[edge * 3 + axis];
      flags[face] = 9;
    }
  }
  return { directions, flags };
}

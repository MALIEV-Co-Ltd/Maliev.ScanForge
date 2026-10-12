import { applyCurvatureBoundaryDirections } from "./field-curvature-boundary";

/** Recovered fixed-vertex symmetry-edge writes in ascending native edge order. */
export function applyCurvatureSymmetryDirections(
  edgeVertices: Uint32Array,
  edgeOffsets: Uint32Array,
  halfedges: Uint32Array,
  vertexPartners: Int32Array,
  edgeDirections: Float32Array,
  previousDirections: Float32Array,
  previousFlags: Uint8Array,
) {
  const edges = edgeOffsets.length - 1;
  if (edgeVertices.length !== edges * 2)
    throw new Error("Curvature symmetry edge dimensions are inconsistent.");
  for (const partner of vertexPartners)
    if (partner < -1 || partner >= vertexPartners.length)
      throw new Error("Curvature symmetry references an invalid partner.");
  const selected: number[] = [];
  if (vertexPartners.length) {
    for (let edge = 0; edge < edges; edge++) {
      const a = edgeVertices[edge * 2];
      const b = edgeVertices[edge * 2 + 1];
      if (a >= vertexPartners.length || b >= vertexPartners.length)
        throw new Error(
          "Curvature symmetry edge references an invalid vertex.",
        );
      if (vertexPartners[a] === a && vertexPartners[b] === b)
        selected.push(edge);
    }
  }
  const selectedEdges = new Uint32Array(selected);
  const state = applyCurvatureBoundaryDirections(
    edgeOffsets,
    halfedges,
    selectedEdges,
    edgeDirections,
    previousDirections,
    previousFlags,
  );
  for (const edge of selectedEdges)
    for (let index = edgeOffsets[edge]; index < edgeOffsets[edge + 1]; index++)
      state.flags[Math.floor(halfedges[index] / 3)] = 13;
  return { ...state, enabled: vertexPartners.length !== 0 };
}

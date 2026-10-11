import type { TriangleAdjacency } from "./field-triangle-adjacency";

/** Recovered radius-index finalization; writes a separate output from frozen choices. */
export function propagateCurvatureRadii(
  adjacency: Pick<TriangleAdjacency, "faceEdges" | "edgeOffsets" | "halfedges">,
  selected: Int32Array,
  candidateMasks: Uint8Array[],
  previous: Int32Array,
  {
    enabled = true,
    skippedFaces,
    firstFace = 0,
    endFace = selected.length,
  }: {
    enabled?: boolean;
    skippedFaces?: Uint8Array;
    firstFace?: number;
    endFace?: number;
  } = {},
): Int32Array {
  const faces = selected.length;
  const bytes = Math.ceil(faces / 8);
  if (
    faces > 0x7fffffff ||
    previous.length !== faces ||
    adjacency.faceEdges.length !== faces * 3 ||
    ![firstFace, endFace].every(Number.isSafeInteger) ||
    firstFace < 0 ||
    endFace < firstFace ||
    endFace > faces ||
    candidateMasks.some((mask) => mask.length > bytes) ||
    (skippedFaces && skippedFaces.length > bytes)
  )
    throw new Error("Curvature propagation dimensions are invalid.");
  const output = previous.slice();
  if (!enabled) return output;
  const marked = (mask: Uint8Array | undefined, face: number) =>
    !!(mask && face < mask.length * 8 && mask[face >> 3] & (1 << (face & 7)));
  const f = Math.fround;
  for (let face = firstFace; face < endFace; face++) {
    if (marked(skippedFaces, face) || selected[face] === -1) continue;
    const original = selected[face];
    if (original < 0 || original >= candidateMasks.length)
      throw new Error("Curvature propagation radius is invalid.");
    // Assembly reads corner zero once and reuses its incident pair three times.
    const edge = adjacency.faceEdges[face * 3];
    if (edge < 0 || edge + 1 >= adjacency.edgeOffsets.length)
      throw new Error("Curvature propagation edge is invalid.");
    const begin = adjacency.edgeOffsets[edge];
    const end = adjacency.edgeOffsets[edge + 1];
    if (end < begin || end > adjacency.halfedges.length)
      throw new Error("Curvature propagation incidence is invalid.");
    let sum = f(original);
    let count = 1;
    if (end - begin === 2) {
      const a = Math.trunc(adjacency.halfedges[begin] / 3);
      const b = Math.trunc(adjacency.halfedges[end - 1] / 3);
      if (a >= faces || b >= faces)
        throw new Error("Curvature propagation neighbor is invalid.");
      const neighbor = a === face ? b : b === face ? a : -1;
      if (neighbor !== -1 && selected[neighbor] !== -1) {
        const radius = selected[neighbor];
        if (radius < 0 || radius >= candidateMasks.length)
          throw new Error("Curvature propagation neighbor radius is invalid.");
        for (let repeat = 0; repeat < 3; repeat++) {
          sum = f(sum + f(radius));
          count = f(count + 1);
        }
      }
    }
    const rounded = Math.trunc(f(f(sum / count) + 0.5));
    if (rounded === original) continue;
    const step = rounded < original ? 1 : -1;
    // The original index is excluded; no successful candidate preserves prior output.
    for (let radius = rounded; radius !== original; radius += step) {
      if (marked(candidateMasks[radius], face)) {
        output[face] = radius;
        break;
      }
    }
  }
  return output;
}

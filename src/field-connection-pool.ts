import type { FieldExclusionBits } from "./field-candidate-lists";

export interface FieldConnectionPool {
  edgeIds: Uint32Array;
  eligibleEdges: Uint8Array;
  distances: Float32Array;
  predecessorEdges: Int32Array;
}

/** Recovered default-mode pool over upstream face centers and indexed incidence. */
export function deriveFieldConnectionPool(
  centers: Float32Array,
  faceEdges: Uint32Array,
  edgeOffsets: Uint32Array,
  halfedges: Uint32Array,
  fixedFaces: FieldExclusionBits,
  excludedSeeds?: FieldExclusionBits,
): FieldConnectionPool {
  const faces = centers.length / 3;
  const edges = edgeOffsets.length - 1;
  if (
    !Number.isInteger(faces) ||
    faceEdges.length !== centers.length ||
    edges < 0 ||
    edgeOffsets[0] !== 0 ||
    edgeOffsets.at(-1) !== halfedges.length ||
    halfedges.length !== faceEdges.length
  )
    throw new Error("Field connection incidence dimensions are inconsistent.");
  for (const value of centers)
    if (!Number.isFinite(value))
      throw new Error("Field face centers must be finite.");
  for (const mask of [fixedFaces, excludedSeeds]) {
    if (
      mask &&
      (!Number.isSafeInteger(mask.bitCount) ||
        mask.bitCount < 0 ||
        mask.bits.length < Math.ceil(mask.bitCount / 8))
    )
      throw new Error("Field connection mask dimensions are inconsistent.");
  }
  const flagged = (mask: FieldExclusionBits | undefined, face: number) =>
    !!mask &&
    face < mask.bitCount &&
    !!(mask.bits[face >> 3] & (1 << (face & 7)));
  for (const edge of faceEdges)
    if (edge >= edges)
      throw new Error("Field face references an invalid edge.");
  for (let edge = 0; edge < edges; edge++)
    if (
      edgeOffsets[edge + 1] < edgeOffsets[edge] ||
      edgeOffsets[edge + 1] > halfedges.length
    )
      throw new Error("Field edge offsets must be bounded and ascending.");
  const seen = new Uint8Array(faceEdges.length);
  for (let edge = 0; edge < edges; edge++) {
    for (
      let index = edgeOffsets[edge];
      index < edgeOffsets[edge + 1];
      index++
    ) {
      const halfedge = halfedges[index];
      if (
        halfedge >= faceEdges.length ||
        seen[halfedge] ||
        faceEdges[halfedge] !== edge
      )
        throw new Error("Field halfedge incidence is inconsistent.");
      seen[halfedge] = 1;
    }
  }

  const distances = new Float32Array(faces).fill(3.4028234663852886e38);
  const predecessorEdges = new Int32Array(faces).fill(-1);
  const links = new Int32Array(faces).fill(-1);
  let head = -1;
  let tail = -1;
  const enqueue = (face: number) => {
    if (links[face] !== -1) return;
    links[face] = -2;
    if (tail < 0) head = face;
    else links[tail] = face;
    tail = face;
  };
  for (let face = 0; face < faces; face++) {
    if (flagged(fixedFaces, face) && !flagged(excludedSeeds, face)) {
      enqueue(face);
      distances[face] = 0;
    }
  }
  if (head < 0 && faces) {
    enqueue(0);
    distances[0] = 0;
  }
  const f = Math.fround;
  while (head >= 0) {
    const face = head;
    head = links[face];
    links[face] = -1;
    if (head === -2) head = tail = -1;
    for (let corner = 0; corner < 3; corner++) {
      const edge = faceEdges[face * 3 + corner];
      const start = edgeOffsets[edge];
      if (edgeOffsets[edge + 1] - start !== 2) continue;
      const left = Math.floor(halfedges[start] / 3);
      const right = Math.floor(halfedges[start + 1] / 3);
      const neighbor = left === face ? right : left;
      const difference = [0, 1, 2].map((axis) =>
        f(centers[face * 3 + axis] - centers[neighbor * 3 + axis]),
      );
      const squares = difference.map((value) => f(value * value));
      const distance = f(Math.sqrt(f(f(squares[0] + squares[1]) + squares[2])));
      const proposed = f(distance + distances[face]);
      if (!Number.isFinite(proposed))
        throw new Error("Field propagation arithmetic overflowed.");
      if (proposed < distances[neighbor]) {
        distances[neighbor] = proposed;
        predecessorEdges[neighbor] = edge;
        enqueue(neighbor);
      }
    }
  }
  const eligibleEdges = new Uint8Array(edges).fill(1);
  for (const edge of predecessorEdges) if (edge >= 0) eligibleEdges[edge] = 0;
  const ids: number[] = [];
  for (let edge = 0; edge < edges; edge++) {
    const start = edgeOffsets[edge];
    if (
      edgeOffsets[edge + 1] - start !== 2 ||
      (flagged(fixedFaces, Math.floor(halfedges[start] / 3)) &&
        flagged(fixedFaces, Math.floor(halfedges[start + 1] / 3)))
    )
      eligibleEdges[edge] = 0;
    if (eligibleEdges[edge]) ids.push(edge);
  }
  return {
    edgeIds: Uint32Array.from(ids),
    eligibleEdges,
    distances,
    predecessorEdges,
  };
}

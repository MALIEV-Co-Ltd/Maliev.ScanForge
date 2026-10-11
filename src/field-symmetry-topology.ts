import type { FieldExclusionBits } from "./field-candidate-lists";
import { buildTriangleAdjacency } from "./field-triangle-adjacency";

export interface SymmetryTopology {
  facePartners: Int32Array;
  edgePartners: Int32Array;
  mappedFaceCount: number;
  faceStatus: Int8Array;
  /** Signed interpretation of the stored native reference-edge byte. */
  referenceEdges: Int8Array;
  /** Direction used by frame production; stored -1 falls back to edge 2. */
  directionEdges: Uint8Array;
}

/** Fresh triangle symmetry cache and reference edges from a supplied vertex mapping. */
export function deriveTriangleSymmetryTopology(
  triangles: Uint32Array,
  vertexPartners: Int32Array,
  vertexMask: FieldExclusionBits = { bits: new Uint8Array(), bitCount: 0 },
): SymmetryTopology {
  const vertices = vertexPartners.length;
  for (const partner of vertexPartners)
    if (partner < -1 || partner >= vertices)
      throw new Error("Symmetry mapping references an invalid vertex.");
  if (
    !Number.isInteger(vertexMask.bitCount) ||
    vertexMask.bitCount < 0 ||
    vertexMask.bitCount > vertices ||
    vertexMask.bits.length * 8 < vertexMask.bitCount
  )
    throw new Error("Symmetry vertex mask dimensions are inconsistent.");
  const adjacency = buildTriangleAdjacency(vertices, triangles);
  const edges = adjacency.edgeVertices.length / 2;
  const faces = triangles.length / 3;
  const facePartners = new Int32Array(faces).fill(-1);
  const edgePartners = new Int32Array(edges).fill(-1);
  const faceStatus = new Int8Array(faces).fill(-1);
  const referenceEdges = new Int8Array(faces);
  const directionEdges = new Uint8Array(faces);
  const vertexEdgeOffsets = new Uint32Array(vertices + 1);
  for (const vertex of adjacency.edgeVertices) vertexEdgeOffsets[vertex + 1]++;
  for (let vertex = 0; vertex < vertices; vertex++)
    vertexEdgeOffsets[vertex + 1] += vertexEdgeOffsets[vertex];
  const vertexEdges = new Uint32Array(adjacency.edgeVertices.length);
  const cursors = vertexEdgeOffsets.slice(0, vertices);
  for (let endpoint = 0; endpoint < adjacency.edgeVertices.length; endpoint++)
    vertexEdges[cursors[adjacency.edgeVertices[endpoint]]++] = Math.floor(
      endpoint / 2,
    );
  // Recovered endpoint-incidence packing and first matching edge lookup.
  const findEdge = (a: number, b: number): number => {
    if (a < 0 || b < 0) return -1;
    for (
      let entry = vertexEdgeOffsets[a];
      entry < vertexEdgeOffsets[a + 1];
      entry++
    ) {
      const edge = vertexEdges[entry];
      if (
        adjacency.edgeVertices[edge * 2] === b ||
        adjacency.edgeVertices[edge * 2 + 1] === b
      )
        return edge;
    }
    return -1;
  };
  const findFace = (a: number, b: number, c: number): number => {
    if (a < 0 || b < 0 || c < 0) return -1;
    const edge = findEdge(a, b);
    if (edge < 0) return -1;
    for (
      let entry = adjacency.edgeOffsets[edge];
      entry < adjacency.edgeOffsets[edge + 1];
      entry++
    ) {
      const face = Math.floor(adjacency.halfedges[entry] / 3);
      const start = face * 3;
      if (
        triangles[start] === c ||
        triangles[start + 1] === c ||
        triangles[start + 2] === c
      )
        return face;
    }
    return -1;
  };
  let mappedFaceCount = 0;
  for (let face = 0; face < faces; face++) {
    if (facePartners[face] !== -1) continue;
    const start = face * 3;
    const partner = findFace(
      vertexPartners[triangles[start]],
      vertexPartners[triangles[start + 1]],
      vertexPartners[triangles[start + 2]],
    );
    if (partner < 0) continue;
    facePartners[face] = partner;
    if (partner === face) mappedFaceCount++;
    else {
      facePartners[partner] = face;
      mappedFaceCount += 2;
    }
  }
  for (let edge = 0; edge < edges; edge++) {
    if (edgePartners[edge] !== -1) continue;
    const partner = findEdge(
      vertexPartners[adjacency.edgeVertices[edge * 2]],
      vertexPartners[adjacency.edgeVertices[edge * 2 + 1]],
    );
    if (partner < 0) continue;
    edgePartners[edge] = partner;
    edgePartners[partner] = edge;
  }
  for (let face = 0; face < faces; face++) {
    let masked = 0,
      unmasked = 0;
    for (let corner = face * 3; corner < face * 3 + 3; corner++) {
      const vertex = triangles[corner];
      if (vertexPartners[vertex] === vertex) continue;
      if (
        vertex < vertexMask.bitCount &&
        vertexMask.bits[vertex >> 3] & (1 << (vertex & 7))
      )
        masked++;
      else unmasked++;
    }
    faceStatus[face] =
      masked > 0 && unmasked === 0
        ? 1
        : masked === 0 && unmasked > 0
          ? 0
          : masked === unmasked && unmasked > 0
            ? 2
            : -1;
    const partner = facePartners[face];
    if (partner < 0 || faceStatus[face] !== 0) continue;
    const partnerEdge = adjacency.faceEdges[partner * 3];
    // Independent safe handling of self-edge sentinels.
    const mappedEdge = partnerEdge < 0 ? -1 : edgePartners[partnerEdge];
    let selected = -1;
    for (let local = 0; local < 3; local++)
      if (adjacency.faceEdges[face * 3 + local] === mappedEdge) {
        selected = local;
        break;
      }
    referenceEdges[face] = selected;
    directionEdges[face] = selected < 0 ? 2 : selected;
  }
  return {
    facePartners,
    edgePartners,
    mappedFaceCount,
    faceStatus,
    referenceEdges,
    directionEdges,
  };
}

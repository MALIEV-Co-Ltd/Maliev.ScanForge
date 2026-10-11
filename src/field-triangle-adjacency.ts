export interface TriangleAdjacency {
  vertexOffsets: Uint32Array;
  vertexHalfedges: Uint32Array;
  faceEdges: Int32Array;
  edgeVertices: Uint32Array;
  edgeOffsets: Uint32Array;
  /** Native-sized storage; only the prefix ending at edgeOffsets[last] is occupied. */
  halfedges: Uint32Array;
}

/** Recovered indexed-triangle incidence and edge-numbering stages. */
export function buildTriangleAdjacency(
  vertexCount: number,
  triangles: Uint32Array,
): TriangleAdjacency {
  if (
    !Number.isSafeInteger(vertexCount) ||
    vertexCount < 0 ||
    vertexCount > 0x7ffffffe ||
    triangles.length % 3 ||
    triangles.length > 0x7fffffff
  )
    throw new Error("Triangle adjacency dimensions are invalid.");
  for (const vertex of triangles)
    if (vertex >= vertexCount)
      throw new Error("Triangle adjacency references an invalid vertex.");
  const vertexOffsets = new Uint32Array(vertexCount + 1);
  for (const vertex of triangles) vertexOffsets[vertex + 1]++;
  for (let vertex = 0; vertex < vertexCount; vertex++)
    vertexOffsets[vertex + 1] += vertexOffsets[vertex];
  const vertexHalfedges = new Uint32Array(triangles.length);
  const cursors = vertexOffsets.slice(0, vertexCount);
  for (let corner = 0; corner < triangles.length; corner++)
    vertexHalfedges[cursors[triangles[corner]]++] = corner;
  const faceEdges = new Int32Array(triangles.length).fill(-1);
  const neighborEdges = new Int32Array(vertexCount).fill(-1);
  let edgeCount = 0;
  const next = [1, 1, -2];
  const previous = [2, -1, -1];
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const firstEdge = edgeCount;
    for (
      let entry = vertexOffsets[vertex];
      entry < vertexOffsets[vertex + 1];
      entry++
    ) {
      const corner = vertexHalfedges[entry];
      const local = corner % 3;
      for (let side = 0; side < 2; side++) {
        const otherCorner =
          corner + (side === 0 ? next[local] : previous[local]);
        const mappedCorner = side === 0 ? corner : otherCorner;
        const other = triangles[otherCorner];
        if (vertex >= other) continue;
        if (neighborEdges[other] < firstEdge)
          neighborEdges[other] = edgeCount++;
        faceEdges[mappedCorner] = neighborEdges[other];
      }
    }
  }
  const edgeVertices = new Uint32Array(edgeCount * 2);
  const assigned = new Uint8Array(edgeCount);
  const edgeOffsets = new Uint32Array(edgeCount + 1);
  for (let corner = 0; corner < triangles.length; corner++) {
    const edge = faceEdges[corner];
    if (edge < 0) continue;
    edgeOffsets[edge + 1]++;
    if (!assigned[edge]) {
      const a = triangles[corner];
      const b = triangles[corner + next[corner % 3]];
      edgeVertices[edge * 2] = Math.min(a, b);
      edgeVertices[edge * 2 + 1] = Math.max(a, b);
      assigned[edge] = 1;
    }
  }
  for (let edge = 0; edge < edgeCount; edge++)
    edgeOffsets[edge + 1] += edgeOffsets[edge];
  const halfedges = new Uint32Array(triangles.length);
  const edgeCursors = edgeOffsets.slice(0, edgeCount);
  for (let corner = 0; corner < triangles.length; corner++) {
    const edge = faceEdges[corner];
    if (edge >= 0) halfedges[edgeCursors[edge]++] = corner;
  }
  return {
    vertexOffsets,
    vertexHalfedges,
    faceEdges,
    edgeVertices,
    edgeOffsets,
    halfedges,
  };
}

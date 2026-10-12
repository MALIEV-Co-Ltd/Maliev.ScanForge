/** Recovered endpoint packing; each endpoint occurrence retains edge-cache order. */
export function buildVertexEdgeIncidence(
  vertexCount: number,
  edgeVertices: Int32Array | Uint32Array,
) {
  if (
    !Number.isSafeInteger(vertexCount) ||
    vertexCount < 0 ||
    vertexCount > 0x7ffffffe ||
    edgeVertices.length % 2 ||
    edgeVertices.length > 0x7fffffff
  )
    throw new Error("Vertex-edge incidence dimensions are invalid.");
  for (const vertex of edgeVertices)
    if (vertex < 0 || vertex >= vertexCount)
      throw new Error("Vertex-edge incidence references an invalid vertex.");
  const vertexEdgeOffsets = new Uint32Array(vertexCount + 1);
  for (const vertex of edgeVertices) vertexEdgeOffsets[vertex + 1]++;
  for (let vertex = 0; vertex < vertexCount; vertex++)
    vertexEdgeOffsets[vertex + 1] += vertexEdgeOffsets[vertex];
  const vertexEdges = new Uint32Array(edgeVertices.length);
  const cursors = vertexEdgeOffsets.slice(0, vertexCount);
  for (let endpoint = 0; endpoint < edgeVertices.length; endpoint++)
    vertexEdges[cursors[edgeVertices[endpoint]]++] = Math.floor(endpoint / 2);
  return { vertexEdgeOffsets, vertexEdges };
}

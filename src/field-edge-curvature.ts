import {
  buildTriangleAdjacency,
  type TriangleAdjacency,
} from "./field-triangle-adjacency";

export interface CurvatureEdgeData {
  adjacency: TriangleAdjacency;
  lengths: Float32Array;
  directions: Float32Array;
  angles: Float32Array;
  /** Six double entries per edge: xx, xy, xz, yy, yz, zz. */
  tensors: Float64Array;
}

/** Fresh triangle edge data from the recovered curvature preparation stage. */
export function buildCurvatureEdgeData(
  positions: Float32Array,
  triangles: Uint32Array,
  faceNormals: Float32Array,
): CurvatureEdgeData {
  if (positions.length % 3 || faceNormals.length !== triangles.length)
    throw new Error("Curvature geometry dimensions are inconsistent.");
  for (const array of [positions, faceNormals])
    for (const value of array)
      if (!Number.isFinite(value))
        throw new Error("Curvature geometry must be finite.");
  const adjacency = buildTriangleAdjacency(positions.length / 3, triangles);
  const edges = adjacency.edgeVertices.length / 2;
  const lengths = new Float32Array(edges);
  const directions = new Float32Array(edges * 3);
  const angles = new Float32Array(edges);
  const tensors = new Float64Array(edges * 6);
  const f = Math.fround;
  for (let edge = 0; edge < edges; edge++) {
    const a = adjacency.edgeVertices[edge * 2] * 3;
    const b = adjacency.edgeVertices[edge * 2 + 1] * 3;
    const dx = positions[a] - positions[b];
    const dy = positions[a + 1] - positions[b + 1];
    const dz = positions[a + 2] - positions[b + 2];
    const length = f(Math.sqrt(dx * dx + dy * dy + dz * dz));
    lengths[edge] = length;
    const vector = edge * 3;
    if (length !== 0) {
      const reciprocal = f(1 / length);
      directions[vector] = f(reciprocal * f(positions[b] - positions[a]));
      directions[vector + 1] = f(
        reciprocal * f(positions[b + 1] - positions[a + 1]),
      );
      directions[vector + 2] = f(
        reciprocal * f(positions[b + 2] - positions[a + 2]),
      );
    }
    const start = adjacency.edgeOffsets[edge];
    if (adjacency.edgeOffsets[edge + 1] - start === 2) {
      const first = adjacency.halfedges[start];
      const second = adjacency.halfedges[start + 1];
      const normalA = Math.floor(first / 3) * 3;
      const normalB = Math.floor(second / 3) * 3;
      const ax = faceNormals[normalA],
        ay = faceNormals[normalA + 1],
        az = faceNormals[normalA + 2];
      const bx = faceNormals[normalB],
        by = faceNormals[normalB + 1],
        bz = faceNormals[normalB + 2];
      const product =
        Math.sqrt(ax * ax + ay * ay + az * az) *
        Math.sqrt(bx * bx + by * by + bz * bz);
      let angle = 0;
      if (product !== 0) {
        const cosine = (bx * ax + by * ay + bz * az) / product;
        if (cosine <= -1) angle = Math.PI;
        else if (cosine < 1) angle = Math.acos(cosine);
      }
      const opposite = (halfedge: number) =>
        triangles[Math.floor(halfedge / 3) * 3 + ((halfedge + 2) % 3)] * 3;
      const oa = opposite(first),
        ob = opposite(second);
      const side =
        (positions[ob + 1] - positions[oa + 1]) * ay +
        (positions[ob] - positions[oa]) * ax +
        (positions[ob + 2] - positions[oa + 2]) * az;
      if (side >= 0) angle = -angle;
      angles[edge] = angle;
    }
    const weight = f(length * angles[edge]);
    const x = directions[vector],
      y = directions[vector + 1],
      z = directions[vector + 2];
    const tensor = edge * 6;
    tensors[tensor] = x * weight * x;
    tensors[tensor + 1] = x * weight * y;
    tensors[tensor + 2] = x * weight * z;
    tensors[tensor + 3] = y * weight * y;
    tensors[tensor + 4] = y * weight * z;
    tensors[tensor + 5] = z * weight * z;
    if (
      !Number.isFinite(length) ||
      !Number.isFinite(weight) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    )
      throw new Error("Curvature edge arithmetic overflowed.");
  }
  return { adjacency, lengths, directions, angles, tensors };
}

/** Boundary constraints precede symmetry-plane constraints; later edges overwrite. */
export function applyCurvatureEdgeConstraints(
  edgeData: CurvatureEdgeData,
  vertexPartners: Int32Array,
  suppliedDirections: Float32Array,
  suppliedFlags: Uint8Array,
  options: { boundaries: boolean; symmetry: boolean },
): { directions: Float32Array; flags: Uint8Array; symmetryApplied: boolean } {
  const { adjacency, directions: edgeDirections } = edgeData;
  const faces = suppliedFlags.length;
  const edges = adjacency.edgeVertices.length / 2;
  if (
    suppliedDirections.length !== faces * 3 ||
    edgeDirections.length !== edges * 3 ||
    adjacency.edgeOffsets.length !== edges + 1
  )
    throw new Error("Curvature constraint dimensions are inconsistent.");
  for (const array of [suppliedDirections, edgeDirections])
    for (const value of array)
      if (!Number.isFinite(value))
        throw new Error("Curvature directions must be finite.");
  for (const partner of vertexPartners)
    if (partner < -1 || partner >= vertexPartners.length)
      throw new Error("Symmetry mapping references an invalid vertex.");
  if (options.symmetry && vertexPartners.length)
    for (const vertex of adjacency.edgeVertices)
      if (vertex >= vertexPartners.length)
        throw new Error("Symmetry mapping does not cover the mesh vertices.");
  for (let edge = 0; edge < edges; edge++) {
    const start = adjacency.edgeOffsets[edge],
      end = adjacency.edgeOffsets[edge + 1];
    if (start > end || end > adjacency.halfedges.length)
      throw new Error("Curvature incidence dimensions are inconsistent.");
    for (let slot = start; slot < end; slot++)
      if (Math.floor(adjacency.halfedges[slot] / 3) >= faces)
        throw new Error("Curvature incidence references an invalid face.");
  }
  const directions = suppliedDirections.slice();
  const flags = suppliedFlags.slice();
  const writeEdge = (edge: number, flag: number) => {
    for (
      let slot = adjacency.edgeOffsets[edge];
      slot < adjacency.edgeOffsets[edge + 1];
      slot++
    ) {
      const face = Math.floor(adjacency.halfedges[slot] / 3);
      directions.set(edgeDirections.subarray(edge * 3, edge * 3 + 3), face * 3);
      flags[face] = flag;
    }
  };
  if (options.boundaries)
    for (let edge = 0; edge < edges; edge++)
      if (adjacency.edgeOffsets[edge + 1] - adjacency.edgeOffsets[edge] < 2)
        writeEdge(edge, 9);
  const symmetryApplied = options.symmetry && vertexPartners.length > 0;
  if (symmetryApplied)
    for (let edge = 0; edge < edges; edge++) {
      const a = adjacency.edgeVertices[edge * 2],
        b = adjacency.edgeVertices[edge * 2 + 1];
      if (vertexPartners[a] === a && vertexPartners[b] === b)
        writeEdge(edge, 13);
    }
  return { directions, flags, symmetryApplied };
}

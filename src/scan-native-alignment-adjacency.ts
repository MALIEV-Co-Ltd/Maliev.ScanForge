import type { MeshProcessingOptions } from "./mesh-processing";

/** Original fresh adjacency bucket worker; spatial bucket assignment and the outer fallback are separate stages. */
export function nativeLinkAlignmentBucket(
  triangles: ArrayLike<number>,
  vertexBuckets: ArrayLike<number>,
  bucket: number,
  options: MeshProcessingOptions = {},
) {
  if (triangles.length % 3 || !Number.isSafeInteger(bucket) || bucket < 0)
    throw new Error("Invalid alignment adjacency bucket.");
  const neighbors = new Int32Array(triangles.length).fill(-1);
  const neighborEdges = new Uint8Array(triangles.length);
  const triangleFlags = new Uint8Array(triangles.length / 3);
  const first = new Map<
    string,
    { face: number; edge: number; consumed: boolean }
  >();
  let recordCount = 0;
  for (let face = 0; face < triangleFlags.length; face++) {
    if (face % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    let included = true;
    for (let edge = 0; edge < 3; edge++) {
      const id = triangles[face * 3 + edge];
      if (!Number.isSafeInteger(id) || id < 0 || id >= vertexBuckets.length)
        throw new Error(
          "Adjacency triangle index is outside the vertex buffer.",
        );
      included &&= vertexBuckets[id] === bucket;
    }
    if (!included) continue;
    for (let edge = 0; edge < 3; edge++) {
      const from = triangles[face * 3 + edge];
      const to = triangles[face * 3 + ((edge + 1) % 3)];
      const reverse = first.get(`${to}:${from}`);
      if (reverse) {
        if (!reverse.consumed) {
          neighbors[reverse.face * 3 + reverse.edge] = face;
          neighborEdges[reverse.face * 3 + reverse.edge] = edge;
          neighbors[face * 3 + edge] = reverse.face;
          neighborEdges[face * 3 + edge] = reverse.edge;
          reverse.consumed = true;
        } else {
          neighbors[face * 3 + edge] = -1;
          neighborEdges[face * 3 + edge] = 255;
        }
        continue;
      }
      recordCount++;
      const key = `${from}:${to}`;
      // Same-direction duplicates are appended natively, but reverse lookup stops at the first record.
      if (!first.has(key)) first.set(key, { face, edge, consumed: false });
    }
    triangleFlags[face] |= 4;
  }
  return { neighbors, neighborEdges, triangleFlags, recordCount };
}

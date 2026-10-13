import type { MeshProcessingOptions } from "./mesh-processing";
import {
  nativeAlignmentBucketTree,
  nativeAlignmentSpatialBucket,
} from "./scan-native-alignment-buckets";

type EdgeRecords = Map<
  string,
  { face: number; edge: number; consumed: boolean }
>;

function linkFace(
  triangles: ArrayLike<number>,
  face: number,
  neighbors: Int32Array,
  neighborEdges: Uint8Array,
  first: EdgeRecords,
) {
  let appended = 0;
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
    appended++;
    const key = `${from}:${to}`;
    // Reverse lookup stops at the first record, even when a later duplicate is unused.
    if (!first.has(key)) first.set(key, { face, edge, consumed: false });
  }
  return appended;
}

/** Fresh global topology rebuild, including native subdivision and cross-bucket fallback. */
export function nativeBuildAlignmentAdjacency(
  vertices: ArrayLike<number>,
  triangles: ArrayLike<number>,
  options: MeshProcessingOptions = {},
) {
  if (vertices.length % 3 || !vertices.length || triangles.length % 3)
    throw new Error("Invalid alignment adjacency geometry.");
  const bounds: [number, number, number, number, number, number] = [
    Infinity,
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  for (let offset = 0; offset < vertices.length; offset++) {
    const value = Math.fround(vertices[offset]);
    if (!Number.isFinite(value)) throw new Error("Invalid alignment vertex.");
    const axis = offset % 3;
    bounds[axis] = Math.min(bounds[axis], value);
    bounds[axis + 3] = Math.max(bounds[axis + 3], value);
  }
  const tree = nativeAlignmentBucketTree(bounds);
  const vertexBuckets = new Uint32Array(vertices.length / 3);
  const point = new Float32Array(3);
  for (let vertex = 0; vertex < vertexBuckets.length; vertex++) {
    if (vertex % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    for (let axis = 0; axis < 3; axis++)
      point[axis] = vertices[vertex * 3 + axis];
    vertexBuckets[vertex] = nativeAlignmentSpatialBucket(
      point,
      tree.centers,
      tree.children,
      1.1920928955078125e-7,
    );
  }
  const neighbors = new Int32Array(triangles.length).fill(-1);
  const neighborEdges = new Uint8Array(triangles.length);
  const triangleFlags = new Uint8Array(triangles.length / 3);
  const groups = new Map<number, number[]>();
  const fallback: number[] = [];
  for (let face = 0; face < triangleFlags.length; face++) {
    for (let edge = 0; edge < 3; edge++) {
      const id = triangles[face * 3 + edge];
      if (!Number.isSafeInteger(id) || id < 0 || id >= vertexBuckets.length)
        throw new Error(
          "Adjacency triangle index is outside the vertex buffer.",
        );
    }
    const bucket = vertexBuckets[triangles[face * 3]];
    if (
      vertexBuckets[triangles[face * 3 + 1]] === bucket &&
      vertexBuckets[triangles[face * 3 + 2]] === bucket
    ) {
      const group = groups.get(bucket) ?? [];
      if (!groups.has(bucket)) groups.set(bucket, group);
      group.push(face);
    } else fallback.push(face);
  }
  const first: EdgeRecords = new Map();
  let recordCount = 0;
  for (const bucket of Array.from(groups.keys()).sort((a, b) => a - b)) {
    for (const face of groups.get(bucket)!) {
      recordCount += linkFace(triangles, face, neighbors, neighborEdges, first);
      triangleFlags[face] |= 4;
    }
  }
  for (const face of fallback) {
    if (face % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    recordCount += linkFace(triangles, face, neighbors, neighborEdges, first);
  }
  return {
    bounds,
    vertexBuckets,
    neighbors,
    neighborEdges,
    triangleFlags,
    recordCount,
    adjacencyValid: true,
  };
}

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
  const first: EdgeRecords = new Map();
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
    recordCount += linkFace(triangles, face, neighbors, neighborEdges, first);
    triangleFlags[face] |= 4;
  }
  return { neighbors, neighborEdges, triangleFlags, recordCount };
}

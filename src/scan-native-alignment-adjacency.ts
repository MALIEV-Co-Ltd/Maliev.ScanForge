import type { MeshProcessingOptions } from "./mesh-processing";
import {
  nativeTargetStorage,
  nativeScratchStorage,
  releaseNativeScratch,
} from "./scan-native-target-storage";
import {
  createNativeAlignmentEdgeRecords,
  type NativeAlignmentEdgeRecords,
} from "./scan-native-edge-records";
import {
  nativeAlignmentBucketTree,
  nativeAlignmentSpatialBucket,
} from "./scan-native-alignment-buckets";

function linkFace(
  triangles: ArrayLike<number>,
  face: number,
  neighbors: Int32Array,
  neighborEdges: Uint8Array,
  first: NativeAlignmentEdgeRecords,
  masks?: Uint8Array,
) {
  let appended = 0;
  for (let edge = 0; edge < 3; edge++) {
    const from = triangles[face * 3 + edge];
    const to = triangles[face * 3 + ((edge + 1) % 3)];
    const reverse = first.get(to, from);
    if (reverse !== undefined) {
      if (reverse >= 0) {
        if (masks) {
          masks[Math.floor(reverse / 3)] |= 1 << (reverse % 3);
          masks[face] |= 1 << edge;
        } else {
          neighbors[reverse] = face;
          neighborEdges[reverse] = edge;
          neighbors[face * 3 + edge] = Math.floor(reverse / 3);
          neighborEdges[face * 3 + edge] = reverse % 3;
        }
        first.set(to, from, -reverse - 1);
      } else if (!masks) {
        neighbors[face * 3 + edge] = -1;
        neighborEdges[face * 3 + edge] = 255;
      }
      continue;
    }
    appended++;
    // Reverse lookup stops at the first record, even when a later duplicate is unused.
    first.remember(from, to, face * 3 + edge);
  }
  return appended;
}

/** Fresh global topology rebuild, including native subdivision and cross-bucket fallback. */
export function nativeBuildAlignmentAdjacency(
  vertices: ArrayLike<number>,
  triangles: ArrayLike<number>,
  options: MeshProcessingOptions = {},
) {
  return buildAlignmentAdjacency(vertices, triangles, options);
}

/** Query arbitration needs pointer presence only, not neighbor IDs/edge metadata.
 * Keep original bucket traversal and first-directed-edge consumption ordering.
 */
export function nativeBuildAlignmentNeighbourMasks(
  vertices: ArrayLike<number>,
  triangles: ArrayLike<number>,
  options: MeshProcessingOptions = {},
): Uint8Array {
  if (vertices.length % 3 || !vertices.length || triangles.length % 3)
    throw new Error("Invalid alignment adjacency geometry.");
  if (options.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  const masks = new Uint8Array(
    nativeTargetStorage(vertices, triangles.length / 3),
  );
  buildMaskAdjacency(vertices, triangles, options, masks);
  return masks;
}

/** Same ascending bucket/face order and final cross-bucket pass as the native
 * linker. A counting partition replaces per-face JavaScript group arrays. */
function buildMaskAdjacency(
  vertices: ArrayLike<number>,
  triangles: ArrayLike<number>,
  options: MeshProcessingOptions,
  masks: Uint8Array,
) {
  const buffers: ArrayBuffer[] = [];
  let first: NativeAlignmentEdgeRecords | undefined;
  const storage = (bytes: number) => {
    const buffer = nativeScratchStorage(bytes);
    buffers.push(buffer);
    return buffer;
  };
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  try {
    const bounds = [
      Infinity,
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
      -Infinity,
    ];
    for (let i = 0; i < vertices.length; i++) {
      if (i % 12288 === 0) check();
      const value = Math.fround(vertices[i]);
      if (!Number.isFinite(value)) throw Error("Invalid alignment vertex.");
      bounds[i % 3] = Math.min(bounds[i % 3], value);
      bounds[(i % 3) + 3] = Math.max(bounds[(i % 3) + 3], value);
    }
    const tree = nativeAlignmentBucketTree(bounds);
    const buckets = new Uint32Array(storage((vertices.length / 3) * 4));
    const used = new Uint32Array(storage(Math.ceil(buckets.length / 32) * 4));
    const point = new Float32Array(storage(12));
    for (let vertex = 0; vertex < buckets.length; vertex++) {
      if (vertex % 4096 === 0) check();
      for (let axis = 0; axis < 3; axis++)
        point[axis] = vertices[vertex * 3 + axis];
      buckets[vertex] = nativeAlignmentSpatialBucket(
        point,
        tree.centers,
        tree.children,
        1.1920928955078125e-7,
      );
      if (buckets[vertex] >= 512)
        throw Error("Invalid alignment spatial bucket.");
    }
    const counts = new Uint32Array(storage(513 * 4));
    const offsets = new Uint32Array(storage(514 * 4));
    const cursors = new Uint32Array(storage(513 * 4));
    const faceBuckets = new Uint16Array(storage(masks.length * 2));
    let usedVertices = 0;
    for (let face = 0; face < masks.length; face++) {
      if (face % 4096 === 0) check();
      for (let edge = 0; edge < 3; edge++) {
        const id = triangles[face * 3 + edge];
        if (!Number.isSafeInteger(id) || id < 0 || id >= buckets.length)
          throw Error("Adjacency triangle index is outside the vertex buffer.");
        const word = Math.floor(id / 32),
          bit = 1 << (id & 31);
        if (!(used[word] & bit)) {
          used[word] |= bit;
          usedVertices++;
        }
      }
      const a = buckets[triangles[face * 3]],
        b = buckets[triangles[face * 3 + 1]],
        c = buckets[triangles[face * 3 + 2]];
      const bucket = a === b && a === c ? a : 512;
      faceBuckets[face] = bucket;
      counts[bucket]++;
    }
    for (let bucket = 0; bucket < 513; bucket++)
      offsets[bucket + 1] = offsets[bucket] + counts[bucket];
    cursors.set(offsets.subarray(0, 513));
    const order = new Uint32Array(storage(masks.length * 4));
    for (let face = 0; face < masks.length; face++) {
      if (face % 4096 === 0) check();
      order[cursors[faceBuckets[face]]++] = face;
    }
    // Retire partition-only storage before reserving the directed-edge table.
    for (const value of [
      used,
      counts,
      cursors,
      faceBuckets,
      point,
      offsets,
      buckets,
    ])
      releaseNativeScratch(value.buffer);
    first = createNativeAlignmentEdgeRecords(
      vertices.length / 3,
      triangles.length,
      {
        signal: options.signal,
        expectedEntries: Math.min(triangles.length, usedVertices * 3),
        dense: true,
      },
    );
    const neighbors = new Int32Array(),
      neighborEdges = new Uint8Array();
    for (let slot = 0; slot < order.length; slot++) {
      if (slot % 4096 === 0) check();
      linkFace(triangles, order[slot], neighbors, neighborEdges, first, masks);
    }
  } finally {
    first?.dispose();
    for (const buffer of buffers) releaseNativeScratch(buffer);
  }
}

function buildAlignmentAdjacency(
  vertices: ArrayLike<number>,
  triangles: ArrayLike<number>,
  options: MeshProcessingOptions,
  masks?: Uint8Array,
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
  const neighbors = new Int32Array(masks ? 0 : triangles.length).fill(-1);
  const neighborEdges = new Uint8Array(masks ? 0 : triangles.length);
  const triangleFlags = new Uint8Array(masks ? 0 : triangles.length / 3);
  const groups = new Map<number, number[]>();
  const fallback: number[] = [];
  const used = new Uint32Array(Math.ceil(vertexBuckets.length / 32));
  let usedVertices = 0;
  for (let face = 0; face < triangles.length / 3; face++) {
    for (let edge = 0; edge < 3; edge++) {
      const id = triangles[face * 3 + edge];
      if (!Number.isSafeInteger(id) || id < 0 || id >= vertexBuckets.length)
        throw new Error(
          "Adjacency triangle index is outside the vertex buffer.",
        );
      const word = Math.floor(id / 32),
        bit = 1 << (id & 31);
      if (!(used[word] & bit)) {
        used[word] |= bit;
        usedVertices++;
      }
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
  const first = createNativeAlignmentEdgeRecords(
    vertexBuckets.length,
    triangles.length,
    {
      signal: options.signal,
      expectedEntries: Math.min(triangles.length, usedVertices * 3),
    },
  );
  try {
    let recordCount = 0;
    for (const bucket of Array.from(groups.keys()).sort((a, b) => a - b)) {
      for (const face of groups.get(bucket)!) {
        recordCount += linkFace(
          triangles,
          face,
          neighbors,
          neighborEdges,
          first,
          masks,
        );
        if (!masks) triangleFlags[face] |= 4;
      }
    }
    for (const face of fallback) {
      if (face % 4096 === 0 && options.signal?.aborted)
        throw new DOMException("Mesh operation cancelled.", "AbortError");
      recordCount += linkFace(
        triangles,
        face,
        neighbors,
        neighborEdges,
        first,
        masks,
      );
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
  } finally {
    first.dispose();
  }
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
  const first = createNativeAlignmentEdgeRecords(
    vertexBuckets.length,
    triangles.length,
    options,
  );
  try {
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
  } finally {
    first.dispose();
  }
}

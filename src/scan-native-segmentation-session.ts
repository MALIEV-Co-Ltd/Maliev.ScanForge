import { nativeBuildAlignmentAdjacency } from "./scan-native-alignment-adjacency";
import { noiseNormals } from "./scan-native-noise";
import { nativeSegmentationScores } from "./scan-native-segmentation-scores";
import { nativeSegmentationRegions } from "./scan-native-segmentation-regions";

/** The native worker reuses the low score word for bucket IDs. Updating a
 * minimum can consume that tag, so adjacency's processed flags cannot be reused.
 * Grouping candidate faces avoids the original per-bucket full-face scans.
 */
function preparationFlags(
  normals: Float32Array,
  triangles: Uint32Array,
  buckets: Uint32Array,
  check: (i: number) => void,
) {
  const working = new Float64Array(buckets.length);
  working.fill(3.4028234663852886e38);
  const words = new Uint32Array(working.buffer);
  for (let i = 0; i < buckets.length; i++) {
    check(i);
    words[i * 2] = buckets[i];
  }
  const groups = new Map<number, number[]>();
  for (let face = 0; face < triangles.length / 3; face++) {
    check(face);
    const bucket = buckets[triangles[face * 3]];
    if (
      buckets[triangles[face * 3 + 1]] !== bucket ||
      buckets[triangles[face * 3 + 2]] !== bucket
    )
      continue;
    const group = groups.get(bucket) ?? [];
    if (!groups.has(bucket)) groups.set(bucket, group);
    group.push(face);
  }
  const flags = new Uint8Array(triangles.length / 3);
  const pair = (a: number, b: number) => {
    const x = a * 3,
      y = b * 3;
    const value =
      normals[x] * normals[y] +
      normals[x + 1] * normals[y + 1] +
      normals[x + 2] * normals[y + 2];
    if (value < working[a]) working[a] = value;
    if (value < working[b]) working[b] = value;
  };
  let visited = 0;
  for (const bucket of Array.from(groups.keys()).sort((a, b) => a - b))
    for (const face of groups.get(bucket)!) {
      check(visited++);
      const a = triangles[face * 3],
        b = triangles[face * 3 + 1],
        c = triangles[face * 3 + 2];
      if (
        words[a * 2] !== bucket ||
        words[b * 2] !== bucket ||
        words[c * 2] !== bucket
      )
        continue;
      pair(b, a);
      pair(c, b);
      pair(c, a);
      flags[face] |= 4;
    }
  return flags;
}

/** Owned, fresh-geometry preparation. Threshold changes reuse adjacency and scores.
 * Default vertex flags are zero; flagged orphan-retention is outside this adapter.
 */
export function prepareNativeSegmentationSession(
  mesh: {
    vertices: Float32Array;
    triangles: Uint32Array;
    normals?: Float32Array;
  },
  options: { signal?: AbortSignal; capDegrees?: number } = {},
) {
  const check = (i: number) => {
    if (i % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Segmentation cancelled.", "AbortError");
  };
  const count = mesh.vertices.length / 3;
  check(0);
  if (
    mesh.vertices.length % 3 ||
    mesh.triangles.length % 3 ||
    (mesh.normals && mesh.normals.length !== mesh.vertices.length)
  )
    throw new Error("Invalid segmentation mesh buffers.");
  const used = new Uint8Array(count);
  for (let i = 0; i < mesh.vertices.length; i++) {
    check(i);
    if (
      !Number.isFinite(mesh.vertices[i]) ||
      (mesh.normals && !Number.isFinite(mesh.normals[i]))
    )
      throw new Error("Segmentation coordinates and normals must be finite.");
  }
  for (let i = 0; i < mesh.triangles.length; i++) {
    check(i);
    if (mesh.triangles[i] >= count)
      throw new Error("Triangle index is outside the vertex buffer.");
    used[mesh.triangles[i]] = 1;
  }
  // Import finalization precedes score compaction. Keep its adjacency and
  // original cached bounds/buckets, including bounds contributed by orphans.
  const adjacency = mesh.vertices.length
    ? nativeBuildAlignmentAdjacency(mesh.vertices, mesh.triangles, options)
    : { neighbors: new Int32Array(), vertexBuckets: new Uint32Array() };
  const sourceNormals =
    mesh.normals ??
    noiseNormals(
      { vertices: Float64Array.from(mesh.vertices), triangles: mesh.triangles },
      options,
    );
  const sourceVertexIds = new Uint32Array(
    used.reduce((sum, value) => sum + value, 0),
  );
  const remap = new Uint32Array(count);
  const vertices = new Float32Array(sourceVertexIds.length * 3);
  const normals = new Float32Array(vertices.length);
  const vertexBuckets = new Uint32Array(sourceVertexIds.length);
  for (let source = 0, target = 0; source < count; source++) {
    check(source);
    if (!used[source]) continue;
    remap[source] = target;
    sourceVertexIds[target] = source;
    vertices.set(
      mesh.vertices.subarray(source * 3, source * 3 + 3),
      target * 3,
    );
    normals.set(sourceNormals.subarray(source * 3, source * 3 + 3), target * 3);
    vertexBuckets[target] = adjacency.vertexBuckets[source];
    target++;
  }
  const triangles = new Uint32Array(mesh.triangles.length);
  for (let i = 0; i < triangles.length; i++) {
    check(i);
    triangles[i] = remap[mesh.triangles[i]];
  }
  const scores = nativeSegmentationScores(normals, triangles, options);
  const faceFlags = preparationFlags(normals, triangles, vertexBuckets, check);
  return {
    vertices,
    triangles,
    normals,
    scores,
    sourceVertexIds,
    neighbors: adjacency.neighbors,
    classify(threshold: number, signal?: AbortSignal) {
      return nativeSegmentationRegions(scores, triangles, adjacency.neighbors, {
        threshold,
        signal: signal ?? options.signal,
        faceFlags,
      });
    },
  };
}

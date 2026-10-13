import {
  NativeStlVertexTable,
  nativeStlCoordinateKey,
} from "./scan-native-stl-vertices";

export interface NativeStlSpatialNode {
  bounds: number[];
  midpoint: number[];
  children: NativeStlSpatialNode[];
}

function makeNode(bounds: number[], depth: number): NativeStlSpatialNode {
  const midpoint = [0, 1, 2].map((axis) =>
    Math.fround(Math.fround(bounds[axis] + bounds[axis + 3]) * 0.5),
  );
  const children: NativeStlSpatialNode[] = [];
  if (depth)
    for (let octant = 0; octant < 8; octant++) {
      const lower = [0, 1, 2].map((axis) =>
        octant & (1 << axis) ? midpoint[axis] : bounds[axis],
      );
      const upper = [0, 1, 2].map((axis) =>
        octant & (1 << axis) ? bounds[axis + 3] : midpoint[axis],
      );
      children.push(makeNode([...lower, ...upper], depth - 1));
    }
  return { bounds, midpoint, children };
}

/** Original optimized reader uses two subdivisions, hence three octant digits. */
export function nativeStlSpatialTree(coordinates: Float32Array) {
  if (!coordinates.length || coordinates.length % 3)
    throw new Error("STL spatial coordinates require complete vertices.");
  const lower = [Infinity, Infinity, Infinity];
  const upper = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < coordinates.length; i++) {
    const value = coordinates[i];
    if (!Number.isFinite(value))
      throw new Error("STL coordinates must be finite.");
    const axis = i % 3;
    lower[axis] = Math.min(lower[axis], value);
    upper[axis] = Math.max(upper[axis], value);
  }
  return makeNode([...lower, ...upper], 2);
}

/** Preserve native asymmetric axis tests and Float32 epsilon addition. */
export function nativeStlSpatialBucket(
  tree: NativeStlSpatialNode,
  x: number,
  y: number,
  z: number,
) {
  let node = tree;
  let bucket = 0;
  for (;;) {
    const octant =
      (x >= Math.fround(node.midpoint[0] + 1.1920928955078125e-7) ? 1 : 0) |
      (y < Math.fround(node.midpoint[1] + 1.1920928955078125e-7) ? 2 : 0) |
      (z < Math.fround(node.midpoint[2] + 1.1920928955078125e-7) ? 4 : 0);
    bucket = bucket * 8 + octant;
    if (!node.children.length) return bucket;
    node = node.children[octant];
  }
}

/** Reconstruct optimized binary STL connectivity, preserving native vertex order.
 * Process spatial buckets independently to bound live hash-table allocations.
 * This is not the ASCII/fallback STL path.
 */
export function nativeStlTopology(
  coordinates: Float32Array,
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {},
) {
  function progress(fraction: number) {
    if (options.signal?.aborted)
      throw new DOMException("Import cancelled", "AbortError");
    options.onProgress?.(fraction);
    if (options.signal?.aborted)
      throw new DOMException("Import cancelled", "AbortError");
  }
  progress(0);
  if (!coordinates.length || coordinates.length % 9)
    throw new Error("STL topology requires complete facets.");
  const tree = nativeStlSpatialTree(coordinates);
  progress(0.1);
  const cornerCount = coordinates.length / 3;
  if (cornerCount > 0x7fffffff)
    throw new Error("STL topology exceeds the spatial index capacity.");
  const heads = new Int32Array(512).fill(-1);
  const tails = new Int32Array(512).fill(-1);
  const next = new Int32Array(cornerCount).fill(-1);
  for (let corner = 0; corner < cornerCount; corner++) {
    if (corner % 16_384 === 0) progress(0.1 + (corner / cornerCount) * 0.2);
    const offset = corner * 3;
    const bucket = nativeStlSpatialBucket(
      tree,
      coordinates[offset],
      coordinates[offset + 1],
      coordinates[offset + 2],
    );
    if (tails[bucket] < 0) heads[bucket] = corner;
    else next[tails[bucket]] = corner;
    tails[bucket] = corner;
  }
  const representatives = new Uint32Array(cornerCount);
  const mappedCorners = new Uint32Array(cornerCount);
  const vertices = new Float32Array(coordinates.length);
  let vertexCount = 0;
  for (let bucket = 0; bucket < heads.length; bucket++) {
    progress(0.3 + (bucket / heads.length) * 0.6);
    if (heads[bucket] < 0) continue;
    const table = new NativeStlVertexTable();
    for (let corner = heads[bucket]; corner >= 0; corner = next[corner]) {
      if (corner % 16_384 === 0 && options.signal?.aborted)
        throw new DOMException("Import cancelled", "AbortError");
      const offset = corner * 3;
      representatives[corner] = table.insert(
        [
          nativeStlCoordinateKey(coordinates[offset]),
          nativeStlCoordinateKey(coordinates[offset + 1]),
          nativeStlCoordinateKey(coordinates[offset + 2]),
        ],
        corner,
      ).value;
    }
    const globalIds = new Map<number, number>();
    for (const entry of table.entries()) {
      globalIds.set(entry.value, vertexCount);
      const source = entry.value * 3;
      vertices.set(coordinates.subarray(source, source + 3), vertexCount++ * 3);
    }
    for (let corner = heads[bucket]; corner >= 0; corner = next[corner])
      mappedCorners[corner] = globalIds.get(representatives[corner])!;
  }
  // Original facet constructor rejects repeated vertex identities only.
  const triangles = new Uint32Array(cornerCount);
  let count = 0;
  for (let i = 0; i < cornerCount; i += 3) {
    if (i % 49_152 === 0) progress(0.9 + (i / cornerCount) * 0.1);
    const a = mappedCorners[i],
      b = mappedCorners[i + 1],
      c = mappedCorners[i + 2];
    if (a !== b && a !== c && b !== c) {
      triangles[count++] = a;
      triangles[count++] = b;
      triangles[count++] = c;
    }
  }
  const result = {
    vertices: vertices.slice(0, vertexCount * 3),
    triangles: triangles.slice(0, count),
  };
  progress(1);
  return result;
}

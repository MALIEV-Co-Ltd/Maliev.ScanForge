import type { MeshProcessingOptions } from "./mesh-processing";
import {
  prepareIndexedNoiseOctree,
  type NoiseTreeNode,
} from "./scan-noise-octree";
import type { NoiseBounds } from "./scan-noise-octree-query";
import { nativeGlobalEvaluatorExtent } from "./scan-native-global-evaluator-policy";
import type {
  NativeGlobalEvaluatorSearchNode,
  NativeGlobalEvaluatorSearchScratch,
} from "./scan-native-global-evaluator-query";
import { nativeGlobalPackedEvaluator } from "./scan-native-global-packed-evaluator";

function check(options: MeshProcessingOptions) {
  if (options.signal?.aborted)
    throw new DOMException("Evaluator preparation cancelled.", "AbortError");
}
/** Original main-image facet task, distinct from the companion polygon cache. */
export function nativeGlobalFacetNormals(
  vertices: Float32Array,
  triangles: Uint32Array,
  options: MeshProcessingOptions = {},
) {
  check(options);
  if (
    !(vertices instanceof Float32Array) ||
    vertices.length % 3 ||
    !(triangles instanceof Uint32Array) ||
    triangles.length % 3
  )
    throw Error("Invalid evaluator geometry dimensions.");
  for (let i = 0; i < vertices.length; i++) {
    if (i % 12288 === 0) check(options);
    if (!Number.isFinite(vertices[i]))
      throw Error("Evaluator coordinates must be finite.");
  }
  for (let i = 0; i < triangles.length; i++) {
    if (i % 12288 === 0) check(options);
    if (triangles[i] >= vertices.length / 3)
      throw Error("Evaluator triangle references an invalid vertex.");
  }
  const normals = new Float32Array(triangles.length),
    degenerate = new Uint8Array(triangles.length / 3);
  for (let face = 0; face < degenerate.length; face++) {
    if (face % 4096 === 0) check(options);
    const slot = face * 3,
      a = triangles[slot] * 3,
      b = triangles[slot + 1] * 3,
      c = triangles[slot + 2] * 3;
    const ux = vertices[b] - vertices[a],
      uy = vertices[b + 1] - vertices[a + 1],
      uz = vertices[b + 2] - vertices[a + 2],
      vx = vertices[c] - vertices[a],
      vy = vertices[c + 1] - vertices[a + 1],
      vz = vertices[c + 2] - vertices[a + 2];
    let x = vz * uy - vy * uz,
      y = vx * uz - vz * ux,
      z = vy * ux - vx * uy;
    const length = Math.sqrt(x * x + y * y + z * z);
    degenerate[face] = length <= Number.EPSILON ? 1 : 0;
    if (length > Number.EPSILON) {
      const denominator = Math.fround(length);
      x /= denominator;
      y /= denominator;
      z /= denominator;
    }
    normals[slot] = x;
    normals[slot + 1] = y;
    normals[slot + 2] = z;
  }
  check(options);
  return { normals, degenerate };
}

export interface NativeGlobalEvaluatorMesh {
  vertices: Float32Array;
  triangles: Uint32Array;
  flags?: Uint8Array;
  cachedBounds?: ArrayLike<number>;
  minimumExtent?: number;
  maximumDepth?: number;
  filterHidden?: boolean;
}
export interface NativeGlobalEvaluatorIndexNode extends NativeGlobalEvaluatorSearchNode<number> {
  inverse: readonly [number, number, number];
  depth: number;
  triangles: Uint32Array;
  children: Partial<Record<number, NativeGlobalEvaluatorIndexNode>>;
}
const prepared = new WeakMap<
  NativeGlobalEvaluatorMesh,
  ReturnType<typeof prepare>
>();
const emptyIds = new Uint32Array();
const maximum = Math.fround(3.4028234663852886e38);
/** Every mesh/configuration carrier is immutable. A pose is deliberately not part
 * of this key. Only complete preparation is cached; each worker owns its cache.
 */
export function prepareNativeGlobalMeshEvaluator(
  input: NativeGlobalEvaluatorMesh,
  options: MeshProcessingOptions = {},
) {
  check(options);
  const existing = prepared.get(input);
  if (existing) return existing;
  const result = prepare(input, options);
  check(options);
  prepared.set(input, result);
  return result;
}
function prepare(
  input: NativeGlobalEvaluatorMesh,
  options: MeshProcessingOptions,
) {
  const { vertices, triangles, flags } = input;
  const filterHidden = !!input.filterHidden;
  if (
    flags &&
    (!(flags instanceof Uint8Array) || flags.length !== triangles.length / 3)
  )
    throw Error("Invalid evaluator flags.");
  const { normals, degenerate } = nativeGlobalFacetNormals(
    vertices,
    triangles,
    options,
  );
  const meshBounds: number[] = [
    maximum,
    maximum,
    maximum,
    -maximum,
    -maximum,
    -maximum,
  ];
  for (let i = 0; i < vertices.length; i += 3) {
    if (i % 12288 === 0) check(options);
    for (let axis = 0; axis < 3; axis++) {
      const v = vertices[i + axis];
      if (v < meshBounds[axis]) meshBounds[axis] = v;
      if (meshBounds[axis + 3] < v) meshBounds[axis + 3] = v;
    }
  }
  if (input.cachedBounds) {
    if (input.cachedBounds.length !== 6)
      throw Error("Invalid cached evaluator bounds.");
    for (let i = 0; i < 6; i++)
      meshBounds[i] = Math.fround(input.cachedBounds[i]);
  }
  const minimumExtent =
      input.minimumExtent ?? nativeGlobalEvaluatorExtent(meshBounds),
    maximumDepth = input.maximumDepth ?? 10;
  if (
    !Number.isFinite(minimumExtent) ||
    minimumExtent < 0 ||
    !Number.isInteger(maximumDepth) ||
    maximumDepth < 1 ||
    maximumDepth > 10
  )
    throw Error("Invalid evaluator subdivision limits.");
  const bounds = new Float32Array(triangles.length * 2);
  let admitted = 0;
  for (let face = 0; face < triangles.length / 3; face++) {
    if (face % 4096 === 0) check(options);
    if (!filterHidden || !flags || !(flags[face] & 2)) admitted++;
    for (let axis = 0; axis < 3; axis++) {
      let lo = vertices[triangles[face * 3] * 3 + axis],
        hi = lo;
      for (let corner = 1; corner < 3; corner++) {
        const v = vertices[triangles[face * 3 + corner] * 3 + axis];
        if (v < lo) lo = v;
        if (hi < v) hi = v;
      }
      bounds[face * 6 + axis] = lo;
      bounds[face * 6 + axis + 3] = hi;
    }
  }
  const surface = { vertices, triangles, normals, bounds, flags };
  const provider = nativeGlobalPackedEvaluator(surface);
  let root: NativeGlobalEvaluatorIndexNode | undefined;
  if (
    admitted &&
    (filterHidden ||
      (meshBounds.every(Number.isFinite) &&
        [0, 1, 2].every(
          (axis) =>
            -maximum < meshBounds[axis] &&
            meshBounds[axis] <= meshBounds[axis + 3] &&
            meshBounds[axis + 3] < maximum,
        )))
  ) {
    let indices = triangles,
      ids: Uint32Array | undefined;
    if (admitted !== triangles.length / 3) {
      ids = new Uint32Array(admitted);
      indices = new Uint32Array(admitted * 3);
      let slot = 0;
      for (let face = 0; face < triangles.length / 3; face++) {
        if (face % 4096 === 0) check(options);
        if (flags![face] & 2) continue;
        ids[slot] = face;
        for (let corner = 0; corner < 3; corner++)
          indices[slot * 3 + corner] = triangles[face * 3 + corner];
        slot++;
      }
    }
    const tree = prepareIndexedNoiseOctree(
      {
        coordinates: vertices,
        indices,
        triangleBounds: bounds,
        boundsIds: ids,
      },
      minimumExtent,
      maximumDepth,
      options,
      filterHidden ? undefined : (meshBounds as unknown as NoiseBounds),
    );
    const originalId = (id: number) => (ids ? ids[id] : id);
    const convert = (node: NoiseTreeNode): NativeGlobalEvaluatorIndexNode => {
      check(options);
      // This newly built tree is exclusively owned here. Promote its leaf lists
      // in place instead of duplicating the complete node graph for the query.
      const result = node as unknown as NativeGlobalEvaluatorIndexNode;
      result.flat = !!node.mode;
      result.triangles = node.triangles.length
        ? Uint32Array.from(node.triangles, originalId)
        : emptyIds;
      for (let id = 0; id < 8; id++) {
        const child = node.children[id];
        if (child) result.children[id] = convert(child);
      }
      return result;
    };
    root = convert(tree.root);
  }
  check(options);
  return {
    root,
    surface,
    degenerate,
    minimumExtent,
    query(
      point: ArrayLike<number>,
      distance: Float64Array,
      projection: Float64Array,
      edgeFlags: Uint8Array,
      scratch: NativeGlobalEvaluatorSearchScratch<number>,
    ) {
      if (!root) {
        scratch.stack.length = 0;
        return undefined;
      }
      return provider.query(
        root,
        point,
        distance,
        projection,
        edgeFlags,
        filterHidden,
        scratch,
      );
    },
  };
}

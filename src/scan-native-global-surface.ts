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
import {
  nativeGlobalPackedEvaluator,
  type NativeGlobalPackedEvaluatorSurface,
} from "./scan-native-global-packed-evaluator";
import { nativeTargetStorage } from "./scan-native-target-storage";
import {
  packNativeGlobalEvaluatorIndex,
  validateNativeGlobalPackedIndex,
  type NativeGlobalPackedIndex,
  type NativeGlobalPackedIndexScratch,
} from "./scan-native-global-packed-index";

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
  const normals = new Float32Array(
      nativeTargetStorage(vertices, triangles.length * 4),
    ),
    degenerate = new Uint8Array(
      nativeTargetStorage(vertices, triangles.length / 3),
    );
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
  /** Internal storage policy; source geometry and query arithmetic are unchanged. */
  compactBounds?: boolean;
  /** Internal shared metadata policy; native graph ordering remains unchanged. */
  packedNodes?: boolean;
}
export interface NativeGlobalEvaluatorIndexNode extends NativeGlobalEvaluatorSearchNode<number> {
  inverse: readonly [number, number, number];
  depth: number;
  triangles: Uint32Array;
  children: Partial<Record<number, NativeGlobalEvaluatorIndexNode>>;
}
export interface NativeGlobalMeshEvaluatorData {
  root?: NativeGlobalEvaluatorIndexNode;
  packedIndex?: NativeGlobalPackedIndex;
  surface: NativeGlobalPackedEvaluatorSurface;
  degenerate: Uint8Array;
  minimumExtent: number;
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
  if (input.packedNodes !== undefined && typeof input.packedNodes !== "boolean")
    throw Error("Invalid evaluator node storage policy.");
  if (
    input.compactBounds !== undefined &&
    typeof input.compactBounds !== "boolean"
  )
    throw Error("Invalid evaluator bound storage policy.");
  // Cached queries remain the fast default. A memory-admitted caller may opt
  // into compact bounds; deriving them trades throughput for retained storage.
  const compactBounds = input.compactBounds ?? false;
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
  const bounds = new Float32Array(
    compactBounds
      ? new ArrayBuffer(triangles.length * 8)
      : nativeTargetStorage(vertices, triangles.length * 8),
  );
  let root: NativeGlobalEvaluatorIndexNode | undefined;
  try {
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
      const countMembers = (node: NoiseTreeNode): number => {
        check(options);
        let count = node.triangles.length;
        for (let id = 0; id < 8; id++)
          if (node.children[id]) count += countMembers(node.children[id]!);
        return count;
      };
      const count = countMembers(tree.root);
      if (!Number.isSafeInteger(count) || count > 0xffffffff)
        throw RangeError("Evaluator membership capacity exceeded.");
      const memberships = new Uint32Array(
        nativeTargetStorage(vertices, count * 4),
      );
      let cursor = 0;
      const convert = (node: NoiseTreeNode): NativeGlobalEvaluatorIndexNode => {
        check(options);
        // This newly built tree is exclusively owned here. Promote its leaf lists
        // in place instead of duplicating the complete node graph for the query.
        const result = node as unknown as NativeGlobalEvaluatorIndexNode;
        result.flat = !!node.mode;
        const sourceIds = node.triangles;
        result.triangles = sourceIds.length
          ? memberships.subarray(cursor, cursor + sourceIds.length)
          : emptyIds;
        cursor += sourceIds.length;
        for (let slot = 0; slot < sourceIds.length; slot++)
          result.triangles[slot] = originalId(sourceIds[slot]);
        for (let id = 0; id < 8; id++) {
          const child = node.children[id];
          if (child) result.children[id] = convert(child);
        }
        return result;
      };
      root = convert(tree.root);
    }
  } finally {
    if (compactBounds) {
      try {
        (
          bounds.buffer as ArrayBuffer & {
            transfer?: (size: number) => ArrayBuffer;
          }
        ).transfer?.(0);
      } catch {
        /* Older runtimes collect this private temporary normally. */
      }
    }
  }
  const surface = {
    vertices,
    triangles,
    normals,
    bounds: compactBounds
      ? new Float32Array(nativeTargetStorage(vertices, 0))
      : bounds,
    deriveBounds: compactBounds,
    flags,
  };
  check(options);
  const packedIndex = input.packedNodes
    ? packNativeGlobalEvaluatorIndex(root, vertices, options)
    : undefined;
  if (packedIndex) root = undefined;
  return attachPreparedEvaluator(input, {
    root,
    packedIndex,
    surface,
    degenerate,
    minimumExtent,
  });
}

/** Reattach worker-local query scratch to a trusted prepared target carrier. */
export function resumeNativeGlobalMeshEvaluator(
  input: NativeGlobalEvaluatorMesh,
  data: NativeGlobalMeshEvaluatorData,
) {
  const { root, surface, degenerate, minimumExtent } = data;
  if (input.packedNodes !== undefined && typeof input.packedNodes !== "boolean")
    throw Error("Invalid evaluator node storage policy.");
  if (!!data.packedIndex !== !!input.packedNodes || (root && data.packedIndex))
    throw Error("Prepared evaluator node policy mismatch.");
  if (data.packedIndex)
    validateNativeGlobalPackedIndex(
      data.packedIndex,
      input.triangles.length / 3,
    );
  if (
    surface.vertices !== input.vertices ||
    surface.triangles !== input.triangles ||
    surface.flags !== input.flags ||
    !(degenerate instanceof Uint8Array) ||
    degenerate.length !== input.triangles.length / 3 ||
    !Number.isFinite(minimumExtent) ||
    minimumExtent < 0
  )
    throw Error("Prepared evaluator does not match its geometry.");
  const seen = new Set<NativeGlobalEvaluatorIndexNode>(),
    pending = root ? [root] : [];
  while (pending.length) {
    const node = pending.pop()!;
    if (
      seen.has(node) ||
      !Number.isInteger(node.depth) ||
      node.depth < 0 ||
      node.depth > 10 ||
      typeof node.flat !== "boolean" ||
      !(node.triangles instanceof Uint32Array) ||
      node.bounds.length !== 6 ||
      node.center.length !== 3 ||
      node.inverse.length !== 3 ||
      !Array.prototype.every.call(node.bounds, Number.isFinite) ||
      !Array.prototype.every.call(node.center, Number.isFinite) ||
      !node.inverse.every((v) => typeof v === "number" && !Number.isNaN(v))
    )
      throw Error("Invalid prepared evaluator node.");
    seen.add(node);
    for (const face of node.triangles)
      if (face >= input.triangles.length / 3)
        throw Error("Invalid prepared evaluator face.");
    for (const key of Object.keys(node.children)) {
      const id = Number(key),
        child = node.children[id];
      if (
        !Number.isInteger(id) ||
        id < 0 ||
        id > 7 ||
        !child ||
        child.depth !== node.depth + 1
      )
        throw Error("Invalid prepared evaluator child.");
      pending.push(child);
    }
  }
  return attachPreparedEvaluator(input, data);
}
function attachPreparedEvaluator(
  input: NativeGlobalEvaluatorMesh,
  data: NativeGlobalMeshEvaluatorData,
) {
  const { root, surface, degenerate, minimumExtent } = data;
  const provider = nativeGlobalPackedEvaluator(surface);
  const packedIndex = data.packedIndex;
  const packedScratch: NativeGlobalPackedIndexScratch | undefined = packedIndex
    ? {
        stack: [] as number[],
        projection: new Float64Array(0),
        edgeFlags: new Uint8Array(0),
      }
    : undefined;
  const filterHidden = !!input.filterHidden;
  return {
    root,
    packedIndex,
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
      if (packedIndex && packedScratch) {
        packedScratch.projection = scratch.projection;
        packedScratch.edgeFlags = scratch.edgeFlags;
        try {
          return provider.queryPacked(
            packedIndex,
            point,
            distance,
            projection,
            edgeFlags,
            filterHidden,
            packedScratch,
          );
        } finally {
          scratch.stack.length = 0;
        }
      }
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

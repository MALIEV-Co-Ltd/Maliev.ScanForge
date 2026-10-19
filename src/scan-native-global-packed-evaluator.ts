import { nativeGlobalFacetNormal } from "./scan-native-global-facet-normal";
import { nativeGlobalTriangleDistance } from "./scan-native-global-triangle";
import { nativeScratchStorage } from "./scan-native-target-storage";
import {
  queryNativeGlobalPackedIndex,
  type NativeGlobalPackedIndex,
  type NativeGlobalPackedIndexScratch,
} from "./scan-native-global-packed-index";
export { packNativeGlobalEvaluatorIndex } from "./scan-native-global-packed-index";
import {
  nativeGlobalEvaluatorSearch,
  type NativeGlobalEvaluatorSearchNode,
  type NativeGlobalEvaluatorSearchScratch,
} from "./scan-native-global-evaluator-query";

export interface NativeGlobalPackedEvaluatorSurface {
  vertices: Float32Array;
  triangles: Uint32Array;
  /** Prepared native face normals, or empty only with deriveNormals. */
  normals: Float32Array;
  deriveNormals?: boolean;
  /** Six Float32 bounds per triangle: min XYZ then max XYZ. */
  bounds: Float32Array;
  /** An empty cache with this flag derives the same tight Float32 bounds from
   * immutable vertices, using worker-local scratch rather than 24 bytes/face. */
  deriveBounds?: boolean;
  flags?: Uint8Array;
}
const prepared = new WeakMap<
  NativeGlobalPackedEvaluatorSurface,
  ReturnType<typeof prepare>
>();

/** Geometry identity is immutable, including sidecars. Pose changes reuse this
 * provider; geometry/eligibility changes require a new surface identity. Buffers
 * are retained directly, including shared buffers. Each worker owns its provider.
 */
export function nativeGlobalPackedEvaluator(
  surface: NativeGlobalPackedEvaluatorSurface,
) {
  const existing = prepared.get(surface);
  if (existing) return existing;
  const provider = prepare(surface);
  prepared.set(surface, provider);
  return provider;
}

function prepare(surface: NativeGlobalPackedEvaluatorSurface) {
  const { vertices, triangles, normals, bounds, flags } = surface;
  const derived = surface.deriveBounds === true;
  const deriveNormals = surface.deriveNormals === true;
  const count = triangles.length / 3;
  if (
    !(vertices instanceof Float32Array) ||
    vertices.length % 3 ||
    !(triangles instanceof Uint32Array) ||
    !Number.isInteger(count) ||
    !(normals instanceof Float32Array) ||
    normals.length !== (deriveNormals ? 0 : triangles.length) ||
    (surface.deriveNormals !== undefined &&
      typeof surface.deriveNormals !== "boolean") ||
    !(bounds instanceof Float32Array) ||
    bounds.length !== (derived ? 0 : count * 6) ||
    (surface.deriveBounds !== undefined &&
      typeof surface.deriveBounds !== "boolean") ||
    (flags !== undefined &&
      (!(flags instanceof Uint8Array) || flags.length !== count)) ||
    !vertices.every(Number.isFinite) ||
    !normals.every(Number.isFinite) ||
    !bounds.every(Number.isFinite)
  )
    throw Error("Invalid packed evaluator surface.");
  for (const vertex of triangles)
    if (vertex >= vertices.length / 3)
      throw Error("Evaluator triangle references an invalid vertex.");
  for (let id = 0; !derived && id < count; id++)
    for (let axis = 0; axis < 3; axis++) {
      const lo = bounds[id * 6 + axis],
        hi = bounds[id * 6 + axis + 3];
      if (lo > hi) throw Error("Invalid evaluator triangle bounds.");
      for (let corner = 0; corner < 3; corner++) {
        const value = vertices[triangles[id * 3 + corner] * 3 + axis];
        if (value < lo || hi < value)
          throw Error("Evaluator bounds exclude triangle geometry.");
      }
    }
  const a = new Float32Array(3),
    b = new Float32Array(3),
    c = new Float32Array(3),
    normal = new Float32Array(3);
  const read = (id: number) => {
    const face = id * 3,
      ia = triangles[face] * 3,
      ib = triangles[face + 1] * 3,
      ic = triangles[face + 2] * 3;
    for (let axis = 0; axis < 3; axis++) {
      a[axis] = vertices[ia + axis];
      b[axis] = vertices[ib + axis];
      c[axis] = vertices[ic + axis];
      if (!deriveNormals) normal[axis] = normals[face + axis];
    }
    if (deriveNormals) nativeGlobalFacetNormal(vertices, triangles, id, normal);
  };
  // One closure and 48 bytes of coordinate/normal scratch per immutable surface, rather
  // than per-triangle objects/views or per-query arrays. Synchronous, non-reentrant.
  const evaluate = (
    id: number,
    point: ArrayLike<number>,
    radius: number,
    projection: Float64Array,
    edgeFlags: Uint8Array,
    filterHidden: boolean,
  ) => {
    if (!Number.isInteger(id) || id < 0 || id >= count)
      throw Error("Invalid evaluator leaf triangle ID.");
    if (filterHidden && flags && flags[id] & 2) return NaN;
    if (derived) {
      const face = id * 3,
        ia = triangles[face] * 3,
        ib = triangles[face + 1] * 3,
        ic = triangles[face + 2] * 3;
      // Input coordinates are already Float32. Choosing their extrema requires
      // no rounding or temporary vector writes. Rejected boxes never load normals.
      for (let axis = 0; axis < 3; axis++) {
        let lo = vertices[ia + axis],
          hi = lo;
        const b = vertices[ib + axis],
          c = vertices[ic + axis];
        if (b < lo) lo = b;
        if (hi < b) hi = b;
        if (c < lo) lo = c;
        if (hi < c) hi = c;
        if (!(lo - radius <= point[axis] && point[axis] <= hi + radius))
          return NaN;
      }
    } else {
      const box = id * 6;
      if (!(
        bounds[box] - radius <= point[0] &&
        bounds[box + 1] - radius <= point[1] &&
        bounds[box + 2] - radius <= point[2] &&
        point[0] <= bounds[box + 3] + radius &&
        point[1] <= bounds[box + 4] + radius &&
        point[2] <= bounds[box + 5] + radius
      ))
        return NaN;
    }
    read(id);
    return nativeGlobalTriangleDistance(
      point,
      a,
      b,
      c,
      normal,
      radius,
      projection,
      edgeFlags,
    );
  };
  const seenTriangles = new Uint32Array(nativeScratchStorage(4096));
  return {
    surface,
    queryPacked(
      index: NativeGlobalPackedIndex,
      point: ArrayLike<number>,
      distance: Float64Array,
      projection: Float64Array,
      edgeFlags: Uint8Array,
      filterHidden: boolean,
      scratch: NativeGlobalPackedIndexScratch,
    ) {
      return queryNativeGlobalPackedIndex(
        index,
        point,
        distance,
        projection,
        edgeFlags,
        filterHidden,
        scratch,
        evaluate,
        seenTriangles,
      );
    },
    query(
      root: NativeGlobalEvaluatorSearchNode<number>,
      point: ArrayLike<number>,
      distance: Float64Array,
      projection: Float64Array,
      edgeFlags: Uint8Array,
      filterHidden: boolean,
      scratch: NativeGlobalEvaluatorSearchScratch<number>,
    ) {
      try {
        return nativeGlobalEvaluatorSearch(
          root,
          point,
          distance,
          projection,
          edgeFlags,
          filterHidden,
          scratch,
          evaluate,
        );
      } finally {
        scratch.stack.length = 0;
      }
    },
  };
}

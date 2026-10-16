import { nativeGlobalTriangleDistance } from "./scan-native-global-triangle";

export interface NativeGlobalEvaluatorTriangle {
  id: number;
  vertices: readonly ArrayLike<number>[];
  normal: ArrayLike<number>;
  /** Prepared Float32 bounds: min XYZ then max XYZ. */
  bounds: ArrayLike<number>;
  flags: number;
}
export interface NativeGlobalEvaluatorSearchNode<T> {
  /** Original Double node bounds and center. */
  bounds: ArrayLike<number>;
  center: ArrayLike<number>;
  flat: boolean;
  children: {
    readonly [index: number]: NativeGlobalEvaluatorSearchNode<T> | undefined;
  };
  triangles: ArrayLike<T>;
}
export interface NativeGlobalEvaluatorNode extends NativeGlobalEvaluatorSearchNode<NativeGlobalEvaluatorTriangle> {
  children: readonly (NativeGlobalEvaluatorNode | undefined)[];
  triangles: readonly NativeGlobalEvaluatorTriangle[];
}
export interface NativeGlobalEvaluatorSearchScratch<T> {
  stack: NativeGlobalEvaluatorSearchNode<T>[];
  projection: Float64Array;
  edgeFlags: Uint8Array;
}
export type NativeGlobalEvaluatorScratch =
  NativeGlobalEvaluatorSearchScratch<NativeGlobalEvaluatorTriangle>;
export type NativeGlobalEvaluatorDistance<T> = (
  triangle: T,
  point: ArrayLike<number>,
  radius: number,
  projection: Float64Array,
  edgeFlags: Uint8Array,
  filterHidden: boolean,
) => number;
const maximum = Math.fround(3.4028234663852886e38);

const recordDistance: NativeGlobalEvaluatorDistance<
  NativeGlobalEvaluatorTriangle
> = (triangle, point, radius, projection, flags, filterHidden) => {
  if (filterHidden && triangle.flags & 2) return NaN;
  const box = triangle.bounds;
  if (!(
    box[0] - radius <= point[0] &&
    box[1] - radius <= point[1] &&
    box[2] - radius <= point[2] &&
    point[0] <= box[3] + radius &&
    point[1] <= box[4] + radius &&
    point[2] <= box[5] + radius
  ))
    return NaN;
  return nativeGlobalTriangleDistance(
    point,
    triangle.vertices[0],
    triangle.vertices[1],
    triangle.vertices[2],
    triangle.normal,
    radius,
    projection,
    flags,
  );
};

/** Original recursive search ordering, using a reusable explicit stack. Prepared
 * immutable node/triangle records are validated by the index builder. The initial
 * signed distance is the radius limit; misses preserve all caller outputs.
 * Scratch belongs to one query at a time and must not alias the output buffers.
 */
export function nativeGlobalEvaluatorQuery(
  root: NativeGlobalEvaluatorNode,
  point: ArrayLike<number>,
  distance: Float64Array,
  projection: Float64Array,
  edgeFlags: Uint8Array,
  filterHidden: boolean,
  scratch: NativeGlobalEvaluatorScratch,
): NativeGlobalEvaluatorTriangle | undefined {
  return nativeGlobalEvaluatorSearch(
    root,
    point,
    distance,
    projection,
    edgeFlags,
    filterHidden,
    scratch,
    recordDistance,
  );
}

/** Shared native traversal for record fixtures and packed production carriers.
 * The prepared evaluator callback is retained once, not created per query.
 */
export function nativeGlobalEvaluatorSearch<T>(
  root: NativeGlobalEvaluatorSearchNode<T>,
  point: ArrayLike<number>,
  distance: Float64Array,
  projection: Float64Array,
  edgeFlags: Uint8Array,
  filterHidden: boolean,
  scratch: NativeGlobalEvaluatorSearchScratch<T>,
  evaluate: NativeGlobalEvaluatorDistance<T>,
): T | undefined {
  const { stack } = scratch;
  stack.length = 0;
  stack.push(root);
  let best: T | undefined;
  while (stack.length) {
    const node = stack.pop()!;
    let radius = Math.abs(distance[0]);
    const bounds = node.bounds;
    if (
      radius !== maximum &&
      (Math.fround(point[0]) < bounds[0] - radius ||
        Math.fround(point[1]) < bounds[1] - radius ||
        Math.fround(point[2]) < bounds[2] - radius ||
        radius + bounds[3] < Math.fround(point[0]) ||
        radius + bounds[4] < Math.fround(point[1]) ||
        radius + bounds[5] < Math.fround(point[2]))
    )
      continue;
    if (!node.triangles.length) {
      const nearIndex =
        (node.flat || point[2] > node.center[2] ? 0 : 4) +
        (point[0] <= node.center[0] ? 1 : 0) +
        (point[1] <= node.center[1] ? 2 : 0);
      const near = node.children[nearIndex];
      // Reverse insertion produces native near-first, then ascending-child order.
      for (let i = 7; i >= 0; i--) {
        const child = node.children[i];
        if (child && child !== near) stack.push(child);
      }
      if (near) stack.push(near);
      continue;
    }
    for (let slot = 0; slot < node.triangles.length; slot++) {
      const triangle = node.triangles[slot];
      radius = Math.abs(distance[0]);
      const candidate = evaluate(
        triangle,
        point,
        radius,
        scratch.projection,
        scratch.edgeFlags,
        filterHidden,
      );
      if (Math.abs(candidate) < radius) {
        distance[0] = candidate;
        projection[0] = scratch.projection[0];
        projection[1] = scratch.projection[1];
        projection[2] = scratch.projection[2];
        edgeFlags[0] = scratch.edgeFlags[0];
        best = triangle;
      }
    }
  }
  return best;
}

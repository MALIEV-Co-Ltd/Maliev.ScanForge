import { nativeGlobalTriangleDistance } from "./scan-native-global-triangle";

export interface NativeGlobalEvaluatorTriangle {
  id: number;
  vertices: readonly ArrayLike<number>[];
  normal: ArrayLike<number>;
  /** Prepared Float32 bounds: min XYZ then max XYZ. */
  bounds: ArrayLike<number>;
  flags: number;
}
export interface NativeGlobalEvaluatorNode {
  /** Original Double node bounds and center. */
  bounds: ArrayLike<number>;
  center: ArrayLike<number>;
  flat: boolean;
  children: readonly (NativeGlobalEvaluatorNode | undefined)[];
  triangles: readonly NativeGlobalEvaluatorTriangle[];
}
export interface NativeGlobalEvaluatorScratch {
  stack: NativeGlobalEvaluatorNode[];
  projection: Float64Array;
  edgeFlags: Uint8Array;
}
const maximum = Math.fround(3.4028234663852886e38);

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
  const { stack } = scratch;
  stack.length = 0;
  stack.push(root);
  let best: NativeGlobalEvaluatorTriangle | undefined;
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
    for (const triangle of node.triangles) {
      if (filterHidden && triangle.flags & 2) continue;
      radius = Math.abs(distance[0]);
      const box = triangle.bounds;
      if (!(
        box[0] - radius <= point[0] &&
        box[1] - radius <= point[1] &&
        box[2] - radius <= point[2] &&
        point[0] <= box[3] + radius &&
        point[1] <= box[4] + radius &&
        point[2] <= box[5] + radius
      ))
        continue;
      const candidate = nativeGlobalTriangleDistance(
        point,
        triangle.vertices[0],
        triangle.vertices[1],
        triangle.vertices[2],
        triangle.normal,
        radius,
        scratch.projection,
        scratch.edgeFlags,
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

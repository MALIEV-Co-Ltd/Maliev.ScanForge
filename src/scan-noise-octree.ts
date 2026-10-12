import { noiseOctantBox } from "./scan-noise-octree-bounds";
import { noiseTriangleCubeOverlap } from "./scan-noise-overlap";
import type { NoiseBounds, NoiseQueryNode } from "./scan-noise-octree-query";
import type { MeshProcessingOptions } from "./mesh-processing";

export interface NoiseTreeNode extends NoiseQueryNode {
  inverse: readonly [number, number, number];
  depth: number;
  children: Partial<Record<number, NoiseTreeNode>>;
}
export type NoiseTreeTriangle = readonly (readonly number[])[];
export interface NoiseIndexedSurface {
  coordinates: ArrayLike<number>;
  indices: ArrayLike<number>;
}

/** Native subdivision with ordered, potentially duplicated triangle membership.
 * The root padding and default limits come from the Reduce Noise caller.
 */
export function buildNoiseOctree(
  triangles: readonly NoiseTreeTriangle[] | NoiseIndexedSurface,
  minimumExtent = 0.5,
  maximumDepth = 10,
): NoiseTreeNode {
  return prepareNoiseOctree(triangles, minimumExtent, maximumDepth).root;
}

export function prepareNoiseOctree(
  triangles: readonly NoiseTreeTriangle[] | NoiseIndexedSurface,
  minimumExtent = 0.5,
  maximumDepth = 10,
  options: MeshProcessingOptions = {},
) {
  const prepared = packNoiseOctree(
    triangles,
    minimumExtent,
    maximumDepth,
    options,
  );
  const budget = { nodes: 0 };
  splitNoiseNode(
    prepared.root,
    prepared,
    minimumExtent,
    maximumDepth,
    budget,
    options,
    true,
    true,
  );
  return prepared;
}

export interface PackedNoiseTree {
  root: NoiseTreeNode;
  points: Float32Array;
  triangleBounds: Float32Array;
}

/** Pack once before transferring immutable triangle data to construction workers. */
export function packNoiseOctree(
  triangles: readonly NoiseTreeTriangle[] | NoiseIndexedSurface,
  minimumExtent = 0.5,
  maximumDepth = 10,
  options: MeshProcessingOptions = {},
): PackedNoiseTree {
  const indexed = Array.isArray(triangles)
    ? undefined
    : (triangles as NoiseIndexedSurface);
  const lists = triangles as readonly NoiseTreeTriangle[];
  const count = indexed ? indexed.indices.length / 3 : lists.length;
  if (!Number.isInteger(count) || count < 1)
    throw new RangeError("Noise tree requires triangles");
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  check();
  if (
    !Number.isFinite(minimumExtent) ||
    minimumExtent < 0 ||
    !Number.isInteger(maximumDepth) ||
    maximumDepth < 1 ||
    maximumDepth > 10
  )
    throw new RangeError("Noise subdivision limits are invalid");
  const points = new Float32Array(count * 9);
  const triangleBounds = new Float32Array(count * 6);
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let id = 0; id < count; id++) {
    if (id % 1024 === 0) check();
    if (
      !indexed &&
      (lists[id].length !== 3 || lists[id].some((p) => p.length !== 3))
    )
      throw new RangeError("Noise triangles require three 3D vertices");
    for (let corner = 0; corner < 3; corner++) {
      const vertex = indexed?.indices[id * 3 + corner];
      if (
        indexed &&
        (!Number.isInteger(vertex) ||
          vertex! < 0 ||
          vertex! * 3 + 2 >= indexed.coordinates.length)
      )
        throw new RangeError(
          "Noise triangle index is outside the vertex buffer",
        );
      for (let axis = 0; axis < 3; axis++) {
        const value = Math.fround(
          indexed
            ? indexed.coordinates[vertex! * 3 + axis]
            : lists[id][corner][axis],
        );
        if (!Number.isFinite(value))
          throw new RangeError(
            "Noise triangles require finite Float32 coordinates",
          );
        points[id * 9 + corner * 3 + axis] = value;
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      const p = id * 9 + axis,
        t = id * 6 + axis;
      triangleBounds[t] = Math.min(points[p], points[p + 3], points[p + 6]);
      triangleBounds[t + 3] = Math.max(points[p], points[p + 3], points[p + 6]);
      b[axis] = Math.min(b[axis], triangleBounds[t]);
      b[axis + 3] = Math.max(b[axis + 3], triangleBounds[t + 3]);
    }
  }
  const padding = 0.009999999776482582;
  const padded: NoiseBounds = [
    Math.fround(b[0] - padding),
    Math.fround(b[1] - padding),
    Math.fround(b[2] - padding),
    Math.fround(b[3] + padding),
    Math.fround(b[4] + padding),
    Math.fround(b[5] + padding),
  ];
  const half = Math.fround(
    Math.max(
      Math.fround(padded[3] - padded[0]),
      Math.fround(padded[4] - padded[1]),
      Math.fround(padded[5] - padded[2]),
    ) * 0.5,
  );
  const midpoint = [0, 1, 2].map((axis) =>
    Math.fround(Math.fround(padded[axis] + padded[axis + 3]) * 0.5),
  );
  const bounds: NoiseBounds = [
    Math.fround(midpoint[0] - half),
    Math.fround(midpoint[1] - half),
    Math.fround(midpoint[2] - half),
    Math.fround(midpoint[0] + half),
    Math.fround(midpoint[1] + half),
    Math.fround(midpoint[2] + half),
  ];
  const root: NoiseTreeNode = {
    bounds,
    center: [
      (bounds[0] + bounds[3]) * 0.5,
      (bounds[1] + bounds[4]) * 0.5,
      (bounds[2] + bounds[5]) * 0.5,
    ],
    inverse: [
      1 / (bounds[3] - bounds[0]),
      1 / (bounds[4] - bounds[1]),
      1 / (bounds[5] - bounds[2]),
    ],
    mode: 0,
    depth: 0,
    triangles: Array.from({ length: count }, (_, id) => id),
    children: {},
  };
  return { root, points, triangleBounds };
}

function splitNoiseNode(
  start: NoiseTreeNode,
  prepared: PackedNoiseTree,
  minimumExtent: number,
  maximumDepth: number,
  budget: {
    nodes: number;
    limit?: number;
    entries?: number;
    entryLimit?: number;
  },
  options: MeshProcessingOptions,
  eager: boolean,
  recursive: boolean,
) {
  const { points, triangleBounds } = prepared;
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  const a = [0, 0, 0],
    c = [0, 0, 0],
    d = [0, 0, 0];
  const split = (node: NoiseTreeNode, eager: boolean) => {
    check();
    const boxes = Array.from({ length: 8 }, (_, child) =>
      noiseOctantBox(node.bounds, child),
    );
    const memberships = Array.from({ length: 8 }, () => [] as number[]);
    for (const id of node.triangles) {
      if (id % 1024 === 0) check();
      const t = id * 6;
      for (let child = 0; child < 8; child++) {
        const box = boxes[child],
          b = box.bounds;
        if (
          triangleBounds[t + 3] < b[0] ||
          triangleBounds[t + 4] < b[1] ||
          triangleBounds[t + 5] < b[2] ||
          triangleBounds[t] > b[3] ||
          triangleBounds[t + 1] > b[4] ||
          triangleBounds[t + 2] > b[5]
        )
          continue;
        for (let axis = 0; axis < 3; axis++) {
          a[axis] =
            (points[id * 9 + axis] - box.center[axis]) * box.inverse[axis];
          c[axis] =
            (points[id * 9 + 3 + axis] - box.center[axis]) * box.inverse[axis];
          d[axis] =
            (points[id * 9 + 6 + axis] - box.center[axis]) * box.inverse[axis];
        }
        if (noiseTriangleCubeOverlap(a, c, d)) {
          budget.entries = (budget.entries ?? 0) + 1;
          if (budget.entries > (budget.entryLimit ?? Infinity))
            throw new RangeError("Noise task exceeds its membership budget");
          memberships[child].push(id);
        }
      }
    }
    for (let child = 0; child < 8; child++) {
      if (!eager && !memberships[child].length) continue;
      if (++budget.nodes > (budget.limit ?? 100000))
        throw new RangeError("Noise tree exceeds its node budget");
      node.children[child] = {
        ...boxes[child],
        mode: 0,
        depth: node.depth + 1,
        triangles: memberships[child],
        children: {},
      };
    }
    node.triangles = [];
    if (!recursive) return;
    for (const child of Object.values(node.children))
      if (
        child &&
        child.triangles.length >= 25 &&
        child.bounds[3] - child.bounds[0] > Math.fround(minimumExtent) &&
        child.depth < maximumDepth
      )
        split(child, false);
  };
  split(start, eager);
  check();
}

/** Partition in source order before dispatch; every root octant exists, even empty. */
export function partitionNoiseRoot(
  prepared: PackedNoiseTree,
  options: MeshProcessingOptions = {},
) {
  splitNoiseNode(
    prepared.root,
    prepared,
    0.5,
    10,
    { nodes: 0 },
    options,
    true,
    false,
  );
}

/** One independent root task. The caller must enforce the merged node budget. */
export function refineNoiseOctant(
  prepared: PackedNoiseTree,
  octant: number,
  minimumExtent = 0.5,
  maximumDepth = 10,
  options: MeshProcessingOptions = {},
  maximumNodes = 100000,
  maximumEntries = Infinity,
) {
  if (
    maximumEntries !== Infinity &&
    (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1)
  )
    throw new RangeError("Noise task membership budget is invalid");
  if (
    !Number.isSafeInteger(maximumNodes) ||
    maximumNodes < 1 ||
    maximumNodes > 100000
  )
    throw new RangeError("Noise task node budget is invalid");
  if (!Number.isInteger(octant) || octant < 0 || octant > 7)
    throw new RangeError("Noise octant must be between zero and seven");
  if (
    !Number.isFinite(minimumExtent) ||
    minimumExtent < 0 ||
    !Number.isInteger(maximumDepth) ||
    maximumDepth < 1 ||
    maximumDepth > 10
  )
    throw new RangeError("Noise subdivision limits are invalid");
  if (options.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  const node = prepared.root.children[octant];
  if (!node)
    throw new RangeError("Noise root must be partitioned before refinement");
  const budget = {
    nodes: 0,
    limit: maximumNodes,
    entries: 0,
    entryLimit: maximumEntries,
  };
  if (
    node.triangles.length >= 25 &&
    node.bounds[3] - node.bounds[0] > Math.fround(minimumExtent) &&
    node.depth < maximumDepth
  )
    splitNoiseNode(
      node,
      prepared,
      minimumExtent,
      maximumDepth,
      budget,
      options,
      false,
      true,
    );
  return { node, descendants: budget.nodes, memberships: budget.entries };
}

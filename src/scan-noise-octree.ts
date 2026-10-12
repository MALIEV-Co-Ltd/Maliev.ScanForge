import { noiseOctantBox } from "./scan-noise-octree-bounds";
import { noiseTriangleCubeOverlap } from "./scan-noise-overlap";
import type { NoiseBounds, NoiseQueryNode } from "./scan-noise-octree-query";

export interface NoiseTreeNode extends NoiseQueryNode {
  inverse: readonly [number, number, number];
  depth: number;
  children: Partial<Record<number, NoiseTreeNode>>;
}
export type NoiseTreeTriangle = readonly (readonly number[])[];

/** Native subdivision with ordered, potentially duplicated triangle membership.
 * The root padding and default limits come from the Reduce Noise caller.
 */
export function buildNoiseOctree(
  triangles: readonly NoiseTreeTriangle[],
  minimumExtent = 0.5,
  maximumDepth = 10,
): NoiseTreeNode {
  if (!triangles.length) throw new RangeError("Noise tree requires triangles");
  if (
    !Number.isFinite(minimumExtent) ||
    minimumExtent < 0 ||
    !Number.isInteger(maximumDepth) ||
    maximumDepth < 1 ||
    maximumDepth > 10
  )
    throw new RangeError("Noise subdivision limits are invalid");
  if (
    triangles.some(
      (t) =>
        t.length !== 3 ||
        t.some(
          (p) =>
            p.length !== 3 || p.some((v) => !Number.isFinite(Math.fround(v))),
        ),
    )
  )
    throw new RangeError("Noise triangles require finite Float32 coordinates");
  const points = triangles.map((t) => t.map((p) => p.map(Math.fround)));
  const triangleBounds: NoiseBounds[] = points.map((t) => [
    Math.min(t[0][0], t[1][0], t[2][0]),
    Math.min(t[0][1], t[1][1], t[2][1]),
    Math.min(t[0][2], t[1][2], t[2][2]),
    Math.max(t[0][0], t[1][0], t[2][0]),
    Math.max(t[0][1], t[1][1], t[2][1]),
    Math.max(t[0][2], t[1][2], t[2][2]),
  ]);
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const t of triangleBounds)
    for (let a = 0; a < 3; a++) {
      b[a] = Math.min(b[a], t[a]);
      b[a + 3] = Math.max(b[a + 3], t[a + 3]);
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
    triangles: points.map((_, id) => id),
    children: {},
  };
  let nodes = 0;
  const a = [0, 0, 0],
    c = [0, 0, 0],
    d = [0, 0, 0];
  const split = (node: NoiseTreeNode, eager: boolean) => {
    const boxes = Array.from({ length: 8 }, (_, child) =>
      noiseOctantBox(node.bounds, child),
    );
    const memberships = Array.from({ length: 8 }, () => [] as number[]);
    for (const id of node.triangles) {
      const t = triangleBounds[id];
      for (let child = 0; child < 8; child++) {
        const box = boxes[child],
          b = box.bounds;
        if (
          t[3] < b[0] ||
          t[4] < b[1] ||
          t[5] < b[2] ||
          t[0] > b[3] ||
          t[1] > b[4] ||
          t[2] > b[5]
        )
          continue;
        for (let axis = 0; axis < 3; axis++) {
          a[axis] =
            (points[id][0][axis] - box.center[axis]) * box.inverse[axis];
          c[axis] =
            (points[id][1][axis] - box.center[axis]) * box.inverse[axis];
          d[axis] =
            (points[id][2][axis] - box.center[axis]) * box.inverse[axis];
        }
        if (noiseTriangleCubeOverlap(a, c, d)) memberships[child].push(id);
      }
    }
    for (let child = 0; child < 8; child++) {
      if (!eager && !memberships[child].length) continue;
      if (++nodes > 100000)
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
    for (const child of Object.values(node.children))
      if (
        child &&
        child.triangles.length >= 25 &&
        child.bounds[3] - child.bounds[0] > Math.fround(minimumExtent) &&
        child.depth < maximumDepth
      )
        split(child, false);
  };
  split(root, true);
  return root;
}

export type NoiseBounds = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];
export interface NoiseQueryNode {
  bounds: NoiseBounds;
  center: readonly [number, number, number];
  mode: number;
  triangles: readonly number[];
  children: Readonly<Partial<Record<number, NoiseQueryNode>>>;
}
export interface NoiseQueryTriangle {
  bounds: NoiseBounds;
}
export interface NoiseQueryHit {
  triangle: number;
  distance: number;
}

const intersects = (
  bounds: NoiseBounds,
  p: readonly number[],
  radius: number,
) =>
  p[0] >= bounds[0] - radius &&
  p[1] >= bounds[1] - radius &&
  p[2] >= bounds[2] - radius &&
  p[0] <= bounds[3] + radius &&
  p[1] <= bounds[4] + radius &&
  p[2] <= bounds[5] + radius;

/** Native query order on an already constructed octree. Equal distances retain
 * the first leaf entry, including its sign. Construction parity is a separate gate.
 */
export function queryNoiseOctree(
  root: NoiseQueryNode,
  point: readonly number[],
  radius: number,
  triangles: readonly NoiseQueryTriangle[],
  evaluate: (triangle: number, radius: number) => number,
): NoiseQueryHit | undefined {
  let best = Math.abs(radius);
  let hit: NoiseQueryHit | undefined;
  const visit = (node: NoiseQueryNode) => {
    if (!intersects(node.bounds, point, best)) return;
    if (node.triangles.length) {
      for (const triangle of node.triangles) {
        if (!intersects(triangles[triangle].bounds, point, best)) continue;
        const distance = evaluate(triangle, best);
        if (Math.abs(distance) < best) {
          best = Math.abs(distance);
          hit = { triangle, distance };
        }
      }
      return;
    }
    const [x, y, z] = node.center;
    const preferred =
      (point[0] > x ? (point[1] > y ? 0 : 2) : point[1] > y ? 1 : 3) +
      (node.mode || point[2] > z ? 0 : 4);
    const first = node.children[preferred];
    if (first) visit(first);
    for (let child = 0; child < 8; child++)
      if (child !== preferred && node.children[child])
        visit(node.children[child]!);
  };
  visit(root);
  return hit;
}

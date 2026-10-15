import type { NoiseQueryNode, NoiseQueryHit } from "./scan-noise-octree-query";

/** Immutable worker transport. Doubles preserve native query bounds and centers. */
export interface AlignmentPackedTree {
  format: "alignment-tree-v1";
  geometry: Float64Array;
  links: Uint32Array;
  triangles: Uint32Array;
}

export function alignmentTreeSize(root: NoiseQueryNode) {
  let nodes = 0,
    entries = 0;
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    nodes++;
    entries += node.triangles.length;
    for (let child = 0; child < 8; child++)
      if (node.children[child]) pending.push(node.children[child]!);
  }
  return { nodes, entries };
}

/** Called only after pool memory admission, on trusted constructed trees. */
export function packAlignmentTree(root: NoiseQueryNode): AlignmentPackedTree {
  const size = alignmentTreeSize(root);
  const geometry = new Float64Array(new SharedArrayBuffer(size.nodes * 9 * 8));
  const links = new Uint32Array(new SharedArrayBuffer(size.nodes * 11 * 4));
  const triangles = new Uint32Array(new SharedArrayBuffer(size.entries * 4));
  let next = 0,
    entry = 0;
  const write = (node: NoiseQueryNode): number => {
    const id = next++,
      g = id * 9,
      l = id * 11;
    geometry.set(node.bounds, g);
    geometry.set(node.center, g + 6);
    links[l] = node.mode ? 1 : 0;
    links[l + 1] = entry;
    links[l + 2] = node.triangles.length;
    triangles.set(node.triangles, entry);
    entry += node.triangles.length;
    for (let child = 0; child < 8; child++)
      if (node.children[child])
        links[l + 3 + child] = write(node.children[child]!) + 1;
    return id;
  };
  write(root);
  return { format: "alignment-tree-v1", geometry, links, triangles };
}

/** Same traversal and strict winner comparison as the native object-tree query. */
export function queryAlignmentPackedTree(
  tree: AlignmentPackedTree,
  point: readonly number[],
  radius: number,
  bounds: Float32Array,
  evaluate: (triangle: number, radius: number) => number,
): NoiseQueryHit | undefined {
  const { geometry, links, triangles } = tree;
  let best = Math.abs(radius);
  let hit: NoiseQueryHit | undefined;
  const intersects = (values: ArrayLike<number>, offset: number) =>
    point[0] >= values[offset] - best &&
    point[1] >= values[offset + 1] - best &&
    point[2] >= values[offset + 2] - best &&
    point[0] <= values[offset + 3] + best &&
    point[1] <= values[offset + 4] + best &&
    point[2] <= values[offset + 5] + best;
  const visit = (id: number) => {
    const g = id * 9,
      l = id * 11;
    if (!intersects(geometry, g)) return;
    const count = links[l + 2];
    if (count) {
      const end = links[l + 1] + count;
      for (let entry = links[l + 1]; entry < end; entry++) {
        const triangle = triangles[entry];
        if (!intersects(bounds, triangle * 6)) continue;
        const distance = evaluate(triangle, best);
        if (Math.abs(distance) < best) {
          best = Math.abs(distance);
          hit = { triangle, distance };
        }
      }
      return;
    }
    const preferred =
      (point[0] > geometry[g + 6]
        ? point[1] > geometry[g + 7]
          ? 0
          : 2
        : point[1] > geometry[g + 7]
          ? 1
          : 3) + (links[l] || point[2] > geometry[g + 8] ? 0 : 4);
    const first = links[l + 3 + preferred];
    if (first) visit(first - 1);
    for (let child = 0; child < 8; child++) {
      const next = links[l + 3 + child];
      if (child !== preferred && next) visit(next - 1);
    }
  };
  visit(0);
  return hit;
}

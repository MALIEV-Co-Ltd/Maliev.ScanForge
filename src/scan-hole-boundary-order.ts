import type { MeshTopology } from "./mesh-processing";
import { NativeBoundaryTree } from "./scan-native-boundary-tree";

const cache = new WeakMap<MeshTopology, readonly (readonly number[])[]>();

/** Native boundary insertion follows facet/corner order, then walks the tree
 * root. Reuse the immutable topology's result without allocating face records.
 */
export function nativeHoleBoundaryWalks(
  topology: MeshTopology,
  signal?: AbortSignal,
) {
  if (signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  const retained = cache.get(topology);
  if (retained) return retained;
  const exposed: { start: number; end: number; order: number }[] = [];
  let visited = 0;
  for (const uses of topology.edges.values()) {
    if (visited++ % 4096 === 0 && signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    if (uses.length !== 1) continue;
    const edge = uses[0],
      offset = edge.face * 3;
    let corner = 0;
    while (corner < 3 && topology.triangles[offset + corner] !== edge.from)
      corner++;
    exposed.push({ start: edge.from, end: edge.to, order: offset + corner });
  }
  exposed.sort((a, b) => a.order - b.order);
  const tree = new NativeBoundaryTree<{ start: number; end: number }>();
  for (let i = 0; i < exposed.length; i++) {
    if (i % 4096 === 0 && signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    tree.insert(exposed[i]);
  }
  const loops: number[][] = [];
  while (tree.size) {
    if (signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const walk = tree.takeNextWalk();
    if (!walk.length) break;
    if (walk.at(-1)!.end === walk[0].start)
      loops.push(walk.map((edge) => edge.start));
  }
  cache.set(topology, loops);
  return loops;
}

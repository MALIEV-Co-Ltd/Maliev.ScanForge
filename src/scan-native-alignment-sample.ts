import { ALIGNMENT_QUERY_SENTINEL } from "./scan-native-alignment-query";

/** Native sample-node accumulation; inputs are cached Float32 vertices and center. */
export function nativeAlignmentSampleRepresentative(
  vertices: readonly { point: readonly number[]; flags: number }[],
  center: readonly number[],
) {
  let nearestIndex = -1,
    preferredIndex = -1;
  let nearestDistance = ALIGNMENT_QUERY_SENTINEL,
    preferredDistance = ALIGNMENT_QUERY_SENTINEL;
  for (let index = 0; index < vertices.length; index++) {
    const vertex = vertices[index];
    const dx = vertex.point[0] - center[0],
      dy = vertex.point[1] - center[1],
      dz = vertex.point[2] - center[2];
    // Each term multiplies the double difference by its Float32 counterpart.
    const distance =
      dx * Math.fround(dx) + dy * Math.fround(dy) + dz * Math.fround(dz);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
    if ((vertex.flags & 16) !== 0 && distance < preferredDistance) {
      preferredDistance = distance;
      preferredIndex = index;
    }
  }
  return { nearestIndex, preferredIndex, nearestDistance, preferredDistance };
}

/** Source sampling before worker partitioning. Returns flags without mutating the mesh. */
export function nativeSampleAlignmentVertices(
  vertices: readonly { point: readonly number[]; flags: number }[],
  budget: number,
  options: { signal?: AbortSignal } = {},
) {
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 0xffffffff)
    throw new RangeError("Alignment sample count must be an unsigned integer.");
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Alignment sampling cancelled.", "AbortError");
  };
  check();
  const flags = vertices.map((vertex) => vertex.flags);
  const eligible = vertices.flatMap((vertex, id) =>
    (vertex.flags & 5) === 4 ? [id] : [],
  );
  if (eligible.length <= budget)
    return { flags, levelCounts: [] as number[], nodes: 0 };
  const points = vertices.map((vertex) => vertex.point.map(Math.fround));
  const distinct = new Set(eligible.map((id) => points[id].join(",")));
  // The native loop cannot terminate if no depth can exceed the requested count.
  if (distinct.size <= budget)
    throw new RangeError(
      "Alignment samples cannot separate coincident vertices.",
    );
  type Node = {
    ids: number[];
    bounds: number[];
    center: number[];
    depth: number;
  };
  const makeNode = (ids: number[], bounds: number[], depth: number): Node => ({
    ids,
    bounds,
    depth,
    center: [0, 1, 2].map((axis) =>
      Math.fround(Math.fround(bounds[axis] + bounds[axis + 3]) * 0.5),
    ),
  });
  const bounds = [
    Infinity,
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  for (const id of eligible)
    for (let axis = 0; axis < 3; axis++) {
      bounds[axis] = Math.min(bounds[axis], points[id][axis]);
      bounds[axis + 3] = Math.max(bounds[axis + 3], points[id][axis]);
    }
  const nodes = [makeNode(eligible, bounds, 0)];
  let frontier = nodes.slice();
  const levelCounts = [1];
  do {
    check();
    if (levelCounts.length > 256)
      throw new RangeError("Alignment sample subdivision did not converge.");
    const next: Node[] = [];
    for (const node of frontier) {
      check();
      const groups = new Map<number, number[]>();
      for (const id of node.ids) {
        const point = points[id];
        const slot =
          (point[0] >= node.center[0] ? 4 : 0) +
          (point[1] >= node.center[1] ? 2 : 0) +
          (point[2] >= node.center[2] ? 1 : 0);
        const group = groups.get(slot);
        if (group) group.push(id);
        else groups.set(slot, [id]);
      }
      // Native allocation follows first occurrence; later traversal follows slot order.
      const children = new Map<number, Node>();
      for (const [slot, ids] of groups) {
        const childBounds = node.bounds.slice();
        for (let axis = 0; axis < 3; axis++)
          childBounds[axis + (slot & (4 >> axis) ? 0 : 3)] = node.center[axis];
        const child = makeNode(ids, childBounds, node.depth + 1);
        nodes.push(child);
        children.set(slot, child);
      }
      for (let slot = 0; slot < 8; slot++) {
        const child = children.get(slot);
        if (child) next.push(child);
      }
    }
    frontier = next;
    levelCounts.push(next.length);
  } while (frontier.length <= budget);
  const last = levelCounts.length - 1;
  // Native SUB r32 zero-extends before double conversion. A lower count wraps;
  // preserve this behavior rather than substituting signed absolute differences.
  const depth =
    (levelCounts[last - 1] - budget) >>> 0 <= (levelCounts[last] - budget) >>> 0
      ? last - 1
      : last;
  for (const id of eligible) flags[id] &= ~4;
  for (const node of nodes) {
    if (node.depth !== depth) continue;
    const result = nativeAlignmentSampleRepresentative(
      node.ids.map((id) => ({ point: points[id], flags: vertices[id].flags })),
      node.center,
    );
    const representative =
      result.preferredIndex >= 0 ? result.preferredIndex : result.nearestIndex;
    if (representative >= 0) flags[node.ids[representative]] |= 4;
  }
  return { flags, levelCounts, nodes: nodes.length };
}

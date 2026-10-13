import { ALIGNMENT_QUERY_SENTINEL } from "./scan-native-alignment-query";

type SampleNode = {
  ids: number[];
  bounds: number[];
  center: number[];
  depth: number;
  points: number[][];
  inputFlags: number[];
  outputFlags: number[];
};

/** One pool per native alignment constructor, shared by its source meshes. */
export function createNativeAlignmentSamplingState() {
  return { nodes: [] as SampleNode[], levelCounts: [] as number[] };
}

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
  options: {
    signal?: AbortSignal;
    state?: ReturnType<typeof createNativeAlignmentSamplingState>;
  } = {},
) {
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 0xffffffff)
    throw new RangeError("Alignment sample count must be an unsigned integer.");
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Alignment sampling cancelled.", "AbortError");
  };
  check();
  const flags = vertices.map((vertex) => vertex.flags);
  const state = options.state ?? createNativeAlignmentSamplingState();
  const eligible = vertices.flatMap((vertex, id) =>
    (vertex.flags & 5) === 4 ? [id] : [],
  );
  if (eligible.length <= budget)
    return {
      flags,
      levelCounts: state.levelCounts.slice(),
      nodes: state.nodes.length,
    };
  const points = vertices.map((vertex) => vertex.point.map(Math.fround));
  const inputFlags = vertices.map((vertex) => vertex.flags);
  const distinct = new Set(eligible.map((id) => points[id].join(",")));
  // The native loop cannot terminate if no depth can exceed the requested count.
  if (distinct.size <= budget)
    throw new RangeError(
      "Alignment samples cannot separate coincident vertices.",
    );
  const makeNode = (
    ids: number[],
    bounds: number[],
    depth: number,
  ): SampleNode => ({
    ids,
    bounds,
    depth,
    points,
    inputFlags,
    outputFlags: flags,
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
  const root = makeNode(eligible, bounds, 0);
  const nodes = state.nodes;
  nodes.push(root);
  let frontier = [root];
  const levelCounts = state.levelCounts;
  levelCounts.push(1);
  let localDepth = 0;
  do {
    check();
    if (localDepth++ > 256)
      throw new RangeError("Alignment sample subdivision did not converge.");
    const next: SampleNode[] = [];
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
      const children = new Map<number, SampleNode>();
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
      node.ids.map((id) => ({
        point: node.points[id],
        flags: node.inputFlags[id],
      })),
      node.center,
    );
    const representative =
      result.preferredIndex >= 0 ? result.preferredIndex : result.nearestIndex;
    if (representative >= 0) node.outputFlags[node.ids[representative]] |= 4;
  }
  return { flags, levelCounts: levelCounts.slice(), nodes: nodes.length };
}

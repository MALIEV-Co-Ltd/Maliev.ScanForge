import type { MeshProcessingOptions } from "./mesh-processing";
import type {
  NativeGlobalEvaluatorSearchNode,
  NativeGlobalEvaluatorDistance,
} from "./scan-native-global-evaluator-query";
import { nativeTargetStorage } from "./scan-native-target-storage";

/** Immutable shared node metadata. Twelve Doubles preserve bounds, center and
 * inverse; twelve uints hold eight child IDs+1, member offset/count, depth/flat. */
export interface NativeGlobalPackedIndex {
  kind: "native-global-index-v1";
  values: Float64Array;
  links: Uint32Array;
  memberships: Uint32Array;
}
type Node = NativeGlobalEvaluatorSearchNode<number> & {
  inverse?: readonly number[];
  depth?: number;
};
export function packNativeGlobalEvaluatorIndex(
  root?: Node,
  source?: Float32Array,
  options: MeshProcessingOptions = {},
): NativeGlobalPackedIndex {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Evaluator packing cancelled.", "AbortError");
  };
  const nodes: { node: Node; depth: number }[] = [],
    ids = new Map<Node, number>();
  const pending = root ? [{ node: root, depth: 0 }] : [];
  let count = 0,
    sharedBuffer: ArrayBufferLike | undefined,
    start = 0,
    contiguous = true;
  while (pending.length) {
    check();
    const item = pending.pop()!,
      { node, depth } = item;
    if (
      ids.has(node) ||
      depth > 10 ||
      (node.depth !== undefined && node.depth !== depth)
    )
      throw Error("Invalid evaluator node graph.");
    ids.set(node, nodes.length);
    nodes.push(item);
    const members = node.triangles;
    if (members.length) {
      if (!(members instanceof Uint32Array)) contiguous = false;
      else if (!sharedBuffer) {
        sharedBuffer = members.buffer;
        start = members.byteOffset;
      }
      if (
        members instanceof Uint32Array &&
        (members.buffer !== sharedBuffer ||
          members.byteOffset !== start + count * 4)
      )
        contiguous = false;
    }
    count += members.length;
    if (
      !Number.isSafeInteger(count) ||
      count > 0xffffffff ||
      nodes.length > 0xffffffff
    )
      throw RangeError("Packed evaluator capacity exceeded.");
    for (let child = 7; child >= 0; child--) {
      const value = node.children[child] as Node | undefined;
      if (value) pending.push({ node: value, depth: depth + 1 });
    }
  }
  const storage = (bytes: number) => nativeTargetStorage(source ?? [], bytes);
  const values = new Float64Array(storage(nodes.length * 96));
  const links = new Uint32Array(storage(nodes.length * 48));
  const memberships =
    contiguous && sharedBuffer
      ? new Uint32Array(sharedBuffer, start, count)
      : new Uint32Array(storage(count * 4));
  let cursor = 0;
  for (let id = 0; id < nodes.length; id++) {
    check();
    const { node, depth } = nodes[id],
      base = id * 12;
    for (let axis = 0; axis < 6; axis++)
      values[base + axis] = node.bounds[axis];
    for (let axis = 0; axis < 3; axis++) {
      values[base + 6 + axis] = node.center[axis];
      values[base + 9 + axis] = node.inverse?.[axis] ?? 0;
    }
    for (let child = 0; child < 8; child++) {
      const value = node.children[child] as Node | undefined;
      links[base + child] = value ? ids.get(value)! + 1 : 0;
    }
    links[base + 8] = cursor;
    links[base + 9] = node.triangles.length;
    links[base + 10] = depth;
    if (typeof node.flat !== "boolean")
      throw Error("Invalid evaluator node mode.");
    links[base + 11] = Number(node.flat);
    if (!contiguous)
      for (let slot = 0; slot < node.triangles.length; slot++)
        memberships[cursor + slot] = node.triangles[slot];
    cursor += node.triangles.length;
  }
  const packed: NativeGlobalPackedIndex = {
    kind: "native-global-index-v1",
    values,
    links,
    memberships,
  };
  validateNativeGlobalPackedIndex(packed);
  return packed;
}
export function validateNativeGlobalPackedIndex(
  index: NativeGlobalPackedIndex,
  faces = 0xffffffff,
  scratch?: Uint8Array,
) {
  if (
    !index ||
    index.kind !== "native-global-index-v1" ||
    !(index.values instanceof Float64Array) ||
    !(index.links instanceof Uint32Array) ||
    !(index.memberships instanceof Uint32Array) ||
    index.values.length % 12 ||
    index.values.length !== index.links.length
  )
    throw Error("Invalid packed evaluator metadata.");
  const { values, links, memberships } = index,
    count = links.length / 12;
  for (let i = 0; i < values.length; i++)
    if (i % 12 < 9 ? !Number.isFinite(values[i]) : Number.isNaN(values[i]))
      throw Error("Invalid packed evaluator coordinates.");
  for (const face of memberships)
    if (face >= faces) throw Error("Invalid packed evaluator face.");
  const seen = scratch ?? new Uint8Array(count),
    pending = count ? [0] : [];
  if (
    !(seen instanceof Uint8Array) ||
    seen.length !== count ||
    !(seen.buffer instanceof ArrayBuffer) ||
    seen.buffer === values.buffer ||
    seen.buffer === links.buffer ||
    seen.buffer === memberships.buffer
  )
    throw Error("Invalid packed evaluator validation scratch.");
  seen.fill(0);
  let visited = 0;
  while (pending.length) {
    const id = pending.pop()!,
      base = id * 12;
    if (
      seen[id] ||
      links[base + 10] > 10 ||
      links[base + 11] > 1 ||
      links[base + 8] + links[base + 9] > memberships.length
    )
      throw Error("Invalid packed evaluator node.");
    seen[id] = 1;
    visited++;
    if (id === 0 && links[base + 10] !== 0)
      throw Error("Invalid packed evaluator root.");
    for (let child = 0; child < 8; child++) {
      const encoded = links[base + child];
      if (!encoded) continue;
      const next = encoded - 1;
      if (next >= count || links[next * 12 + 10] !== links[base + 10] + 1)
        throw Error("Invalid packed evaluator child.");
      pending.push(next);
    }
  }
  if (visited !== count || (!count && memberships.length))
    throw Error("Unreachable packed evaluator metadata.");
}
export interface NativeGlobalPackedIndexScratch {
  stack: number[];
  projection: Float64Array;
  edgeFlags: Uint8Array;
}
const maximum = Math.fround(3.4028234663852886e38);
export function queryNativeGlobalPackedIndex(
  index: NativeGlobalPackedIndex,
  point: ArrayLike<number>,
  distance: Float64Array,
  projection: Float64Array,
  edgeFlags: Uint8Array,
  filterHidden: boolean,
  scratch: NativeGlobalPackedIndexScratch,
  evaluate: NativeGlobalEvaluatorDistance<number>,
) {
  const { values, links, memberships } = index,
    { stack } = scratch;
  stack.length = 0;
  if (links.length) stack.push(0);
  let best: number | undefined;
  try {
    while (stack.length) {
      const base = stack.pop()! * 12;
      let radius = Math.abs(distance[0]);
      if (
        radius !== maximum &&
        (Math.fround(point[0]) < values[base] - radius ||
          Math.fround(point[1]) < values[base + 1] - radius ||
          Math.fround(point[2]) < values[base + 2] - radius ||
          radius + values[base + 3] < Math.fround(point[0]) ||
          radius + values[base + 4] < Math.fround(point[1]) ||
          radius + values[base + 5] < Math.fround(point[2]))
      )
        continue;
      if (!links[base + 9]) {
        const nearIndex =
          (links[base + 11] || point[2] > values[base + 8] ? 0 : 4) +
          (point[0] <= values[base + 6] ? 1 : 0) +
          (point[1] <= values[base + 7] ? 2 : 0);
        const near = links[base + nearIndex];
        for (let i = 7; i >= 0; i--) {
          const child = links[base + i];
          if (child && child !== near) stack.push(child - 1);
        }
        if (near) stack.push(near - 1);
        continue;
      }
      const start = links[base + 8],
        end = start + links[base + 9];
      for (let slot = start; slot < end; slot++) {
        const triangle = memberships[slot];
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
  } finally {
    stack.length = 0;
  }
}

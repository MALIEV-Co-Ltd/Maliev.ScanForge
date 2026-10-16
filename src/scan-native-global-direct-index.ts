import type { MeshProcessingOptions } from "./mesh-processing";
import {
  indexedNoiseRoot,
  type IndexedNoiseTreeInput,
} from "./scan-noise-octree";
import { noiseOctantBox } from "./scan-noise-octree-bounds";
import { noiseTriangleCubeOverlap } from "./scan-noise-overlap";
import type { NoiseBounds } from "./scan-noise-octree-query";
import {
  nativeTargetStorage,
  nativeScratchStorage,
  releaseNativeScratch,
} from "./scan-native-target-storage";
import {
  validateNativeGlobalPackedIndex,
  type NativeGlobalPackedIndex,
} from "./scan-native-global-packed-index";

/** Internal construction budget, independent of and not a replacement for the
 * production pool's whole-scene admission. Counts live owned typed storage,
 * including final output copies. No authored buffers are transferred. */
export function buildNativeGlobalPackedIndex(
  input: IndexedNoiseTreeInput,
  minimumExtent: number,
  maximumDepth: number,
  options: MeshProcessingOptions = {},
  sourceBounds?: NoiseBounds,
  originalIds?: Uint32Array,
  maximumBytes = 512 * 1048576,
) {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > 512 * 1048576
  )
    throw RangeError("Invalid packed construction storage budget");
  const root = indexedNoiseRoot(
    input,
    minimumExtent,
    maximumDepth,
    options,
    sourceBounds,
  );
  const count = input.indices.length / 3;
  if (
    originalIds &&
    (!(originalIds instanceof Uint32Array) || originalIds.length !== count)
  )
    throw RangeError("Invalid packed construction original IDs");
  const owned = new Map<ArrayBufferLike, { bytes: number; output: boolean }>();
  let liveBytes = 0,
    peakBytes = 0,
    nodeCount = 0,
    memberCount = 0,
    complete = false;
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Evaluator construction cancelled.", "AbortError");
  };
  const allocate = (bytes: number, output = false): ArrayBufferLike => {
    check();
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      liveBytes + bytes > maximumBytes
    )
      throw RangeError(
        "Packed evaluator construction exceeds its typed storage budget",
      );
    const buffer = output
      ? nativeTargetStorage(input.coordinates, bytes)
      : nativeScratchStorage(bytes);
    owned.set(buffer, { bytes, output });
    liveBytes += bytes;
    peakBytes = Math.max(peakBytes, liveBytes);
    return buffer;
  };
  const release = (buffer: ArrayBufferLike) => {
    const entry = owned.get(buffer);
    if (!entry || entry.output) return;
    // Charge unreleased backing storage on older runtimes until construction ends.
    // This may reject a case conservatively; it never lowers the live-byte guard.
    if (!(buffer instanceof ArrayBuffer)) return;
    if (!releaseNativeScratch(buffer)) return;
    liveBytes -= entry.bytes;
    owned.delete(buffer);
  };
  const nodeBlock = 8192,
    memberBlock = 65536;
  const values: Float64Array[] = [],
    links: Uint32Array[] = [],
    members: Uint32Array[] = [];
  const field = (id: number) => {
    const block = Math.floor(id / nodeBlock);
    if (!values[block]) {
      values[block] = new Float64Array(allocate(nodeBlock * 96));
      links[block] = new Uint32Array(allocate(nodeBlock * 48));
    }
    return {
      value: values[block],
      link: links[block],
      base: (id % nodeBlock) * 12,
    };
  };
  const append = (id: number) => {
    if (memberCount === 0xffffffff)
      throw RangeError("Evaluator membership capacity exceeded");
    const block = Math.floor(memberCount / memberBlock);
    if (!members[block])
      members[block] = new Uint32Array(allocate(memberBlock * 4));
    members[block][memberCount++ % memberBlock] = originalIds
      ? originalIds[id]
      : id;
  };
  type Box = {
    bounds: NoiseBounds;
    center: readonly number[];
    inverse: readonly number[];
  };
  const a = [0, 0, 0],
    c = [0, 0, 0],
    d = [0, 0, 0],
    derived = new Float32Array(allocate(24));
  const visit = (
    box: Box,
    ids: Uint32Array,
    depth: number,
    eager: boolean,
  ): number => {
    check();
    if (nodeCount > 100000)
      throw RangeError("Noise tree exceeds its node budget");
    const id = nodeCount++,
      record = field(id),
      base = record.base;
    record.value.set(box.bounds, base);
    record.value.set(box.center, base + 6);
    record.value.set(box.inverse, base + 9);
    record.link[base + 8] = memberCount;
    record.link[base + 10] = depth;
    if (
      !eager &&
      !(
        ids.length >= 25 &&
        box.bounds[3] - box.bounds[0] > Math.fround(minimumExtent) &&
        depth < maximumDepth
      )
    ) {
      record.link[base + 9] = ids.length;
      for (let i = 0; i < ids.length; i++) {
        if (i % 1024 === 0) check();
        append(ids[i]);
      }
      release(ids.buffer);
      return id;
    }
    const boxes = Array.from({ length: 8 }, (_, child) =>
      noiseOctantBox(box.bounds, child),
    );
    const masks = new Uint8Array(allocate(ids.length));
    const counts = Array<number>(8).fill(0),
      cursors = Array<number>(8).fill(0);
    const { coordinates, indices, triangleBounds, boundsIds } = input;
    for (let slot = 0; slot < ids.length; slot++) {
      if (slot % 1024 === 0) check();
      const face = ids[slot],
        t = triangleBounds ? (boundsIds?.[face] ?? face) * 6 : 0;
      const aOffset = indices[face * 3] * 3,
        cOffset = indices[face * 3 + 1] * 3,
        dOffset = indices[face * 3 + 2] * 3;
      if (!triangleBounds)
        for (let axis = 0; axis < 3; axis++) {
          const x = coordinates[aOffset + axis],
            y = coordinates[cOffset + axis],
            z = coordinates[dOffset + axis];
          derived[axis] = Math.min(x, y, z);
          derived[axis + 3] = Math.max(x, y, z);
        }
      const bounds = triangleBounds ?? derived;
      for (let child = 0; child < 8; child++) {
        const childBox = boxes[child],
          b = childBox.bounds;
        if (
          bounds[t + 3] < b[0] ||
          bounds[t + 4] < b[1] ||
          bounds[t + 5] < b[2] ||
          bounds[t] > b[3] ||
          bounds[t + 1] > b[4] ||
          bounds[t + 2] > b[5]
        )
          continue;
        for (let axis = 0; axis < 3; axis++) {
          a[axis] =
            (coordinates[aOffset + axis] - childBox.center[axis]) *
            childBox.inverse[axis];
          c[axis] =
            (coordinates[cOffset + axis] - childBox.center[axis]) *
            childBox.inverse[axis];
          d[axis] =
            (coordinates[dOffset + axis] - childBox.center[axis]) *
            childBox.inverse[axis];
        }
        if (noiseTriangleCubeOverlap(a, c, d)) {
          masks[slot] |= 1 << child;
          counts[child]++;
        }
      }
    }
    const children = counts.map((n) =>
      n ? new Uint32Array(allocate(n * 4)) : undefined,
    );
    for (let slot = 0; slot < ids.length; slot++) {
      if (slot % 1024 === 0) check();
      for (let child = 0; child < 8; child++)
        if (masks[slot] & (1 << child))
          children[child]![cursors[child]++] = ids[slot];
    }
    release(masks.buffer);
    release(ids.buffer);
    for (let child = 0; child < 8; child++) {
      const childIds = children[child];
      if (!eager && !childIds) continue;
      children[child] = undefined;
      const next = visit(
        boxes[child],
        childIds ?? new Uint32Array(allocate(0)),
        depth + 1,
        false,
      );
      record.link[base + child] = next + 1;
    }
    return id;
  };
  try {
    const initial = new Uint32Array(allocate(count * 4));
    for (let i = 0; i < count; i++) {
      if (i % 4096 === 0) check();
      initial[i] = i;
    }
    visit(root, initial, 0, true);
    // Retire each staging family as soon as its immutable handoff is filled.
    // Earlier targets stay live in the scene budget; allocating all three
    // handoff buffers before retiring any staging blocks creates a needless peak.
    const packedValues = new Float64Array(allocate(nodeCount * 96, true));
    for (let block = 0; block < values.length; block++) {
      check();
      const n = Math.min(nodeBlock, nodeCount - block * nodeBlock) * 12;
      packedValues.set(values[block].subarray(0, n), block * nodeBlock * 12);
      release(values[block].buffer);
    }
    const packedLinks = new Uint32Array(allocate(nodeCount * 48, true));
    for (let block = 0; block < links.length; block++) {
      check();
      const n = Math.min(nodeBlock, nodeCount - block * nodeBlock) * 12;
      packedLinks.set(links[block].subarray(0, n), block * nodeBlock * 12);
      release(links[block].buffer);
    }
    const packedMembers = new Uint32Array(allocate(memberCount * 4, true));
    for (let block = 0; block < members.length; block++) {
      check();
      packedMembers.set(
        members[block].subarray(
          0,
          Math.min(memberBlock, memberCount - block * memberBlock),
        ),
        block * memberBlock,
      );
      release(members[block].buffer);
    }
    const output: NativeGlobalPackedIndex = {
      kind: "native-global-index-v1",
      values: packedValues,
      links: packedLinks,
      memberships: packedMembers,
    };
    const validationScratch = new Uint8Array(allocate(nodeCount));
    validateNativeGlobalPackedIndex(output, 0xffffffff, validationScratch);
    release(validationScratch.buffer);
    check();
    complete = true;
    return {
      index: output,
      construction: {
        peakTypedBytes: peakBytes,
        retainedTypedBytes: nodeCount * 144 + memberCount * 4,
        nodes: nodeCount,
        memberships: memberCount,
        maximumBytes,
      },
    };
  } finally {
    for (const [buffer, entry] of owned) {
      if (!entry.output) release(buffer);
      else if (!complete && buffer instanceof ArrayBuffer) {
        (
          buffer as ArrayBuffer & { transfer?: (size: number) => ArrayBuffer }
        ).transfer?.(0);
      }
    }
    owned.clear();
  }
}

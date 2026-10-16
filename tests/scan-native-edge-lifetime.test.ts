import { afterEach, expect, it, vi } from "vitest";
import { createNativeAlignmentEdgeRecords } from "../src/scan-native-edge-records";
import {
  nativeBuildAlignmentAdjacency,
  nativeBuildAlignmentNeighbourMasks,
  nativeLinkAlignmentBucket,
} from "../src/scan-native-alignment-adjacency";
const observed = vi.hoisted(
  () => [] as { byteLength?: number; size: number }[],
);
vi.mock("../src/scan-native-edge-records", async (original) => {
  const module =
    await original<typeof import("../src/scan-native-edge-records")>();
  return {
    ...module,
    createNativeAlignmentEdgeRecords(
      ...args: Parameters<typeof module.createNativeAlignmentEdgeRecords>
    ) {
      const result = module.createNativeAlignmentEdgeRecords(...args);
      observed.push(result);
      return result;
    },
  };
});
afterEach(() => {
  observed.length = 0;
  vi.restoreAllMocks();
});
it.each([false, true])(
  "retires an owned directory exactly once; wide fallback=%s",
  (wide) => {
    const directory = createNativeAlignmentEdgeRecords(
      wide ? 0x100000010 : 10,
      30,
    );
    directory.remember(0, 1, 0);
    directory.dispose();
    expect(directory.byteLength).toBe(0);
    expect(directory.size).toBe(0);
    expect(() => directory.dispose()).not.toThrow();
    expect(() => directory.get(0, 1)).toThrow("disposed");
    expect(() => directory.set(0, 1, 0)).toThrow("disposed");
    expect(() => directory.remember(0, 1, 0)).toThrow("disposed");
  },
);
it("releases the two current private backing buffers without waiting for collection", () => {
  const transfer = (
    ArrayBuffer.prototype as ArrayBuffer & {
      transfer?: (size: number) => ArrayBuffer;
    }
  ).transfer;
  expect(transfer).toBeTypeOf("function");
  const released: ArrayBuffer[] = [];
  vi.spyOn(
    ArrayBuffer.prototype as ArrayBuffer & {
      transfer(size: number): ArrayBuffer;
    },
    "transfer",
  ).mockImplementation(function (this: ArrayBuffer, size: number) {
    released.push(this);
    return transfer!.call(this, size);
  });
  const directory = createNativeAlignmentEdgeRecords(10, 30);
  directory.remember(0, 1, 0);
  directory.dispose();
  directory.dispose();
  expect(released).toHaveLength(2);
  expect(released.every((buffer) => buffer.byteLength === 0)).toBe(true);
});
it("drops private storage when buffer transfer is unavailable and cleanup ignores cancellation", () => {
  const controller = new AbortController();
  const directory = createNativeAlignmentEdgeRecords(10, 30, {
    signal: controller.signal,
  });
  directory.remember(0, 1, 0);
  vi.spyOn(
    ArrayBuffer.prototype as ArrayBuffer & {
      transfer(size: number): ArrayBuffer;
    },
    "transfer",
  ).mockImplementation(() => {
    throw Error("unsupported");
  });
  controller.abort();
  expect(() => directory.dispose()).not.toThrow();
  expect(directory.byteLength).toBe(0);
  expect(directory.size).toBe(0);
});
const vertices = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0);
const triangles = Uint32Array.of(0, 1, 2, 1, 0, 3);
it.each([nativeBuildAlignmentAdjacency, nativeBuildAlignmentNeighbourMasks])(
  "retires temporary storage after an adjacency result is published: %s",
  (build) => {
    const before = vertices.slice();
    build(vertices, triangles);
    expect(observed).toHaveLength(1);
    expect(observed[0].byteLength).toBe(0);
    expect(observed[0].size).toBe(0);
    expect(vertices).toEqual(before);
  },
);
it("retires bucket storage on success, invalid geometry and cancellation", () => {
  const buckets = Uint32Array.of(0, 0, 0, 0);
  nativeLinkAlignmentBucket(triangles, buckets, 0);
  expect(() =>
    nativeLinkAlignmentBucket(Uint32Array.of(0, 1, 99), buckets, 0),
  ).toThrow();
  let checks = 0;
  const signal = {
    get aborted() {
      return ++checks > 1;
    },
  } as AbortSignal;
  expect(() =>
    nativeLinkAlignmentBucket(triangles, buckets, 0, { signal }),
  ).toThrow();
  expect(observed).toHaveLength(3);
  expect(
    observed.every(
      (directory) => directory.byteLength === 0 && directory.size === 0,
    ),
  ).toBe(true);
});

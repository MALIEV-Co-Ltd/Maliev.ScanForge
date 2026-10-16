import { expect, it, vi } from "vitest";
import native from "./fixtures/alignment-target-builder.json";
import * as octree from "../src/scan-noise-octree";
import { prepareNativeGlobalMeshEvaluator } from "../src/scan-native-global-surface";
import { packNativeGlobalEvaluatorIndex } from "../src/scan-native-global-packed-index";

it("finishes within a handoff budget that cannot hold all staging and output families together", () => {
  const input = small();
  const expected = buildNativeGlobalPackedIndex(input, 0.5, 10).index;
  const result = buildNativeGlobalPackedIndex(
    input,
    0.5,
    10,
    {},
    undefined,
    undefined,
    1442800,
  );
  expect(result.index).toEqual(expected);
  expect(result.construction.peakTypedBytes).toBeLessThanOrEqual(1442800);
});

it.each(
  native.cases.flatMap((c) =>
    [false, true].map((compactBounds) => ({ ...c, compactBounds })),
  ),
)(
  "constructs packed native nodes without a temporary graph: $name, compact=$compactBounds",
  (c) => {
    const input = {
      vertices: Float32Array.from(c.points.flat(2)),
      triangles: Uint32Array.from({ length: c.points.length * 3 }, (_, i) => i),
      flags: Uint8Array.from(c.flags),
      cachedBounds: c.cachedBounds ?? undefined,
      minimumExtent: c.minextent,
      maximumDepth: c.maxdepth,
      filterHidden: c.filterHidden,
      compactBounds: c.compactBounds,
    };
    const graph = prepareNativeGlobalMeshEvaluator(input);
    const expected = packNativeGlobalEvaluatorIndex(graph.root, input.vertices);
    const vertices = input.vertices.slice(),
      triangles = input.triangles.slice();
    const trap = vi
      .spyOn(octree, "prepareIndexedNoiseOctree")
      .mockImplementation(() => {
        throw Error(
          "Temporary object graph construction is forbidden in packed mode",
        );
      });
    try {
      const result = prepareNativeGlobalMeshEvaluator({
        ...input,
        packedNodes: true,
      });
      expect(result.root).toBeUndefined();
      expect(result.packedIndex).toEqual(expected);
      expect(result.surface.normals).toEqual(graph.surface.normals);
      expect(result.degenerate).toEqual(graph.degenerate);
      expect(input.vertices).toEqual(vertices);
      expect(input.triangles).toEqual(triangles);
    } finally {
      trap.mockRestore();
    }
  },
);

import { buildNativeGlobalPackedIndex } from "../src/scan-native-global-direct-index";
const small = () => ({
  coordinates: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  indices: Uint32Array.of(0, 1, 2),
});
it("enforces live typed storage admission and permits a clean retry after failure", () => {
  const input = small(),
    before = input.coordinates.slice();
  expect(() =>
    buildNativeGlobalPackedIndex(
      input,
      0.5,
      10,
      {},
      undefined,
      undefined,
      1024,
    ),
  ).toThrow(/storage budget/);
  const result = buildNativeGlobalPackedIndex(
    input,
    0.5,
    10,
    {},
    undefined,
    undefined,
    2 * 1048576,
  );
  expect(result.construction.peakTypedBytes).toBeLessThanOrEqual(2 * 1048576);
  expect(result.construction.retainedTypedBytes).toBe(
    result.index.values.byteLength +
      result.index.links.byteLength +
      result.index.memberships.byteLength,
  );
  expect(input.coordinates).toEqual(before);
  expect(input.indices).toEqual(Uint32Array.of(0, 1, 2));
});
it("releases failed construction without detaching authored buffers on cancellation", () => {
  const input = small();
  let checks = 0;
  const signal = {
    get aborted() {
      return ++checks > 8;
    },
  } as AbortSignal;
  expect(() =>
    buildNativeGlobalPackedIndex(input, 0.5, 10, { signal }),
  ).toThrow(/cancelled/);
  expect(input.coordinates.byteLength).toBe(36);
  expect(input.indices.byteLength).toBe(12);
  expect(buildNativeGlobalPackedIndex(input, 0.5, 10).index.links.length).toBe(
    9 * 12,
  );
});
it("validates original face remapping and construction budgets", () => {
  const input = small();
  expect(() =>
    buildNativeGlobalPackedIndex(
      input,
      0.5,
      10,
      {},
      undefined,
      Uint32Array.of(0, 1),
    ),
  ).toThrow(/original IDs/);
  for (const limit of [0, -1, NaN, Infinity, 512 * 1048576 + 1])
    expect(() =>
      buildNativeGlobalPackedIndex(
        input,
        0.5,
        10,
        {},
        undefined,
        undefined,
        limit,
      ),
    ).toThrow(/budget/);
  const result = buildNativeGlobalPackedIndex(
    input,
    0.5,
    10,
    {},
    undefined,
    Uint32Array.of(7),
  );
  expect([...result.index.memberships].every((id) => id === 7)).toBe(true);
});
it("keeps unreleased scratch charged on runtimes without ArrayBuffer transfer", () => {
  const input = small(),
    expected = buildNativeGlobalPackedIndex(input, 0.5, 10).index;
  const descriptor = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    "transfer",
  )!;
  Object.defineProperty(ArrayBuffer.prototype, "transfer", {
    ...descriptor,
    value: undefined,
  });
  try {
    const result = buildNativeGlobalPackedIndex(
      input,
      0.5,
      10,
      {},
      undefined,
      undefined,
      2 * 1048576,
    );
    expect(result.index).toEqual(expected);
    expect(result.construction.peakTypedBytes).toBeLessThanOrEqual(2 * 1048576);
  } finally {
    Object.defineProperty(ArrayBuffer.prototype, "transfer", descriptor);
  }
});

it("detaches only owned scratch after a partially allocated construction exceeds budget", () => {
  const input = small();
  const host = ArrayBuffer.prototype as unknown as {
    transfer(size: number): ArrayBuffer;
  };
  const original = host.transfer;
  const released: ArrayBuffer[] = [];
  const spy = vi.spyOn(host, "transfer").mockImplementation(function (
    this: ArrayBuffer,
    size: number,
  ) {
    expect(this).not.toBe(input.coordinates.buffer);
    expect(this).not.toBe(input.indices.buffer);
    released.push(this);
    return original.call(this, size);
  });
  try {
    expect(() =>
      buildNativeGlobalPackedIndex(
        input,
        0.5,
        10,
        {},
        undefined,
        undefined,
        1442000,
      ),
    ).toThrow(/storage budget/);
    expect(released.length).toBeGreaterThan(2);
    expect(released.every((buffer) => buffer.byteLength === 0)).toBe(true);
    expect(input.coordinates.byteLength).toBe(36);
    expect(input.indices.byteLength).toBe(12);
  } finally {
    spy.mockRestore();
  }
});

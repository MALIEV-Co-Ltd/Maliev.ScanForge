import { expect, it, vi } from "vitest";
import fixture from "./fixtures/global-fine-evaluator-query-native.json";
import { packGlobalEvaluatorFixture } from "./helpers/global-evaluator-packed-fixture";
import { nativeGlobalPackedEvaluator } from "../src/scan-native-global-packed-evaluator";
import { prepareNativeGlobalMeshEvaluator } from "../src/scan-native-global-surface";
import {
  packNativeGlobalEvaluatorIndex,
  queryNativeGlobalPackedIndex,
} from "../src/scan-native-global-packed-index";
import * as triangleDistance from "../src/scan-native-global-triangle";
import {
  createNativeTargetStorageBudget,
  withNativeTargetStorageBudget,
} from "../src/scan-native-target-storage";
const bits = (v: ArrayLike<number>) =>
  Buffer.from(Float64Array.from(v).buffer).toString("hex");
it.each(fixture.cases)(
  "preserves original query bits with derived triangle bounds: $name",
  (c) => {
    const { root, surface } = packGlobalEvaluatorFixture(c.tree);
    const compact = {
      ...surface,
      bounds: new Float32Array(),
      deriveBounds: true,
    };
    const provider = nativeGlobalPackedEvaluator(compact);
    const distance = Float64Array.of(c.radius),
      projection = Float64Array.of(11, 12, 13),
      flags = Uint8Array.of(255);
    const scratch = {
      stack: [],
      projection: new Float64Array(3),
      edgeFlags: new Uint8Array(1),
    };
    expect(
      provider.query(
        root,
        c.point,
        distance,
        projection,
        flags,
        !!c.mode,
        scratch,
      ) ?? null,
    ).toBe(c.target);
    expect(bits(distance)).toBe(c.distanceBits);
    expect(bits(projection)).toBe(c.projectionBits);
    expect(flags[0]).toBe(c.edgeFlags);
    expect(scratch.stack).toHaveLength(0);
  },
);
function grid(compactBounds = true) {
  const side = 12,
    vertices = new Float32Array(side * side * 3),
    ids = [];
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      vertices.set([x, y, 0.1 * Math.sin(x + y)], (y * side + x) * 3);
      if (x < side - 1 && y < side - 1) {
        const a = y * side + x;
        ids.push(a, a + 1, a + side, a + side, a + 1, a + side + 1);
      }
    }
  return { vertices, triangles: Uint32Array.from(ids), compactBounds };
}
it("retains no per-face bound cache in compact mode and packs all ordered memberships into one buffer", () => {
  const input = grid(),
    before = input.vertices.slice();
  const target = prepareNativeGlobalMeshEvaluator(input);
  expect(target.surface.bounds.byteLength).toBe(0);
  const buffers = new Set(),
    pending = target.root ? [target.root] : [];
  let members = 0,
    leaves = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (node.triangles.length) {
      buffers.add(node.triangles.buffer);
      members += node.triangles.length;
      leaves++;
    }
    for (const child of Object.values(node.children))
      if (child) pending.push(child);
  }
  expect(leaves).toBeGreaterThan(1);
  expect(buffers.size).toBe(1);
  expect([...buffers][0]).toHaveProperty("byteLength", members * 4);
  expect(input.vertices).toEqual(before);
  expect(input.triangles.byteLength).toBeGreaterThan(0);
});
it("preserves an explicit fast cached-bound mode", () => {
  const input = grid(false),
    target = prepareNativeGlobalMeshEvaluator(input);
  expect(target.surface.bounds.length).toBe(input.triangles.length * 2);
});
it("rejects malformed derived-bound carriers without treating missing caches as implicit compact mode", () => {
  const { surface } = packGlobalEvaluatorFixture(fixture.cases[0].tree);
  expect(() =>
    nativeGlobalPackedEvaluator({ ...surface, bounds: new Float32Array() }),
  ).toThrow();
  const cachedWithDerivedFlag = { ...surface, deriveBounds: true };
  expect(() => nativeGlobalPackedEvaluator(cachedWithDerivedFlag)).toThrow();
});

it.each([false, true])(
  "preserves repeated-membership outputs and query-local reuse (packed=%s)",
  (packed) => {
    const { root, surface } = packGlobalEvaluatorFixture(fixture.cases[0].tree);
    surface.flags![0] = 2;
    const duplicate = {
      ...root,
      triangles: new Uint32Array(),
      children: [{ ...root }, { ...root }, { ...root }],
    };
    const index = packNativeGlobalEvaluatorIndex(duplicate);
    const provider = nativeGlobalPackedEvaluator({
      ...surface,
      bounds: new Float32Array(),
      deriveBounds: true,
    });
    const originalDistance = triangleDistance.nativeGlobalTriangleDistance;
    const expected = (point: number[]) => {
      const projection = Float64Array.of(11, 12, 13),
        flags = Uint8Array.of(255);
      const distance = originalDistance(
        point,
        surface.vertices.subarray(0, 3),
        surface.vertices.subarray(3, 6),
        surface.vertices.subarray(6, 9),
        surface.normals.subarray(0, 3),
        1,
        projection,
        flags,
      );
      return {
        hit: 0,
        distance: bits([distance]),
        projection: bits(projection),
        flags: flags[0],
      };
    };
    const spy = vi.spyOn(triangleDistance, "nativeGlobalTriangleDistance");
    const evaluations = packed ? 1 : 3;
    const query = (point: number[], hidden: boolean) => {
      const distance = Float64Array.of(1),
        projection = Float64Array.of(11, 12, 13),
        flags = Uint8Array.of(255);
      const scratch = {
        stack: [],
        projection: new Float64Array(3),
        edgeFlags: new Uint8Array(1),
      };
      const hit = packed
        ? provider.queryPacked(
            index,
            point,
            distance,
            projection,
            flags,
            hidden,
            scratch,
          )
        : provider.query(
            duplicate,
            point,
            distance,
            projection,
            flags,
            hidden,
            scratch,
          );
      return {
        hit,
        distance: bits(distance),
        projection: bits(projection),
        flags: flags[0],
      };
    };
    try {
      expect(query([0.25, 0.25, 0.1], false)).toEqual({
        hit: 0,
        distance: bits([0.1]),
        projection: bits([0.25, 0.25, 0]),
        flags: 0,
      });
      expect(spy).toHaveBeenCalledTimes(evaluations);
      expect(query([0.75, 0.1, 0.15], false)).toEqual(
        expected([0.75, 0.1, 0.15]),
      );
      expect(spy).toHaveBeenCalledTimes(2 * evaluations);
      expect(query([0.25, 0.25, 0.1], true)).toEqual({
        hit: undefined,
        distance: bits([1]),
        projection: bits([11, 12, 13]),
        flags: 255,
      });
      expect(query([0.25, 0.25, 0.1], false).distance).toBe(bits([0.1]));
      expect(spy).toHaveBeenCalledTimes(3 * evaluations);
    } finally {
      spy.mockRestore();
    }
  },
);

it("keeps colliding triangle IDs distinct when a later face is closer", () => {
  const first = fixture.cases[0].tree.triangles![0];
  const second = {
    ...first,
    id: 1024,
    vertices: first.vertices.map((v) => [v[0], v[1], 0.05]),
  };
  const { root, surface } = packGlobalEvaluatorFixture({
    children: [
      { triangles: [first] },
      { triangles: [second] },
      { triangles: [first] },
    ],
  });
  const provider = nativeGlobalPackedEvaluator({
    ...surface,
    bounds: new Float32Array(),
    deriveBounds: true,
  });
  const index = packNativeGlobalEvaluatorIndex(root);
  const run = (packed: boolean) => {
    const distance = Float64Array.of(1),
      projection = Float64Array.of(11, 12, 13),
      flags = Uint8Array.of(255);
    const scratch = {
      stack: [],
      projection: new Float64Array(3),
      edgeFlags: new Uint8Array(1),
    };
    const hit = packed
      ? provider.queryPacked(
          index,
          [0.25, 0.25, 0.1],
          distance,
          projection,
          flags,
          false,
          scratch,
        )
      : provider.query(
          root,
          [0.25, 0.25, 0.1],
          distance,
          projection,
          flags,
          false,
          scratch,
        );
    return {
      hit,
      distance: bits(distance),
      projection: bits(projection),
      flags: flags[0],
    };
  };
  const expected = run(false);
  expect(expected.hit).toBe(1024);
  expect(run(true)).toEqual(expected);
});

it("charges the fixed 4 KiB query memo to the active preparation ledger", () => {
  const { surface } = packGlobalEvaluatorFixture(fixture.cases[0].tree);
  const input = { ...surface, bounds: new Float32Array(), deriveBounds: true };
  const budget = createNativeTargetStorageBudget(4096, 0);
  withNativeTargetStorageBudget(budget, () => {
    const provider = nativeGlobalPackedEvaluator(input);
    expect(nativeGlobalPackedEvaluator(input)).toBe(provider);
  });
  expect(budget.snapshot()).toEqual({
    limit: 4096,
    reserved: 0,
    live: 4096,
    peak: 4096,
  });
  const insufficient = createNativeTargetStorageBudget(4095, 0);
  expect(() =>
    withNativeTargetStorageBudget(insufficient, () =>
      nativeGlobalPackedEvaluator({ ...input }),
    ),
  ).toThrow(/storage admission/);
  expect(insufficient.snapshot().live).toBe(0);
});

it("retains repeated cutoff evaluations when the radius exceeds the Float32 sentinel", () => {
  const index = packNativeGlobalEvaluatorIndex({
    bounds: [-1, -1, -1, 1, 1, 1],
    center: [0, 0, 0],
    flat: false,
    children: [],
    triangles: Uint32Array.of(0, 1, 0),
  });
  const maximum = Math.fround(3.4028234663852886e38);
  const run = (memo?: Uint32Array) => {
    const distance = Float64Array.of(1e100),
      projection = Float64Array.of(11, 12, 13),
      flags = Uint8Array.of(255);
    const scratch = {
      stack: [],
      projection: new Float64Array(3),
      edgeFlags: new Uint8Array(1),
    };
    const hit = queryNativeGlobalPackedIndex(
      index,
      [0, 0, 0],
      distance,
      projection,
      flags,
      false,
      scratch,
      (id, _point, radius, out, edges) => {
        edges[0] = 0;
        if (id === 0 && radius < 1e99) return maximum;
        out.set([id, id, id]);
        return id === 0 ? 1e200 : 1e98;
      },
      memo,
    );
    return {
      hit,
      distance: bits(distance),
      projection: bits(projection),
      flags: flags[0],
    };
  };
  const original = run();
  expect(original.hit).toBe(0);
  expect(original.distance).toBe(bits([maximum]));
  expect(run(new Uint32Array(1024))).toEqual(original);
});

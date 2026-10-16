import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-evaluator-query-native.json";
import { packGlobalEvaluatorFixture } from "./helpers/global-evaluator-packed-fixture";
import { nativeGlobalPackedEvaluator } from "../src/scan-native-global-packed-evaluator";
import { prepareNativeGlobalMeshEvaluator } from "../src/scan-native-global-surface";
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

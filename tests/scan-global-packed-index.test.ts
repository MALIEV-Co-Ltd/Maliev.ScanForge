import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-evaluator-query-native.json";
import { packGlobalEvaluatorFixture } from "./helpers/global-evaluator-packed-fixture";
import * as evaluator from "../src/scan-native-global-packed-evaluator";
import { validateNativeGlobalPackedIndex } from "../src/scan-native-global-packed-index";
import { prepareNativeGlobalMeshEvaluator } from "../src/scan-native-global-surface";
import {
  nativeGlobalMeshTargetData,
  installNativeGlobalMeshTarget,
} from "../src/scan-native-global-mesh-target";
const bits = (v: ArrayLike<number>) =>
  Buffer.from(Float64Array.from(v).buffer).toString("hex");
it.each(fixture.cases)(
  "preserves native query bits through packed nodes: $name",
  (c) => {
    const { root, surface } = packGlobalEvaluatorFixture(c.tree);
    const index = evaluator.packNativeGlobalEvaluatorIndex(root);
    const provider = evaluator.nativeGlobalPackedEvaluator(surface);
    const distance = Float64Array.of(c.radius),
      projection = Float64Array.of(11, 12, 13),
      flags = Uint8Array.of(255);
    const scratch = {
      stack: [],
      projection: new Float64Array(3),
      edgeFlags: new Uint8Array(1),
    };
    expect(
      provider.queryPacked(
        index,
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
it("shares packed node metadata through restoration without retaining a cloned node graph", () => {
  const vertices = new Float32Array(new SharedArrayBuffer(36));
  vertices.set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array(new SharedArrayBuffer(12));
  triangles.set([0, 1, 2]);
  const input = { vertices, triangles, packedNodes: true };
  const target = prepareNativeGlobalMeshEvaluator(input);
  expect(target.root).toBeUndefined();
  expect(target.packedIndex!.values.buffer).toBeInstanceOf(SharedArrayBuffer);
  expect(target.packedIndex!.links.buffer).toBeInstanceOf(SharedArrayBuffer);
  const packet = structuredClone({
    input,
    data: nativeGlobalMeshTargetData(input),
  });
  expect(packet.data.root).toBeUndefined();
  const restored = installNativeGlobalMeshTarget(packet.input, packet.data);
  expect(restored.query([0.25, 0.25, 0.1], 1).found).toBe(true);
  const damaged = structuredClone(packet);
  damaged.data.packedIndex!.links = new Uint32Array(
    damaged.data.packedIndex!.links,
  );
  damaged.data.packedIndex!.links[0] = 0xffffffff;
  expect(() =>
    installNativeGlobalMeshTarget(damaged.input, damaged.data),
  ).toThrow();
});
it("validates empty indexes, ranges, reachability and child cycles", () => {
  const empty = evaluator.packNativeGlobalEvaluatorIndex();
  expect(() => validateNativeGlobalPackedIndex(empty, 0)).not.toThrow();
  const { root } = packGlobalEvaluatorFixture(fixture.cases[0].tree);
  const index = evaluator.packNativeGlobalEvaluatorIndex(root);
  for (const damage of [
    (v: typeof index) => {
      v.values[0] = NaN;
    },
    (v: typeof index) => {
      v.links[0] = 1;
    },
    (v: typeof index) => {
      v.links[11] = 2;
    },
    (v: typeof index) => {
      v.links[9] = 0xffffffff;
    },
    (v: typeof index) => {
      v.memberships[0] = 0xffffffff;
    },
  ]) {
    const bad = structuredClone(index);
    damage(bad);
    expect(() => validateNativeGlobalPackedIndex(bad)).toThrow();
  }
});
it("uses caller-owned validation scratch without corrupting immutable index buffers", () => {
  const { root } = packGlobalEvaluatorFixture(fixture.cases[0].tree);
  const index = evaluator.packNativeGlobalEvaluatorIndex(root);
  const count = index.links.length / 12;
  const scratch = new Uint8Array(count).fill(255);
  expect(() =>
    validateNativeGlobalPackedIndex(index, 0xffffffff, scratch),
  ).not.toThrow();
  expect([...scratch].every((v) => v === 1)).toBe(true);
  for (const invalid of [
    new Uint8Array(count + 1),
    new Uint8Array(new SharedArrayBuffer(count)),
    new Uint8Array(index.values.buffer, 0, count),
  ])
    expect(() =>
      validateNativeGlobalPackedIndex(index, 0xffffffff, invalid),
    ).toThrow(/scratch/);
});

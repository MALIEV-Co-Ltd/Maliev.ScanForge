import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-evaluator-query-native.json";
import { nativeGlobalPackedEvaluator } from "../src/scan-native-global-packed-evaluator";
import type { NativeGlobalEvaluatorSearchNode } from "../src/scan-native-global-evaluator-query";
import { packGlobalEvaluatorFixture } from "./helpers/global-evaluator-packed-fixture";
const bits = (v: Float64Array) => Buffer.from(v.buffer).toString("hex");

it.each(fixture.cases)(
  "matches original query from packed carriers: $name",
  (c) => {
    const { root, surface } = packGlobalEvaluatorFixture(c.tree);
    const provider = nativeGlobalPackedEvaluator(surface);
    expect(provider.surface).toBe(surface);
    expect(nativeGlobalPackedEvaluator(surface)).toBe(provider);
    const scratch = {
      stack: [] as NativeGlobalEvaluatorSearchNode<number>[],
      projection: new Float64Array(3),
      edgeFlags: new Uint8Array(1),
    };
    const distance = Float64Array.of(c.radius),
      projection = Float64Array.of(11, 12, 13),
      flags = Uint8Array.of(255);
    const before = [
      surface.vertices,
      surface.triangles,
      surface.normals,
      surface.bounds,
      surface.flags!,
    ].map((v) => Buffer.from(v.buffer).toString("hex"));
    for (let repeat = 0; repeat < 2; repeat++) {
      distance[0] = c.radius;
      projection.set([11, 12, 13]);
      flags[0] = 255;
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
    }
    expect(
      [
        surface.vertices,
        surface.triangles,
        surface.normals,
        surface.bounds,
        surface.flags!,
      ].map((v) => Buffer.from(v.buffer).toString("hex")),
    ).toEqual(before);
  },
);

it("rejects malformed carriers before retaining a provider", () => {
  const { surface } = packGlobalEvaluatorFixture(fixture.cases[0].tree);
  expect(() =>
    nativeGlobalPackedEvaluator({ ...surface, normals: new Float32Array(0) }),
  ).toThrow();
  expect(() =>
    nativeGlobalPackedEvaluator({
      ...surface,
      triangles: Uint32Array.of(999, 0, 1),
    }),
  ).toThrow();
  expect(() =>
    nativeGlobalPackedEvaluator({ ...surface, flags: new Uint8Array(0) }),
  ).toThrow();
  const vertices = surface.vertices.slice();
  vertices[0] = NaN;
  expect(() => nativeGlobalPackedEvaluator({ ...surface, vertices })).toThrow();
});

it("retains shared immutable carriers without detaching or copying them", () => {
  const { surface, root } = packGlobalEvaluatorFixture(fixture.cases[0].tree);
  const vertices = new Float32Array(
    new SharedArrayBuffer(surface.vertices.byteLength),
  );
  vertices.set(surface.vertices);
  const input = { ...surface, vertices };
  const provider = nativeGlobalPackedEvaluator(input);
  expect(provider.surface.vertices).toBe(vertices);
  const out = Float64Array.of(1),
    p = new Float64Array(3),
    flags = new Uint8Array(1);
  provider.query(root, [0.25, 0.25, 0.1], out, p, flags, false, {
    stack: [],
    projection: new Float64Array(3),
    edgeFlags: new Uint8Array(1),
  });
  expect(out[0]).toBe(0.1);
  expect(vertices.byteLength).toBe(surface.vertices.byteLength);
});

it("does not treat a filtered triangle as a hit for a radius above the Float32 sentinel", () => {
  const { root, surface } = packGlobalEvaluatorFixture(fixture.cases[0].tree);
  surface.flags![0] = 2;
  const distance = Float64Array.of(1e100),
    projection = Float64Array.of(11, 12, 13),
    flags = Uint8Array.of(255);
  expect(
    nativeGlobalPackedEvaluator(surface).query(
      root,
      [0.25, 0.25, 0.1],
      distance,
      projection,
      flags,
      true,
      {
        stack: [],
        projection: new Float64Array(3),
        edgeFlags: new Uint8Array(1),
      },
    ),
  ).toBeUndefined();
  expect(distance[0]).toBe(1e100);
  expect([...projection]).toEqual([11, 12, 13]);
  expect(flags[0]).toBe(255);
});

it("releases queued node references when a malformed prepared leaf throws", () => {
  const { root, surface } = packGlobalEvaluatorFixture(fixture.cases[0].tree);
  const parent = {
    ...root,
    triangles: new Uint32Array(),
    flat: true,
    children: [{ ...root, triangles: Uint32Array.of(999) }, root],
  };
  const scratch = {
    stack: [] as NativeGlobalEvaluatorSearchNode<number>[],
    projection: new Float64Array(3),
    edgeFlags: new Uint8Array(1),
  };
  expect(() =>
    nativeGlobalPackedEvaluator(surface).query(
      parent,
      [0.25, 0.25, 0.1],
      Float64Array.of(1),
      new Float64Array(3),
      new Uint8Array(1),
      false,
      scratch,
    ),
  ).toThrow();
  expect(scratch.stack).toHaveLength(0);
});

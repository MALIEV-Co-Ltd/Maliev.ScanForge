import { expect, it } from "vitest";
import adjacency from "./fixtures/alignment-adjacency-global.json";
import {
  nativeGlobalNeighbourMasks,
  prepareNativeGlobalMeshTarget,
} from "../src/scan-native-global-mesh-target";
import { nativeGlobalTargetChoice } from "../src/scan-native-global-target";

it.each(adjacency.cases)(
  "preserves original neighbor pointer presence: $name",
  (c) => {
    const expected = c.neighbors.reduce<number[]>((masks, other, i) => {
      const face = Math.floor(i / 3);
      masks[face] = (masks[face] ?? 0) | (other < 0 ? 0 : 1 << (i % 3));
      return masks;
    }, []);
    expect([
      ...nativeGlobalNeighbourMasks(Int32Array.from(c.neighbors)),
    ]).toEqual(expected);
    const target = prepareNativeGlobalMeshTarget({
      vertices: Float32Array.from(c.vertices.flat()),
      triangles: Uint32Array.from(c.triangles),
    });
    expect([...target.neighbours]).toEqual(expected);
  },
);
const square = () => ({
  vertices: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0),
  triangles: Uint32Array.of(0, 1, 2, 2, 1, 3),
});
it("connects the built index, original adjacency and raw fallback without rebuilding", () => {
  const input = square(),
    target = prepareNativeGlobalMeshTarget(input);
  expect(prepareNativeGlobalMeshTarget(input)).toBe(target);
  expect(target.evaluator.surface.vertices).toBe(input.vertices);
  const raw = { point: [0, 0, 1], normal: [0, 0, 1], labelWord: 0, flags: 0 };
  const interior = target.query([0.25, 0.25, 0.1], 5);
  expect(interior.found).toBe(true);
  expect(interior.point).toEqual([0.25, 0.25, 0]);
  expect(nativeGlobalTargetChoice([0.25, 0.25, 0.1], raw, [interior])).toBe(
    interior,
  );
  const shared = target.query([0.5, 0.5, 0.1], 5);
  expect(shared).toBe(interior);
  expect(shared.edgeFlags & ~shared.neighbours).toBe(0);
  expect(nativeGlobalTargetChoice([0.5, 0.5, 0.1], raw, [shared])).toBe(shared);
  const boundary = target.query([0.5, -0.1, 0.1], 5);
  expect(boundary.found).toBe(true);
  expect(boundary.edgeFlags & ~boundary.neighbours).not.toBe(0);
  expect(nativeGlobalTargetChoice([0.5, -0.1, 0.1], raw, [boundary])).toBe(raw);
  expect(target.query([0, 0, 100], 0.1).found).toBe(false);
  expect(prepareNativeGlobalMeshTarget(input)).toBe(target);
});
it("keeps hidden neighbor presence separate from index admission", () => {
  const target = prepareNativeGlobalMeshTarget({
    ...square(),
    flags: Uint8Array.of(0, 2),
    filterHidden: true,
  });
  expect(target.neighbours[0]).not.toBe(0);
  const result = target.query([0.5, 0.5, 0.1], 5);
  expect(result.found).toBe(true);
  expect(result.edgeFlags & ~result.neighbours).toBe(0);
});
it("cancels cached retrieval and validates queries and adjacency", () => {
  const input = square(),
    target = prepareNativeGlobalMeshTarget(input);
  const control = new AbortController();
  control.abort();
  expect(() =>
    prepareNativeGlobalMeshTarget(input, { signal: control.signal }),
  ).toThrow(/cancelled/);
  for (const invalid of [
    Int32Array.of(0),
    Int32Array.of(-2, -1, -1),
    Int32Array.of(1, -1, -1),
  ])
    expect(() => nativeGlobalNeighbourMasks(invalid)).toThrow();
  expect(() => target.query([NaN, 0, 0], 1)).toThrow();
  expect(() => target.query([0, 0, 0], -1)).toThrow();
  expect(
    prepareNativeGlobalMeshTarget({
      vertices: new Float32Array(),
      triangles: new Uint32Array(),
    }).query([0, 0, 0], 1).found,
  ).toBe(false);
});

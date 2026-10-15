import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-point-tree-native.json";
import {
  NativeGlobalPointIndex,
  nativeGlobalPointIndex,
} from "../src/scan-native-global-point-index";
const f64 = (v: number) =>
  Buffer.from(Float64Array.of(v).buffer).toString("hex");
const f32 = (v: number) =>
  Buffer.from(Float32Array.of(v).buffer).toString("hex");
it.each(fixture.cases)(
  "matches original point tree and query order: $name / $capacity",
  (c) => {
    const index = new NativeGlobalPointIndex(
      Float32Array.from(c.points.flat()),
      c.capacity,
    );
    expect(index.depth).toBe(c.depth);
    expect(index.snapshot()).toEqual(c.nodes);
    for (const q of c.queries) {
      const nearest = index.closest(q.point, q.radius);
      expect(nearest.id).toBe(q.nearest);
      expect(f64(nearest.distance)).toBe(q.distanceBits);
      expect(
        index
          .neighbours(q.point, q.radius)
          .map((p) => ({ id: p.id, distanceBits: f32(p.distanceSquared) })),
      ).toEqual(q.neighbours);
    }
  },
);
it("retains the native append-path neighbour count instead of forcing a k=25 cap", () => {
  const c = fixture.cases.find((c) => c.name === "line" && c.capacity === 48)!;
  const index = new NativeGlobalPointIndex(Float32Array.from(c.points.flat()));
  expect(index.neighbours([0, 0, 0], 100)).toHaveLength(128);
});
it("reuses immutable target geometry across poses while keeping query traversal local", () => {
  const points = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const index = nativeGlobalPointIndex(points);
  expect(nativeGlobalPointIndex(points)).toBe(index);
  expect(nativeGlobalPointIndex(points.slice())).not.toBe(index);
  const before = index.snapshot();
  const a = index.closest([0, 0, 0], 10),
    b = index.neighbours([1, 0, 0], 10);
  expect(index.closest([0, 0, 0], 10)).toEqual(a);
  expect(index.neighbours([1, 0, 0], 10)).toEqual(b);
  expect(index.snapshot()).toEqual(before);
});
it("rejects incomplete/nonfinite carriers and invalid query settings", () => {
  expect(() => new NativeGlobalPointIndex(new Float32Array([1]))).toThrow();
  expect(
    () => new NativeGlobalPointIndex(new Float32Array([NaN, 0, 0])),
  ).toThrow();
  expect(() => new NativeGlobalPointIndex(new Float32Array(), 0)).toThrow();
  const index = new NativeGlobalPointIndex(new Float32Array());
  expect(() => index.closest([NaN, 0, 0], 1)).toThrow();
  expect(() => index.neighbours([0, 0, 0], -1)).toThrow();
});

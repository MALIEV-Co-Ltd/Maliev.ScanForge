import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-evaluator-leaf-native.json";
import { nativeGlobalTriangleDistance } from "../src/scan-native-global-triangle";
const bits = (values: ArrayLike<number>) =>
  Buffer.from(Float64Array.from(values).buffer).toString("hex");
it.each(fixture.cases)("matches original signed triangle leaf: $name", (c) => {
  const projection = Float64Array.of(11, 12, 13),
    flags = Uint8Array.of(255);
  const distance = nativeGlobalTriangleDistance(
    Float64Array.from(c.point),
    Float32Array.from(c.triangle[0]),
    Float32Array.from(c.triangle[1]),
    Float32Array.from(c.triangle[2]),
    Float32Array.from(c.normal),
    c.radius,
    projection,
    flags,
  );
  expect(bits([distance])).toBe(c.distanceBits);
  expect(bits(projection)).toBe(c.projectionBits);
  expect(flags[0]).toBe(c.edgeFlags);
});
it("reuses caller-owned output buffers and leaves cutoff coordinates untouched", () => {
  const p = Float64Array.of(0.25, 0.5, 0.5),
    a = Float32Array.of(0, 0, 0),
    b = Float32Array.of(1, 0, 0),
    c = Float32Array.of(0, 1, 0),
    n = Float32Array.of(0, 0, 1);
  const originals = [p, a, b, c, n].map((v) =>
    Buffer.from(v.buffer).toString("hex"),
  );
  const out = Float64Array.of(9, 8, 7),
    flags = Uint8Array.of(255);
  expect(nativeGlobalTriangleDistance(p, a, b, c, n, 0.1, out, flags)).toBe(
    Math.fround(3.4028234663852886e38),
  );
  expect(out).toEqual(Float64Array.of(9, 8, 7));
  expect(flags[0]).toBe(0);
  expect(nativeGlobalTriangleDistance(p, a, b, c, n, 1, out, flags)).toBe(0.5);
  expect(out).toEqual(Float64Array.of(0.25, 0.5, 0));
  expect(
    [p, a, b, c, n].map((v) => Buffer.from(v.buffer).toString("hex")),
  ).toEqual(originals);
});

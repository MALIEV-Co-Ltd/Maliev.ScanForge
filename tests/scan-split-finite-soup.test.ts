import { expect, it } from "vitest";
import { indexFiniteTriangleSoup } from "../src/scan-split-finite-soup";

it("indexes binary64 corners by exact bits without collapsing distinct coordinates", () => {
  const x = 100000000;
  const source = new Float64Array([
    x,
    0,
    0,
    x + 4,
    0,
    0,
    x + 4,
    4,
    0,
    x + 4,
    0,
    0,
    x,
    0,
    0,
    x,
    -0,
    0,
  ]);
  const before = new Uint8Array(source.buffer).slice();
  const result = indexFiniteTriangleSoup(source);
  expect(result.vertices).toBeInstanceOf(Float64Array);
  expect(result.triangles[1]).toBe(result.triangles[3]);
  expect(result.triangles[0]).toBe(result.triangles[4]);
  expect(result.triangles[5]).not.toBe(result.triangles[0]);
  const expanded = new Float64Array(source.length);
  for (let i = 0; i < result.triangles.length; i++)
    expanded.set(
      result.vertices.subarray(
        result.triangles[i] * 3,
        result.triangles[i] * 3 + 3,
      ),
      i * 3,
    );
  expect(new Uint8Array(expanded.buffer)).toEqual(before);
  expect(new Uint8Array(source.buffer)).toEqual(before);
});

it("indexes only bit-identical corners without changing the source", () => {
  const p = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, -0, 0, 1e-7, 0, 0,
    0, -1, 0,
  ]);
  const before = new Uint8Array(p.buffer).slice();
  const result = indexFiniteTriangleSoup(p);
  expect([...result.triangles]).toEqual([0, 1, 2, 1, 0, 3, 4, 5, 3]);
  const expanded = new Float32Array(p.length);
  for (let i = 0; i < result.triangles.length; i++)
    expanded.set(
      result.vertices.subarray(
        result.triangles[i] * 3,
        result.triangles[i] * 3 + 3,
      ),
      i * 3,
    );
  expect(new Uint8Array(expanded.buffer)).toEqual(before);
  expect(new Uint8Array(p.buffer)).toEqual(before);
});

it("enforces typed storage, work and cancellation before publishing", () => {
  const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  expect(() => indexFiniteTriangleSoup(p, { maxTypedBytes: 1 })).toThrow(
    /memory/i,
  );
  expect(() => indexFiniteTriangleSoup(p, { maxWork: 1 })).toThrow(/budget/i);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    indexFiniteTriangleSoup(p, { signal: controller.signal }),
  ).toThrow(/abort/i);
  expect(() =>
    indexFiniteTriangleSoup(new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1, 0])),
  ).toThrow(/finite/i);
});

it("respects a nonzero source buffer offset and reports the full backing allocation", () => {
  const buffer = new Float32Array(12);
  buffer.set([0, 0, 0, 1, 0, 0, 0, 1, 0], 3);
  const source = buffer.subarray(3);
  const result = indexFiniteTriangleSoup(source);
  expect([...result.vertices]).toEqual([...source]);
  expect(result.vertices.buffer.byteLength).toBe(source.byteLength);
  expect(result.peakTypedBytes).toBeGreaterThanOrEqual(
    result.vertices.buffer.byteLength + result.triangles.byteLength,
  );
});

it("keeps distinct slots for coincident corners within an input face", () => {
  const positions = new Float32Array([2, 3, 4, 1, 2, 3, 1, 2, 3]);
  const result = indexFiniteTriangleSoup(positions);
  expect(new Set(result.triangles).size).toBe(3);
  const expanded = new Float32Array(9);
  for (let i = 0; i < 3; i++)
    expanded.set(
      result.vertices.subarray(
        result.triangles[i] * 3,
        result.triangles[i] * 3 + 3,
      ),
      i * 3,
    );
  expect(new Uint8Array(expanded.buffer)).toEqual(
    new Uint8Array(positions.buffer),
  );
});

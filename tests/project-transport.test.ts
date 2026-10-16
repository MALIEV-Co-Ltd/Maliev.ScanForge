import { afterEach, expect, it, vi } from "vitest";
import {
  packProjectTransport,
  unpackProjectTransport,
  containsLargeNumericArrays,
} from "../src/project-transport";
afterEach(() => vi.unstubAllGlobals());
it("transfers staged numeric copies losslessly without detaching authored buffers or losing shared identities", async () => {
  const array = Array.from({ length: 100003 }, (_, i) =>
      i === 0 ? -0 : i / 3,
    ),
    positions = new Float32Array([1, 2, 3]),
    entity = { positions, normals: array },
    input = { current: [entity], history: [entity], alias: array };
  const packed = await packProjectTransport(input);
  expect(packed.transfers).toHaveLength(1);
  const sent = structuredClone(packed.packet, { transfer: packed.transfers });
  expect(positions.byteLength).toBe(12);
  expect(array.length).toBe(100003);
  const output = await unpackProjectTransport<typeof input>(sent);
  expect(output.current[0]).toBe(output.history[0]);
  expect(output.current[0].normals).toBe(output.alias);
  expect(Object.is(output.alias[0], -0)).toBe(true);
  for (let i = 0; i < array.length; i++)
    expect(Object.is(output.alias[i], array[i])).toBe(true);
  expect(output.current[0].positions).toEqual(positions);
});
it("can transfer worker-owned typed buffers once even when multiple views share them", async () => {
  const positions = new Float32Array([1, 2, 3]),
    v = positions.subarray(0, 2),
    input = { positions, v };
  const p = await packProjectTransport(input, { ownedTypedArrays: true });
  expect(p.transfers).toHaveLength(1);
  const cloned = structuredClone(p.packet, { transfer: p.transfers });
  expect(positions.byteLength).toBe(0);
  const result = await unpackProjectTransport<typeof input>(cloned);
  expect(result.positions.buffer).toBe(result.v.buffer);
  expect(Array.from(result.positions)).toEqual([1, 2, 3]);
});
it("cancels staging between bounded chunks and keeps authored data intact", async () => {
  const abort = new AbortController(),
    input = Array.from({ length: 200000 }, (_, i) => i);
  vi.stubGlobal("scheduler", { yield: async () => abort.abort() });
  await expect(
    packProjectTransport(input, { check: () => abort.signal.throwIfAborted() }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(input.length).toBe(200000);
});
it("preserves short metadata arrays and detects only large numeric arrays", async () => {
  expect(
    containsLargeNumericArrays({
      positions: new Float32Array(100000),
      short: [1, 2],
    }),
  ).toBe(false);
  expect(
    containsLargeNumericArrays({ normals: new Array(100000).fill(0) }),
  ).toBe(true);
  const p = await packProjectTransport({ a: [1, "text", null], flag: true });
  expect(await unpackProjectTransport(p.packet)).toEqual({
    a: [1, "text", null],
    flag: true,
  });
});

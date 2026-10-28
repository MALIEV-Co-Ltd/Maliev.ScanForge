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

it("reuses private verified Float64 staging while preserving array aliases and signed zero", async () => {
  const array = Array.from({ length: 65538 }, (_, i) => (i === 0 ? -0 : i / 7));
  const bytes = Float64Array.from(array);
  const p = await packProjectTransport(
    { array, alias: array },
    {
      ownedTypedArrays: true,
      reuseNumericBuffer: (value) => (value === array ? bytes : undefined),
    },
  );
  expect(p.packet.numbers[0].values).toBe(bytes);
  expect(p.transfers).toContain(bytes.buffer);
  const sent = structuredClone(p.packet, { transfer: p.transfers });
  const out = await unpackProjectTransport<{
    array: number[];
    alias: number[];
  }>(sent);
  expect(out.array).toBe(out.alias);
  expect(Object.is(out.array[0], -0)).toBe(true);
  expect(out.array).toEqual(array);
});

it("does not reuse stale numeric bytes", async () => {
  const array = Array.from({ length: 65538 }, (_, i) => i / 7);
  const stale = Float64Array.from(array);
  stale[17] = 99;
  const p = await packProjectTransport(
    { array },
    {
      ownedTypedArrays: true,
      reuseNumericBuffer: () => stale,
    },
  );
  expect(p.packet.numbers[0].values).not.toBe(stale);
  expect(await unpackProjectTransport<{ array: number[] }>(p.packet)).toEqual({
    array,
  });
});

it("does not reuse numeric bytes when only the zero sign differs", async () => {
  const array = new Array<number>(65538).fill(0);
  array[0] = -0;
  const stale = Float64Array.from(array);
  stale[0] = 0;
  const p = await packProjectTransport(
    { array },
    { ownedTypedArrays: true, reuseNumericBuffer: () => stale },
  );
  expect(p.packet.numbers[0].values).not.toBe(stale);
  const out = await unpackProjectTransport<{ array: number[] }>(p.packet);
  expect(Object.is(out.array[0], -0)).toBe(true);
});

it("releases private numeric transport storage after restoring arrays", async () => {
  const source = Array.from({ length: 65538 }, (_, i) => i / 7);
  const packed = await packProjectTransport({ source });
  const bytes = packed.packet.numbers[0].values.buffer;
  const out = await unpackProjectTransport<{ source: number[] }>(
    packed.packet,
    { releaseOwnedNumericBuffers: true },
  );
  expect(out.source).toEqual(source);
  if (
    typeof (ArrayBuffer.prototype as { transfer?: unknown }).transfer ===
    "function"
  )
    expect(bytes.byteLength).toBe(0);
});

it("preserves numeric transport backing aliased by the project graph", async () => {
  const source = Array.from({ length: 65538 }, (_, i) => i / 7);
  const packed = await packProjectTransport({ source });
  const bytes = packed.packet.numbers[0].values.buffer;
  const graph = packed.packet.graph as { source: object; other?: Uint8Array };
  graph.other = new Uint8Array(bytes, 0, 8);
  const out = await unpackProjectTransport<{
    source: number[];
    other: Uint8Array;
  }>(packed.packet, { releaseOwnedNumericBuffers: true });
  expect(out.source).toEqual(source);
  expect(out.other.buffer).toBe(bytes);
  expect(bytes.byteLength).toBeGreaterThan(0);
});

it("preserves numeric storage when multiple entries share it", async () => {
  const source = Array.from({ length: 65538 }, (_, i) => i / 7);
  const packed = await packProjectTransport({ source });
  const original = packed.packet.numbers[0];
  const secondRef = {};
  packed.packet.numbers.push({ ref: secondRef, values: original.values });
  (packed.packet.graph as { second?: object }).second = secondRef;
  const out = await unpackProjectTransport<{
    source: number[];
    second: number[];
  }>(packed.packet, { releaseOwnedNumericBuffers: true });
  expect(out.source).toEqual(source);
  expect(out.second).toEqual(source);
  expect(original.values.byteLength).toBeGreaterThan(0);
});

it("falls back to collection when transfer is unavailable", async () => {
  const source = Array.from({ length: 65538 }, (_, i) => i / 7);
  const packed = await packProjectTransport({ source });
  const descriptor = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    "transfer",
  );
  try {
    Object.defineProperty(ArrayBuffer.prototype, "transfer", {
      value: undefined,
      configurable: true,
    });
    const out = await unpackProjectTransport<{ source: number[] }>(
      packed.packet,
      { releaseOwnedNumericBuffers: true },
    );
    expect(out.source).toEqual(source);
    expect(packed.packet.numbers[0].values.byteLength).toBeGreaterThan(0);
  } finally {
    if (descriptor)
      Object.defineProperty(ArrayBuffer.prototype, "transfer", descriptor);
    else delete (ArrayBuffer.prototype as { transfer?: unknown }).transfer;
  }
});

it("does not release buffers when graph accessors hide possible aliases", async () => {
  const source = Array.from({ length: 65538 }, (_, i) => i / 7);
  const packed = await packProjectTransport({ source });
  const bytes = packed.packet.numbers[0].values.buffer;
  Object.defineProperty(packed.packet.graph, "other", {
    enumerable: true,
    get: () => new Uint8Array(bytes, 0, 8),
  });
  const out = await unpackProjectTransport<{
    source: number[];
    other: Uint8Array;
  }>(packed.packet, { releaseOwnedNumericBuffers: true });
  expect(out.source).toEqual(source);
  expect(out.other.buffer).toBe(bytes);
  expect(bytes.byteLength).toBeGreaterThan(0);
});

import { afterEach, expect, it, vi } from "vitest";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
  type ProjectSession,
} from "../src/project-file-codec";

import {
  packProjectTransport,
  unpackProjectTransport,
} from "../src/project-transport";

const STAGING_BYTES = 1024 * 1024;
function session(positions: Float32Array | number[]): ProjectSession {
  const entity = {
    id: "scan",
    name: "Scan",
    kind: "mesh" as const,
    positions,
    color: "#ffffff",
    visible: true,
    opacity: 1,
  };
  return {
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "Scanner",
      entities: [entity],
    },
    history: [{ label: "Import", entities: [entity] }],
    future: [],
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("bounds numeric encoding staging to one MiB while retaining every value", async () => {
  const count = Math.ceil((STAGING_BYTES / 4 + 1) / 9) * 9;
  const positions = Float32Array.from({ length: count }, (_, i) =>
    i % 9 === 0 ? -0 : (i % 19) / 7,
  );
  let maximum = 0;
  const RecordingBytes = new Proxy(Uint8Array, {
    construct(target, args, newTarget) {
      if (typeof args[0] === "number") maximum = Math.max(maximum, args[0]);
      return Reflect.construct(target, args, newTarget);
    },
  });
  vi.stubGlobal("Uint8Array", RecordingBytes);
  const encoded = await encodeProjectFileLocally(session(positions));
  vi.unstubAllGlobals();
  expect(maximum).toBeLessThanOrEqual(STAGING_BYTES);
  const restored = await decodeProjectContents(encoded);
  expect(restored.project.entities[0].positions).toEqual(positions);
  expect(restored.history[0].entities[0].positions).toBe(
    restored.project.entities[0].positions,
  );
});

it("consumes compressed output as a Blob rather than materializing a whole compressed byte array", async () => {
  const materialize = vi
    .spyOn(Response.prototype, "arrayBuffer")
    .mockImplementation(async () => {
      throw Error("Whole compressed array forbidden");
    });
  const encoded = await encodeProjectFileLocally(session(new Float32Array(9)));
  expect(encoded.size).toBeGreaterThan(16);
  expect(materialize).not.toHaveBeenCalled();
});

it("exposes verified private Float64 bytes for transport without changing restored arrays", async () => {
  const positions = Array.from({ length: 65538 }, (_, i) =>
    i === 0 ? -0 : i / 7,
  );
  const encoded = await encodeProjectFileLocally(session(positions));
  const buffers = new WeakMap<number[], Float64Array>();
  const decoded = await decodeProjectContents(encoded, {
    onDecodedFloat64: (values, bytes) => buffers.set(values, bytes),
  });
  const values = decoded.project.entities[0].positions as number[];
  expect(Array.isArray(values)).toBe(true);
  const bytes = buffers.get(values);
  expect(bytes).toBeInstanceOf(Float64Array);
  expect(Object.is(bytes![0], -0)).toBe(true);
  expect(Array.from(bytes!)).toEqual(values);
  expect(decoded.history[0].entities[0].positions).toBe(values);
});

it("does not expose reused shared chunks as private transport buffers", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const positions = Array.from({ length: 65538 }, (_, i) => i / 7);
  const encoded = await encodeProjectFileLocally(session(positions));
  const shared: { sha256: string; buffer: SharedArrayBuffer }[] = [];
  await decodeProjectContents(encoded, {
    sharedReadonlyBuffers: true,
    onSharedChunk: (chunk) => shared.push(chunk),
  });
  expect(shared.length).toBeGreaterThan(0);
  const callback = vi.fn();
  const decoded = await decodeProjectContents(encoded, {
    sharedReadonlyBuffers: true,
    reusableChunks: shared,
    onDecodedFloat64: callback,
  });
  expect(decoded.project.entities[0].positions).toEqual(positions);
  expect(callback).not.toHaveBeenCalled();
});

it("transports private shared decoded bytes while restoring normal array and history aliases", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const positions = Array.from({ length: 65538 }, (_, i) =>
    i === 0 ? -0 : i / 7,
  );
  const encoded = await encodeProjectFileLocally(session(positions));
  const buffers = new WeakMap<number[], Float64Array>();
  const decoded = await decodeProjectContents(encoded, {
    sharedReadonlyBuffers: true,
    onDecodedFloat64: (values, bytes) => buffers.set(values, bytes),
  });
  const p = await packProjectTransport(decoded, {
    ownedTypedArrays: true,
    reuseNumericBuffer: (values) => buffers.get(values),
  });
  expect(p.packet.numbers).toHaveLength(1);
  expect(p.packet.numbers[0].values.buffer).toBeInstanceOf(SharedArrayBuffer);
  expect(p.transfers).not.toContain(p.packet.numbers[0].values.buffer);
  const restored = await unpackProjectTransport<ProjectSession>(
    structuredClone(p.packet, { transfer: p.transfers }),
  );
  const result = restored.project.entities[0].positions;
  expect(Array.isArray(result)).toBe(true);
  expect(result).toEqual(positions);
  expect(Object.is(result[0], -0)).toBe(true);
  expect(restored.history[0].entities[0].positions).toBe(result);
});

it("allows worker-owned Float64-only chunks to be released after transport", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const positions = Array.from({ length: 65538 }, (_, i) =>
    i === 0 ? -0 : i / 7,
  );
  const encoded = await encodeProjectFileLocally(session(positions));
  const buffers = new WeakMap<number[], Float64Array>();
  const decoded = await decodeProjectContents(encoded, {
    sharedReadonlyBuffers: true,
    privateFloat64Chunks: true,
    onDecodedFloat64: (values, bytes) => buffers.set(values, bytes),
  });
  const values = decoded.project.entities[0].positions as number[];
  const bytes = buffers.get(values)!;
  expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
  const packet = await packProjectTransport(decoded, {
    ownedTypedArrays: true,
    reuseNumericBuffer: (value) => buffers.get(value),
  });
  const sent = structuredClone(packet.packet, { transfer: packet.transfers });
  const staging = sent.numbers[0].values.buffer;
  const restored = await unpackProjectTransport<ProjectSession>(sent, {
    releaseOwnedNumericBuffers: true,
  });
  expect(restored.project.entities[0].positions).toEqual(positions);
  expect(restored.history[0].entities[0].positions).toBe(
    restored.project.entities[0].positions,
  );
  if (
    typeof (ArrayBuffer.prototype as { transfer?: unknown }).transfer ===
    "function"
  )
    expect(staging.byteLength).toBe(0);
});

it("keeps shared backing when a chunk has both Float64 and typed references", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const positions = new Array<number>(65538).fill(1);
  const input = session(positions);
  input.project.entities.push({
    ...input.project.entities[0],
    id: "mesh2",
    positions: new Float32Array(positions.length * 2),
  });
  const file = await encodeProjectFileLocally(input);
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const headerView = new DataView(header.buffer);
  const oldLength = headerView.getUint32(8, true);
  const manifest = JSON.parse(await file.slice(16, 16 + oldLength).text());
  manifest.records[1].positions = {
    ...manifest.records[0].positions,
    type: "f32",
  };
  const encodedManifest = new TextEncoder().encode(JSON.stringify(manifest));
  headerView.setUint32(8, encodedManifest.byteLength, true);
  const shared: { sha256: string; buffer: SharedArrayBuffer }[] = [];
  const callback = vi.fn();
  const decoded = await decodeProjectContents(
    new Blob([header, encodedManifest, file.slice(16 + oldLength)]),
    {
      sharedReadonlyBuffers: true,
      privateFloat64Chunks: true,
      onSharedChunk: (chunk) => shared.push(chunk),
      onDecodedFloat64: callback,
    },
  );
  expect(decoded.project.entities[0].positions).toEqual(positions);
  expect(decoded.project.entities[1].positions).toBeInstanceOf(Float32Array);
  expect(
    (decoded.project.entities[1].positions as Float32Array).buffer,
  ).toBeInstanceOf(SharedArrayBuffer);
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback.mock.calls[0][1].buffer).toBe(
    (decoded.project.entities[1].positions as Float32Array).buffer,
  );
  expect(shared.length).toBeGreaterThan(0);
});

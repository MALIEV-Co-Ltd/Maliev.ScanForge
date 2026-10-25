import { expect, it, vi } from "vitest";
import {
  decodeProjectContents,
  encodeProjectFileLocally,
  type ProjectSession,
} from "../src/project-file-codec";
import { digestEntityGeometry } from "../src/geometry-digest";
import { serializeProject } from "../src/io";
import {
  packProjectTransport,
  unpackProjectTransport,
} from "../src/project-transport";
import type { Entity } from "../src/types";

const mesh = (id = "small", repeats = 1): Entity => ({
  id,
  name: id,
  kind: "mesh",
  color: "#ffffff",
  visible: true,
  opacity: 1,
  positions: new Float32Array(
    Array.from({ length: repeats }, () => [-0, 0, 0, 1, 0, 0, 0, 1, 0]).flat(),
  ),
  indexedMesh: {
    vertices: new Float32Array([-0, 0, 0, 1, 0, 0, 0, 1, 0]),
    triangles: new Uint32Array(
      Array.from({ length: repeats }, () => [0, 1, 2]).flat(),
    ),
  },
});
const session = (entities: Entity[]): ProjectSession => ({
  project: {
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "Indices",
    entities,
  },
  history: [{ label: "Before", entities }],
  future: [],
});

it("decompresses directly into shared geometry without copying each decoded numeric chunk", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const original = mesh();
  const file = await encodeProjectFileLocally(session([original]));
  const floats = vi.spyOn(Float32Array.prototype, "set");
  const indices = vi.spyOn(Uint32Array.prototype, "set");
  try {
    const restored = await decodeProjectContents(file, {
      sharedReadonlyBuffers: true,
    });
    expect(floats).not.toHaveBeenCalled();
    expect(indices).not.toHaveBeenCalled();
    const entity = restored.project.entities[0];
    expect((entity.positions as Float32Array).buffer).toBeInstanceOf(
      SharedArrayBuffer,
    );
    const contents = async (value: Entity) =>
      (await digestEntityGeometry(value)).buffers.map(
        ({ path, sha256, elements, encoding }) => ({
          path,
          sha256,
          elements,
          encoding,
        }),
      );
    expect(await contents(entity)).toEqual(await contents(original));
    expect(restored.history[0].entities[0].positions).toBe(entity.positions);
  } finally {
    floats.mockRestore();
    indices.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("still rejects a damaged chunk hash when decoding into shared backing", async () => {
  const file = await encodeProjectFileLocally(session([mesh()]));
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const view = new DataView(header.buffer);
  const length = view.getUint32(8, true);
  const manifest = JSON.parse(await file.slice(16, 16 + length).text());
  manifest.chunks[0].sha256 = "0".repeat(64);
  const changed = new TextEncoder().encode(JSON.stringify(manifest));
  view.setUint32(8, changed.byteLength, true);
  const damaged = new Blob([header, changed, file.slice(16 + length)]);
  vi.stubGlobal("crossOriginIsolated", true);
  try {
    await expect(
      decodeProjectContents(damaged, { sharedReadonlyBuffers: true }),
    ).rejects.toThrow("Invalid or damaged");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("restores binary topology without widening it and retains current/history aliases", async () => {
  const original = mesh();
  const restored = await decodeProjectContents(
    await encodeProjectFileLocally(session([original])),
  );
  const entity = restored.project.entities[0];
  expect(entity.indexedMesh!.triangles).toBeInstanceOf(Uint32Array);
  expect([...entity.indexedMesh!.triangles]).toEqual([0, 1, 2]);
  expect(restored.history[0].entities[0].indexedMesh!.triangles).toBe(
    entity.indexedMesh!.triangles,
  );
  expect(Object.is(entity.indexedMesh!.vertices[0], -0)).toBe(true);
  expect([...original.indexedMesh!.triangles]).toEqual([0, 1, 2]);
  const before = await digestEntityGeometry(original),
    after = await digestEntityGeometry(entity);
  const topology = (result: typeof before) =>
    result.buffers.find((b) => b.path === "indexedMesh.triangles")!;
  expect(topology(after)).toMatchObject({
    encoding: "u32",
    storage: "array-buffer",
    rawBytes: 12,
    sha256: topology(before).sha256,
  });
  const packed = await packProjectTransport(restored, {
    ownedTypedArrays: true,
    cooperative: false,
  });
  expect(packed.packet.numbers).toHaveLength(0);
  expect(packed.transfers).toContain(
    (entity.indexedMesh!.triangles as Uint32Array).buffer,
  );
  const moved = structuredClone(packed.packet, { transfer: packed.transfers });
  expect(entity.indexedMesh!.triangles.length).toBe(0);
  const received = await unpackProjectTransport<ProjectSession>(moved, {
    cooperative: false,
  });
  expect([...received.project.entities[0].indexedMesh!.triangles]).toEqual([
    0, 1, 2,
  ]);
  expect(received.history[0].entities[0].indexedMesh!.triangles).toBe(
    received.project.entities[0].indexedMesh!.triangles,
  );
});

it("keeps selection lists as arrays when they share a u32 chunk with topology", async () => {
  const big = mesh("big", 3);
  big.meshSelection = {
    hidden: [0, 1, 2],
    saved: [{ id: "saved", name: "Saved", triangles: [0, 1, 2] }],
  };
  const file = await encodeProjectFileLocally(session([mesh(), big]));
  const header = new DataView(await file.slice(0, 16).arrayBuffer());
  const manifest = JSON.parse(
    await file.slice(16, 16 + header.getUint32(8, true)).text(),
  );
  expect(manifest.records[0].indexedMesh.triangles.chunk).toBe(
    manifest.records[1].meshSelection.hidden.chunk,
  );
  const restored = await decodeProjectContents(file);
  expect(restored.project.entities[0].indexedMesh!.triangles).toBeInstanceOf(
    Uint32Array,
  );
  const selection = restored.project.entities[1].meshSelection!;
  expect(Array.isArray(selection.hidden)).toBe(true);
  expect(Array.isArray(selection.saved[0].triangles)).toBe(true);
  expect(selection).toEqual(big.meshSelection);
});

it("retains legacy JSON topology as number arrays", async () => {
  const original = mesh();
  const restored = await decodeProjectContents(
    new Blob([serializeProject("Legacy", [original])]),
  );
  expect(
    Array.isArray(restored.project.entities[0].indexedMesh!.triangles),
  ).toBe(true);
  expect(restored.project.entities[0].indexedMesh!.triangles).toEqual([
    0, 1, 2,
  ]);
});

it("publishes isolated restored geometry without encoder copies or transferable history", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  try {
    const file = await encodeProjectFileLocally(session([mesh()]));
    const restored = await decodeProjectContents(file, {
      sharedReadonlyBuffers: true,
    });
    const entity = restored.project.entities[0];
    for (const values of [
      entity.positions,
      entity.indexedMesh!.vertices,
      entity.indexedMesh!.triangles,
    ])
      expect((values as Float32Array).buffer).toBeInstanceOf(SharedArrayBuffer);
    const packed = await packProjectTransport(restored, {
      ownedTypedArrays: true,
      cooperative: false,
    });
    expect(packed.transfers).toHaveLength(0);
    expect(packed.packet.numbers).toHaveLength(0);
    const received = await unpackProjectTransport<ProjectSession>(
      structuredClone(packed.packet),
      { cooperative: false },
    );
    expect(
      (received.project.entities[0].positions as Float32Array).buffer,
    ).toBeInstanceOf(SharedArrayBuffer);
    expect(Object.is(received.project.entities[0].positions[0], -0)).toBe(true);
    expect(received.history[0].entities[0].indexedMesh!.triangles).toBe(
      received.project.entities[0].indexedMesh!.triangles,
    );
    expect([...entity.indexedMesh!.triangles]).toEqual([0, 1, 2]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps private typed storage when shared publication is unavailable", async () => {
  vi.stubGlobal("crossOriginIsolated", false);
  try {
    const restored = await decodeProjectContents(
      await encodeProjectFileLocally(session([mesh()])),
      { sharedReadonlyBuffers: true },
    );
    expect(
      (restored.project.entities[0].indexedMesh!.triangles as Uint32Array)
        .buffer,
    ).toBeInstanceOf(ArrayBuffer);
  } finally {
    vi.unstubAllGlobals();
  }
});

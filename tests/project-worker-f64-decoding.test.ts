import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  decodeProjectContents,
  encodeProjectFileLocally,
  type ProjectSession,
} from "../src/project-file-codec";
import {
  packProjectTransport,
  unpackProjectTransport,
} from "../src/project-transport";
import { validateProject } from "../src/io";
import { prepareRestoredProjectDisplays } from "../src/restored-scan-display";
import type { Positions } from "../src/types";

const makeSession = (): ProjectSession => ({
  project: {
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "views",
    entities: [
      {
        id: "scan",
        name: "scan",
        kind: "mesh",
        color: "#ffffff",
        visible: true,
        opacity: 1,
        positions: [-0, 0, 0, 1 + 2 ** -45, 0, 0, 0, 1, 0],
      },
    ],
  },
  history: [],
  future: [],
});

async function alterChunk(
  file: Blob,
  index: number,
  mutate: (bytes: Uint8Array) => void,
): Promise<Blob> {
  const source = new Uint8Array(await file.arrayBuffer());
  const header = new DataView(source.buffer);
  const manifestLength = header.getUint32(8, true);
  const manifest = JSON.parse(
    new TextDecoder().decode(source.subarray(16, 16 + manifestLength)),
  );
  const payloadStart = 16 + manifestLength;
  const payloads = manifest.chunks.map(
    (chunk: { offset: number; bytes: number }) =>
      source.slice(
        payloadStart + chunk.offset,
        payloadStart + chunk.offset + chunk.bytes,
      ),
  );
  const target = manifest.chunks[index];
  const raw =
    target.codec === "gzip"
      ? new Uint8Array(gunzipSync(payloads[index]))
      : payloads[index];
  mutate(raw);
  target.sha256 = createHash("sha256").update(raw).digest("hex");
  target.codec = "raw";
  target.bytes = raw.byteLength;
  payloads[index] = raw;
  let offset = 0;
  for (let i = 0; i < manifest.chunks.length; i++) {
    manifest.chunks[i].offset = offset;
    offset += payloads[i].byteLength;
  }
  const updated = new TextEncoder().encode(JSON.stringify(manifest));
  const prefix = source.slice(0, 16);
  const updatedHeader = new DataView(prefix.buffer);
  updatedHeader.setUint32(8, updated.byteLength, true);
  updatedHeader.setUint32(12, offset, true);
  return new Blob([prefix, updated, ...payloads]);
}

async function alterManifest(
  file: Blob,
  mutate: (manifest: any) => void,
): Promise<Blob> {
  const source = new Uint8Array(await file.arrayBuffer());
  const oldLength = new DataView(source.buffer).getUint32(8, true);
  const manifest = JSON.parse(
    new TextDecoder().decode(source.subarray(16, 16 + oldLength)),
  );
  mutate(manifest);
  const updated = new TextEncoder().encode(JSON.stringify(manifest));
  const header = source.slice(0, 16);
  new DataView(header.buffer).setUint32(8, updated.byteLength, true);
  return new Blob([header, updated, source.slice(16 + oldLength)]);
}

it("validates private mesh views in the worker and restores ordinary arrays at transport", async () => {
  const input = makeSession();
  const file = await encodeProjectFileLocally(input);
  const decoded = await decodeProjectContents(file, {
    privateFloat64Chunks: true,
    workerFloat64Views: true,
  });
  const values = decoded.project.entities[0].positions;
  expect(values).toBeInstanceOf(Float64Array);
  expect(() => validateProject(decoded.project)).not.toThrow();
  const prepared = prepareRestoredProjectDisplays(decoded);
  const packed = await packProjectTransport(prepared, {
    ownedTypedArrays: true,
    cooperative: false,
  });
  expect(packed.packet.numbers).toHaveLength(1);
  const workerBuffer = (values as unknown as Float64Array).buffer;
  const clone = structuredClone(packed.packet, { transfer: packed.transfers });
  expect(workerBuffer.byteLength).toBe(0);
  const restored = await unpackProjectTransport<ProjectSession>(clone, {
    cooperative: false,
  });
  expect(Array.isArray(restored.project.entities[0].positions)).toBe(true);
  expect(restored.project.entities[0].positions).toEqual(
    input.project.entities[0].positions,
  );
  expect(Object.is(restored.project.entities[0].positions[0], -0)).toBe(true);
});

it("keeps ordinary arrays for non-worker decoding even when chunks are private", async () => {
  const file = await encodeProjectFileLocally(makeSession());
  for (const options of [
    {},
    { privateFloat64Chunks: true },
    { workerFloat64Views: true },
  ]) {
    const result = await decodeProjectContents(file, options);
    expect(Array.isArray(result.project.entities[0].positions)).toBe(true);
  }
});

it("keeps arbitrary Float64Array geometry invalid in the public validator", () => {
  const session = makeSession();
  session.project.entities[0].positions = new Float64Array(
    session.project.entities[0].positions,
  ) as unknown as Positions;
  expect(() => validateProject(session.project)).toThrow(/geometry/i);
});

it("does not expose a Float64 view when its chunk is also referenced by a non-mesh field", async () => {
  const input = makeSession();
  const values = [
    ...input.project.entities[0].positions,
    ...input.project.entities[0].positions,
  ];
  input.project.entities[0].positions = values;
  input.project.entities[0].edgePositions = values;
  const decoded = await decodeProjectContents(
    await encodeProjectFileLocally(input),
    { privateFloat64Chunks: true, workerFloat64Views: true },
  );
  expect(Array.isArray(decoded.project.entities[0].edgePositions)).toBe(true);
  expect(Array.isArray(decoded.project.entities[0].positions)).toBe(true);
});

it("preserves ordinary array aliases when a mesh chunk also belongs to a point cloud", async () => {
  const session = makeSession();
  const mesh = session.project.entities[0];
  session.project.entities.push({
    ...mesh,
    id: "cloud",
    name: "cloud",
    kind: "pointcloud",
    positions: mesh.positions,
  });
  const file = await encodeProjectFileLocally(session);
  const result = await decodeProjectContents(file, {
    privateFloat64Chunks: true,
    workerFloat64Views: true,
  });
  const [decodedMesh, cloud] = result.project.entities;
  expect(Array.isArray(decodedMesh.positions)).toBe(true);
  expect(cloud.positions).toBe(decodedMesh.positions);
});

it("does not expose a borrowed shared chunk as a private worker view", async () => {
  const session = makeSession();
  const file = await encodeProjectFileLocally(session);
  const source = new Float64Array(session.project.entities[0].positions);
  const buffer = new SharedArrayBuffer(source.byteLength);
  new Float64Array(buffer).set(source);
  const sha256 = createHash("sha256")
    .update(new Uint8Array(buffer))
    .digest("hex");
  const shared: SharedArrayBuffer[] = [];
  vi.stubGlobal("crossOriginIsolated", true);
  try {
    const result = await decodeProjectContents(file, {
      sharedReadonlyBuffers: true,
      privateFloat64Chunks: true,
      workerFloat64Views: true,
      reusableChunks: [{ sha256, buffer }],
      onSharedChunk: (chunk) => shared.push(chunk.buffer),
    });
    expect(Array.isArray(result.project.entities[0].positions)).toBe(true);
    expect(result.project.entities[0].positions).toEqual(
      session.project.entities[0].positions,
    );
    expect(shared).toContain(buffer);
    expect(new Float64Array(buffer)).toEqual(source);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("preserves shared mesh buffers across history through private worker views", async () => {
  const input = makeSession();
  const entity = input.project.entities[0];
  entity.indexedMesh = {
    vertices: entity.positions,
    triangles: new Uint32Array([0, 1, 2]),
  };
  input.history = [{ label: "before", entities: [entity] }];
  const file = await encodeProjectFileLocally(input);
  const decoded = await decodeProjectContents(file, {
    privateFloat64Chunks: true,
    workerFloat64Views: true,
  });
  const current = decoded.project.entities[0];
  expect(current.positions).toBeInstanceOf(Float64Array);
  expect(current.indexedMesh!.vertices).toBe(current.positions);
  expect(decoded.history[0].entities[0].positions).toBe(current.positions);
  const packed = await packProjectTransport(
    prepareRestoredProjectDisplays(decoded),
    { ownedTypedArrays: true, cooperative: false },
  );
  const clone = structuredClone(packed.packet, { transfer: packed.transfers });
  const restored = await unpackProjectTransport<ProjectSession>(clone, {
    cooperative: false,
  });
  expect(restored.project.entities[0].positions).toEqual(entity.positions);
  expect(restored.project.entities[0].indexedMesh!.vertices).toBe(
    restored.project.entities[0].positions,
  );
  expect(restored.history[0].entities[0].positions).toBe(
    restored.project.entities[0].positions,
  );
});

it("rejects an altered chunk digest before exposing private worker geometry", async () => {
  const file = await encodeProjectFileLocally(makeSession());
  const data = new Uint8Array(await file.arrayBuffer());
  const header = new DataView(data.buffer);
  const manifestLength = header.getUint32(8, true);
  const text = new TextDecoder().decode(data.subarray(16, 16 + manifestLength));
  const manifest = JSON.parse(text);
  const original = manifest.chunks[0].sha256;
  const replacement =
    original[0] === "0" ? "1" + original.slice(1) : "0" + original.slice(1);
  const altered = text.replace(original, replacement);
  expect(altered).not.toBe(text);
  const manifestBytes = new TextEncoder().encode(altered);
  expect(manifestBytes.length).toBe(manifestLength);
  data.set(manifestBytes, 16);
  await expect(
    decodeProjectContents(new Blob([data]), {
      privateFloat64Chunks: true,
      workerFloat64Views: true,
    }),
  ).rejects.toThrow();
});

it.each([NaN, Infinity])(
  "rejects invalid Float64 coordinates with a valid recomputed digest (%s)",
  async (bad) => {
    const file = await alterChunk(
      await encodeProjectFileLocally(makeSession()),
      0,
      (bytes) => {
        new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ).setFloat64(0, bad, true);
      },
    );
    await expect(decodeProjectContents(file)).rejects.toThrow();
    await expect(
      decodeProjectContents(file, {
        privateFloat64Chunks: true,
        workerFloat64Views: true,
      }),
    ).rejects.toThrow();
  },
);

it("preserves large finite coordinates accepted by ordinary decoding", async () => {
  const file = await alterChunk(
    await encodeProjectFileLocally(makeSession()),
    0,
    (bytes) => {
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setFloat64(
        0,
        1000000001,
        true,
      );
    },
  );
  const ordinary = await decodeProjectContents(file);
  const privateView = await decodeProjectContents(file, {
    privateFloat64Chunks: true,
    workerFloat64Views: true,
  });
  expect(Array.from(privateView.project.entities[0].positions)).toEqual(
    Array.from(ordinary.project.entities[0].positions),
  );
});

it("rejects incomplete mesh geometry even when the referenced chunk digest is valid", async () => {
  const session = makeSession();
  session.project.entities[0].edgePositions = [0, 0, 0, 1, 0, 0];
  const original = await encodeProjectFileLocally(session);
  const damaged = await alterManifest(original, (manifest) => {
    manifest.records[0].positions = manifest.records[0].edgePositions;
  });
  await expect(decodeProjectContents(damaged)).rejects.toThrow();
  await expect(
    decodeProjectContents(damaged, {
      privateFloat64Chunks: true,
      workerFloat64Views: true,
    }),
  ).rejects.toThrow();
});

it("handles stale topology with a valid digest like ordinary decoding", async () => {
  const session = makeSession();
  session.project.entities[0].indexedMesh = {
    vertices: session.project.entities[0].positions,
    triangles: new Uint32Array([0, 1, 2]),
  };
  const original = await encodeProjectFileLocally(session);
  const bytes = new Uint8Array(await original.arrayBuffer());
  const size = new DataView(bytes.buffer).getUint32(8, true);
  const manifest = JSON.parse(
    new TextDecoder().decode(bytes.subarray(16, 16 + size)),
  );
  const index = manifest.records[0].indexedMesh.triangles.chunk;
  const damaged = await alterChunk(original, index, (raw) => {
    new DataView(raw.buffer, raw.byteOffset, raw.byteLength).setUint32(
      0,
      99,
      true,
    );
  });
  await expect(decodeProjectContents(damaged)).rejects.toThrow(/topology/i);
  await expect(
    decodeProjectContents(damaged, {
      privateFloat64Chunks: true,
      workerFloat64Views: true,
    }),
  ).rejects.toThrow(/topology/i);
});

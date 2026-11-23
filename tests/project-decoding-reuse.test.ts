import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  decodeProjectContents,
  encodeProjectFileLocally,
  type ProjectSession,
} from "../src/project-file-codec";
import {
  packProjectTransport,
  unpackProjectTransport,
} from "../src/project-transport";

type SharedChunk = { sha256: string; buffer: SharedArrayBuffer };
const source = (): ProjectSession => ({
  project: {
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: "Reuse",
    entities: [
      {
        id: "scan",
        name: "scan",
        kind: "mesh",
        color: "#ffffff",
        visible: true,
        opacity: 1,
        positions: Float32Array.of(-0, 0, 0, 1, 0, 0, 0, 1, 0),
        normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
      },
    ],
  },
  history: [],
  future: [],
});
beforeEach(() => vi.stubGlobal("crossOriginIsolated", true));
afterEach(() => vi.unstubAllGlobals());

it("keeps shared chunk backing across the restore worker transport without transferring it", async () => {
  const buffer = new SharedArrayBuffer(36);
  const { packet, transfers } = await packProjectTransport(
    {
      positions: new Float32Array(buffer),
      sharedChunks: [{ sha256: "a".repeat(64), buffer }],
    },
    { ownedTypedArrays: true },
  );
  const restored = await unpackProjectTransport<{
    positions: Float32Array;
    sharedChunks: SharedChunk[];
  }>(structuredClone(packet, { transfer: transfers }));
  expect(transfers).toEqual([]);
  expect(restored.sharedChunks[0].buffer).toBeInstanceOf(SharedArrayBuffer);
  expect(restored.sharedChunks[0].buffer).toBe(restored.positions.buffer);
  new Uint8Array(buffer)[0] = 42;
  expect(new Uint8Array(restored.sharedChunks[0].buffer)[0]).toBe(42);
});

async function firstDecode() {
  const session = source();
  session.history = [{ label: "Import", entities: session.project.entities }];
  const file = await encodeProjectFileLocally(session);
  const sharedChunks: SharedChunk[] = [];
  const first = await decodeProjectContents(file, {
    sharedReadonlyBuffers: true,
    onSharedChunk: (chunk: SharedChunk) => sharedChunks.push(chunk),
  });
  expect(sharedChunks).toHaveLength(2);
  return { file, first, sharedChunks };
}

it("reuses verified shared chunks on repeat restore without allocating another geometry backing", async () => {
  const { file, first, sharedChunks } = await firstDecode();
  const allocations: number[] = [];
  vi.stubGlobal(
    "SharedArrayBuffer",
    new Proxy(SharedArrayBuffer, {
      construct(target, args, newTarget) {
        allocations.push(args[0]);
        return Reflect.construct(target, args, newTarget);
      },
    }),
  );
  const second = await decodeProjectContents(file, {
    sharedReadonlyBuffers: true,
    reusableChunks: sharedChunks,
  });
  const a = first.project.entities[0],
    b = second.project.entities[0];
  expect((b.positions as Float32Array).buffer).toBe(
    (a.positions as Float32Array).buffer,
  );
  expect((b.normals as Float32Array).buffer).toBe(
    (a.normals as Float32Array).buffer,
  );
  expect(second.history[0].entities[0].positions).toBe(b.positions);
  expect(Object.is(b.positions[0], -0)).toBe(true);
  expect(allocations).toEqual([]);
});

it("validates every incoming payload even when its declared hash has a cached backing", async () => {
  const { file, sharedChunks } = await firstDecode();
  const bytes = new Uint8Array(await file.arrayBuffer());
  bytes[bytes.length - 1] ^= 1;
  await expect(
    decodeProjectContents(new Blob([bytes]), {
      sharedReadonlyBuffers: true,
      reusableChunks: sharedChunks,
    }),
  ).rejects.toThrow();
});

it("rebuilds a mismatched cached chunk without modifying its old consumer", async () => {
  const { file, first, sharedChunks } = await firstDecode();
  first.project.entities[0].positions[0] = 100;
  const second = await decodeProjectContents(file, {
    sharedReadonlyBuffers: true,
    reusableChunks: sharedChunks,
  });
  expect(first.project.entities[0].positions[0]).toBe(100);
  expect(Object.is(second.project.entities[0].positions[0], -0)).toBe(true);
  expect((second.project.entities[0].normals as Float32Array).buffer).toBe(
    (first.project.entities[0].normals as Float32Array).buffer,
  );
  expect(
    (second.project.entities[0].positions as Float32Array).buffer,
  ).not.toBe((first.project.entities[0].positions as Float32Array).buffer);
});

it("keeps ordinary-buffer fallback independent of reusable shared chunks", async () => {
  const { file, sharedChunks } = await firstDecode();
  const decoded = await decodeProjectContents(file, {
    reusableChunks: sharedChunks,
  });
  expect(
    (decoded.project.entities[0].positions as Float32Array).buffer,
  ).toBeInstanceOf(ArrayBuffer);
});

it("retains the verified prefix when a cached mismatch appears after several stream blocks", async () => {
  const session = source();
  const positions = Float32Array.from({ length: 9 * 40000 }, (_, i) =>
    Math.sin(i),
  );
  session.project.entities[0].positions = positions;
  session.project.entities[0].normals = undefined;
  const file = await encodeProjectFileLocally(session);
  const reusableChunks: SharedChunk[] = [];
  const first = await decodeProjectContents(file, {
    sharedReadonlyBuffers: true,
    onSharedChunk: (chunk) => reusableChunks.push(chunk),
  });
  first.project.entities[0].positions[positions.length - 1] = 100;
  const restored = await decodeProjectContents(file, {
    sharedReadonlyBuffers: true,
    reusableChunks,
  });
  const actual = restored.project.entities[0].positions as Float32Array;
  expect(Buffer.from(actual.buffer).equals(Buffer.from(positions.buffer))).toBe(
    true,
  );
  expect(first.project.entities[0].positions[positions.length - 1]).toBe(100);
});

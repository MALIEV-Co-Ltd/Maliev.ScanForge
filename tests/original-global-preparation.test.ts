import { createHash } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import { freemem } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { readScan, type ScanFile } from "../src/import-parser";
import { convertScanUnits } from "../src/import-units";
import { placeScanOnOrigin } from "../src/import-origin";
import { indexedMeshMatches } from "../src/indexed-mesh";
import type { parsePlyTopology } from "../src/ply-topology";
import { executeGlobalAlignmentInputPreparation } from "../src/global-alignment-input-core";

// Explicit opt-in, independent of the other original-file tests. Run alone with
// one Vitest worker in a coordinator-owned finite Job; this test creates no OS
// resource cap. Implementation boundary only: no controller/native parity claim.
const enabled = process.env.SCANFORGE_ORIGINAL_GLOBAL_PREPARATION === "1";
const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const originals = [
  {
    name: "ply-1.ply",
    bytes: 6926970,
    sha256: "e2fc6d49404977638222be9d31b63dedbc7c0a4adca4aba4af711168d5783c05",
    vertices: 140113,
    triangles: 274154,
  },
  {
    name: "ply-2.ply",
    bytes: 68084515,
    sha256: "3acf90227bea8e98e97d0eddeb57324d6c29767d622c86d65337d927bca5e75f",
    vertices: 1375494,
    triangles: 2697877,
  },
  {
    name: "ply-3.ply",
    bytes: 92765339,
    sha256: "bf738cb1da7aa2e2d26bc143c33e04313ad5096069d91cc22338cd0b01e9dcc2",
    vertices: 1865848,
    triangles: 3691133,
  },
] as const;

function digest(values: ArrayBufferView) {
  return createHash("sha256")
    .update(Buffer.from(values.buffer, values.byteOffset, values.byteLength))
    .digest("hex");
}

async function fileDigest(
  handle: FileHandle,
  bytes: number,
  check: () => void,
) {
  expect((await handle.stat()).size).toBe(bytes);
  const hash = createHash("sha256");
  const scratch = Buffer.alloc(65536);
  let offset = 0;
  while (offset < bytes) {
    check();
    const { bytesRead } = await handle.read(
      scratch,
      0,
      Math.min(scratch.length, bytes - offset),
      offset,
    );
    if (!bytesRead) throw Error("Original input truncated during hashing");
    hash.update(scratch.subarray(0, bytesRead));
    offset += bytesRead;
  }
  expect((await handle.stat()).size).toBe(bytes);
  return hash.digest("hex");
}

it.skipIf(!enabled)(
  "prepares command-local normals sequentially from the three pinned original GUI import inputs",
  async () => {
    expect(
      folder,
      "SCANFORGE_ALIGNMENT_EXAMPLES is required for opt-in",
    ).toBeTruthy();
    vi.stubGlobal("crossOriginIsolated", true);
    try {
      for (const original of originals) await verifyOriginal(original);
    } finally {
      vi.unstubAllGlobals();
    }
  },
  180_000,
);

async function verifyOriginal(original: (typeof originals)[number]) {
  if (freemem() < 3072 * 1048576)
    throw Error(
      "Original preparation requires 3072 MiB free; do not lower admission.",
    );
  const started = performance.now();
  const check = () => {
    if (performance.now() - started > 55_000)
      throw Error("Original preparation per-file deadline exceeded");
  };
  const memory: { stage: string; usage: NodeJS.MemoryUsage }[] = [];
  const sample = (stage: string) => {
    check();
    memory.push({ stage, usage: process.memoryUsage() });
  };
  const handle = await open(join(folder!, original.name), "r");
  let maximumSliceBytes = 0;
  let slices = 0;
  try {
    expect(await fileDigest(handle, original.bytes, check)).toBe(
      original.sha256,
    );
    sample("source-verified");
    const file: ScanFile = {
      size: original.bytes,
      async arrayBuffer() {
        throw Error("Original packed PLY must not be buffered whole");
      },
      slice(start = 0, end = original.bytes) {
        return {
          async arrayBuffer() {
            check();
            const length = end - start;
            if (!Number.isSafeInteger(length) || length < 0 || length > 1048576)
              throw Error("Import slice exceeds 1 MiB");
            maximumSliceBytes = Math.max(maximumSliceBytes, length);
            slices++;
            const data = new ArrayBuffer(length);
            const view = new Uint8Array(data);
            let filled = 0;
            while (filled < length) {
              check();
              const { bytesRead } = await handle.read(
                view,
                filled,
                length - filled,
                start + filled,
              );
              if (!bytesRead)
                throw Error("Original input truncated during import");
              filled += bytesRead;
            }
            return data;
          },
        };
      },
    };
    let indexed: ReturnType<typeof parsePlyTopology> | undefined;
    let cornerNormals: Float32Array | undefined;
    const positions = await readScan(file, "ply", {
      sharedReadonlyBuffers: true,
      onIndexedMesh(mesh) {
        indexed = mesh;
      },
      onMeshNormals(normals) {
        cornerNormals = normals;
      },
    });
    if (!indexed?.normals || !cornerNormals)
      throw Error("Original scanner normals missing");
    expect(indexed.vertices.length).toBe(original.vertices * 3);
    expect(indexed.triangles.length).toBe(original.triangles * 3);
    expect(positions.length).toBe(original.triangles * 9);
    expect(cornerNormals.length).toBe(positions.length);
    convertScanUnits(positions, "mm");
    convertScanUnits(indexed.vertices, "mm");
    placeScanOnOrigin(positions, false, [indexed.vertices]);
    expect(indexedMeshMatches(indexed, positions)).toBe(true);
    const authored = {
      positions,
      cornerNormals,
      vertices: indexed.vertices,
      indexedNormals: indexed.normals,
      triangles: indexed.triangles,
    };
    for (const values of Object.values(authored))
      expect(values.buffer).toBeInstanceOf(SharedArrayBuffer);
    const authoredHashes = () =>
      Object.fromEntries(
        Object.entries(authored).map(([name, values]) => [
          name,
          digest(values),
        ]),
      );
    const before = authoredHashes();
    sample("imported-mm-origin");
    // Exactly the indexed branch's disposable copies; no authored scanner normal
    // enters the command normal producer. No worker/transfer/scheduler claim.
    const vertices = new Float32Array(indexed.vertices);
    const triangles = new Uint32Array(indexed.triangles);
    expect(vertices.buffer).not.toBe(indexed.vertices.buffer);
    expect(triangles.buffer).not.toBe(indexed.triangles.buffer);
    sample("disposable-topology");
    const preparationStarted = performance.now();
    const prepared = executeGlobalAlignmentInputPreparation({
      vertices,
      triangles,
    });
    const preparationElapsedMs = performance.now() - preparationStarted;
    sample("prepared");
    expect(prepared.vertices).toBe(vertices);
    expect(prepared.triangles).toBe(triangles);
    expect(prepared.normals).toBeInstanceOf(Float32Array);
    expect(prepared.normals.length).toBe(vertices.length);
    expect(prepared.normals.buffer).not.toBe(indexed.normals.buffer);
    expect(prepared.normals.buffer).not.toBe(vertices.buffer);
    expect(prepared.normals.every(Number.isFinite)).toBe(true);
    expect(digest(prepared.vertices)).toBe(before.vertices);
    expect(digest(prepared.triangles)).toBe(before.triangles);
    expect(authoredHashes()).toEqual(before);
    expect(await fileDigest(handle, original.bytes, check)).toBe(
      original.sha256,
    );
    sample("immutability-verified");
    process.stdout.write(
      JSON.stringify({
        scope:
          "ORIGINAL_GLOBAL_PREPARATION_IMPLEMENTATION_ONLY_NO_NATIVE_PARITY",
        source: original,
        units: "mm",
        sharedReadonlyBuffers: true,
        originPlacement: true,
        authoredHashes: before,
        commandHashes: {
          vertices: digest(prepared.vertices),
          triangles: digest(prepared.triangles),
          normals: digest(prepared.normals),
        },
        commandVertices: vertices.length / 3,
        commandTriangles: triangles.length / 3,
        finiteCommandNormals: true,
        maximumSliceBytes,
        slices,
        preparationElapsedMs,
        elapsedMs: performance.now() - started,
        memory,
        memoryMeaning:
          "Instrumented boundary samples only; not a peak/RSS bound or browser benchmark",
      }) + "\n",
    );
  } finally {
    await handle.close();
  }
}

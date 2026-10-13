import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readScan } from "../src/import-parser";
import { indexedMeshMatches } from "../src/indexed-mesh";
import capture from "./fixtures/stl-owner-topology-native.json";
import readerCapture from "./fixtures/stl-owner-reader-native.json";

const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
for (const original of capture.sources)
  it.skipIf(!folder)(
    `matches the original mapping pipeline on the owner's full ${original.file}`,
    async () => {
      const reader = readerCapture.sources.find(
        (source) => source.sourceFile === original.file,
      )!;
      expect(reader.provenance.originalOptimizedReaderExecuted).toBe(true);
      expect(reader.sourceSha256).toBe(original.sourceSha256);
      for (const field of [
        "vertexCount",
        "triangleCount",
        "verticesSha256",
        "trianglesSha256",
      ] as const)
        expect(reader[field]).toBe(original[field]);
      const bytes = readFileSync(join(folder!, original.file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        original.sourceSha256,
      );
      const count = bytes.readUInt32LE(80);
      expect(bytes.length).toBe(84 + count * 50);
      const started = performance.now();
      let result:
        { vertices: Float32Array; triangles: Uint32Array } | undefined;
      const positions = await readScan(
        new Blob([new Uint8Array(bytes)]),
        "stl",
        {
          onIndexedMesh: (topology) => {
            result = topology;
          },
        },
      );
      expect(result).toBeDefined();
      expect(indexedMeshMatches(result, positions)).toBe(true);
      process.stdout.write(
        JSON.stringify({
          file: original.file,
          importMilliseconds: performance.now() - started,
        }) + "\n",
      );
      expect(result!.vertices.length / 3).toBe(original.vertexCount);
      expect(result!.triangles.length / 3).toBe(original.triangleCount);
      for (const [buffer, digest] of [
        [result!.vertices, original.verticesSha256],
        [result!.triangles, original.trianglesSha256],
      ] as const)
        expect(
          createHash("sha256")
            .update(
              new Uint8Array(
                buffer.buffer,
                buffer.byteOffset,
                buffer.byteLength,
              ),
            )
            .digest("hex"),
        ).toBe(digest);
    },
    60_000,
  );

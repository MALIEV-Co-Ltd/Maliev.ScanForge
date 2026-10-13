import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import capture from "./fixtures/stl-owner-topology-native.json";
import readerCapture from "./fixtures/stl-owner-reader-native.json";

const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
for (const original of capture.sources)
  it.skipIf(!folder)(
    `matches the original mapping pipeline on the owner's full ${original.file}`,
    () => {
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
      const coordinates = new Float32Array(count * 9);
      for (let face = 0; face < count; face++)
        for (let coordinate = 0; coordinate < 9; coordinate++)
          coordinates[face * 9 + coordinate] = bytes.readFloatLE(
            84 + face * 50 + 12 + coordinate * 4,
          );
      const started = performance.now();
      const result = nativeStlTopology(coordinates);
      process.stdout.write(
        JSON.stringify({
          file: original.file,
          topologyMilliseconds: performance.now() - started,
        }) + "\n",
      );
      expect(result.vertices.length / 3).toBe(original.vertexCount);
      expect(result.triangles.length / 3).toBe(original.triangleCount);
      for (const [buffer, digest] of [
        [result.vertices, original.verticesSha256],
        [result.triangles, original.trianglesSha256],
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

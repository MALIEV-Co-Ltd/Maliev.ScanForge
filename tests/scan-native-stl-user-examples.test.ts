import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import capture from "./fixtures/stl-owner-topology-native.json";

const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
it.skipIf(!folder)(
  "matches the original mapping pipeline on the owner's full scan-1 STL",
  () => {
    const bytes = readFileSync(join(folder!, "scan-1.stl"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      capture.sourceSha256,
    );
    const count = bytes.readUInt32LE(80);
    expect(bytes.length).toBe(84 + count * 50);
    const coordinates = new Float32Array(count * 9);
    for (let face = 0; face < count; face++)
      for (let coordinate = 0; coordinate < 9; coordinate++)
        coordinates[face * 9 + coordinate] = bytes.readFloatLE(
          84 + face * 50 + 12 + coordinate * 4,
        );
    const result = nativeStlTopology(coordinates);
    const original = capture.samples[0];
    expect(result.vertices.length / 3).toBe(original.vertexCount);
    expect(result.triangles.length / 3).toBe(original.triangleCount);
    for (const [buffer, digest] of [
      [result.vertices, original.verticesSha256],
      [result.triangles, original.trianglesSha256],
    ] as const)
      expect(
        createHash("sha256")
          .update(
            new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
          )
          .digest("hex"),
      ).toBe(digest);
  },
  60_000,
);

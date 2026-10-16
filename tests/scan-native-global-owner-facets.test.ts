import { it, expect } from "vitest";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { freemem } from "node:os";
import oracle from "./fixtures/global-fine-owner-facets-native.json";
import { nativeGlobalFacetNormals } from "../src/scan-native-global-surface";

const directory = process.env.SCANFORGE_NATIVE_FACET_ORACLES;
async function readExact(
  file: FileHandle,
  bytes: Buffer,
  size: number,
  position: number,
) {
  let done = 0;
  while (done < size) {
    const { bytesRead } = await file.read(
      bytes,
      done,
      size - done,
      position + done,
    );
    if (!bytesRead) throw Error("Truncated native facet carrier.");
    done += bytesRead;
  }
}
it.skipIf(!directory).each(oracle.cases)(
  "matches every retained owner facet: $originalFile",
  async (c) => {
    if (freemem() < 3072 * 1048576)
      throw Error("Owner facet replay requires 3072 MiB free.");
    const files: FileHandle[] = [];
    try {
      for (const path of [
        resolve(directory!, "..", c.positions),
        resolve(directory!, c.normals),
        resolve(directory!, c.degenerate),
      ])
        files.push(await open(path));
      const [positions, normals, degenerate] = files;
      expect((await positions.stat()).size).toBe(c.faces * 36);
      expect((await normals.stat()).size).toBe(c.faces * 12);
      expect((await degenerate.stat()).size).toBe(c.faces);
      const chunk = 65536,
        raw = Buffer.alloc(chunk * 36),
        expected = Buffer.alloc(chunk * 12),
        expectedFlags = Buffer.alloc(chunk);
      const indices = Uint32Array.from({ length: chunk * 3 }, (_, i) => i);
      const inputHash = createHash("sha256"),
        normalHash = createHash("sha256"),
        flagHash = createHash("sha256");
      let degenerateCount = 0;
      for (let start = 0; start < c.faces; start += chunk) {
        const count = Math.min(chunk, c.faces - start);
        await Promise.all([
          readExact(positions, raw, count * 36, start * 36),
          readExact(normals, expected, count * 12, start * 12),
          readExact(degenerate, expectedFlags, count, start),
        ]);
        const output = nativeGlobalFacetNormals(
          new Float32Array(raw.buffer, raw.byteOffset, count * 9),
          indices.subarray(0, count * 3),
        );
        const actual = Buffer.from(output.normals.buffer);
        expect(
          actual.equals(expected.subarray(0, count * 12)),
          `${c.originalFile} normal byte offset ${start * 12}`,
        ).toBe(true);
        expect(
          Buffer.from(output.degenerate.buffer).equals(
            expectedFlags.subarray(0, count),
          ),
        ).toBe(true);
        inputHash.update(raw.subarray(0, count * 36));
        normalHash.update(actual);
        flagHash.update(output.degenerate);
        for (const flag of output.degenerate) degenerateCount += flag;
      }
      expect(inputHash.digest("hex")).toBe(c.positionsSha256);
      expect(normalHash.digest("hex")).toBe(c.normalsSha256);
      expect(flagHash.digest("hex")).toBe(c.degenerateSha256);
      expect(degenerateCount).toBe(c.degenerateFaces);
    } finally {
      await Promise.all(files.map((file) => file.close()));
    }
  },
  60000,
);

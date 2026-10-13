import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import first from "./fixtures/alignment-user-ply-source.json";
import second from "./fixtures/alignment-user-ply-2-source.json";
import third from "./fixtures/alignment-user-ply-3-source.json";
import { prepareNativeAlignmentSource } from "../src/scan-native-alignment-source";

// Large owner-supplied scans remain outside the repository and default CI suite.
const folder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
it.skipIf(!folder).each([first, second, third])(
  "matches full-resolution user source normals and sampling: $file",
  (expected) => {
    const raw = readFileSync(
      join(folder!, expected.file.split(/[\\/]/).pop()!),
    );
    const digest = (data: Uint8Array) =>
      createHash("sha256").update(data).digest("hex");
    expect(digest(raw)).toBe(expected.sha256);
    const marker = Buffer.from("end_header\r\n");
    let offset = raw.indexOf(marker) + marker.length;
    if (offset === marker.length - 1) {
      const marker = Buffer.from("end_header\n");
      offset = raw.indexOf(marker) + marker.length;
    }
    expect(offset).toBeGreaterThan(12);
    const vertices = new Float32Array(expected.vertices * 3);
    for (let id = 0; id < expected.vertices; id++)
      for (let axis = 0; axis < 3; axis++)
        vertices[id * 3 + axis] = raw.readFloatLE(offset + id * 24 + axis * 4);
    offset += expected.vertices * 24;
    const triangles = new Uint32Array(expected.triangles * 3);
    for (let id = 0; id < expected.triangles; id++) {
      if (raw[offset] !== 3)
        throw new Error("Example PLY contains a non-triangle face.");
      for (let corner = 0; corner < 3; corner++)
        triangles[id * 3 + corner] = raw.readUInt32LE(offset + 1 + corner * 4);
      offset += 13;
    }
    expect(offset).toBe(raw.length);
    const began = performance.now();
    const result = prepareNativeAlignmentSource(
      { vertices, triangles },
      expected.budget,
    );
    console.info(
      JSON.stringify({
        file: expected.file,
        prepareMilliseconds: performance.now() - began,
        vertices: expected.vertices,
        triangles: expected.triangles,
      }),
    );
    expect(digest(new Uint8Array(result.normals.buffer))).toBe(
      expected.normalsSha256,
    );
    const flags = Uint32Array.from(result.sampling.flags);
    expect(digest(new Uint8Array(flags.buffer))).toBe(expected.flagsSha256);
    expect(result.sampling.levelCounts).toEqual(expected.levelCounts);
    expect(result.sampling.nodes).toBe(expected.nodes);
    expect(
      result.sampling.flags.flatMap((flag, id) => (flag & 4 ? [id] : [])),
    ).toEqual(expected.selected);
  },
  60000,
);

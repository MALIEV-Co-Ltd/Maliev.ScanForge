import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { freemem, endianness } from "node:os";
import fixture from "./fixtures/global-fine-point-tree-owner-native.json";
import { parsePlyTopology } from "../src/ply-topology";
import { nativeGlobalPointIndex } from "../src/scan-native-global-point-index";
const directory = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const records: unknown[] = [];
it.skipIf(!directory).each(fixture.cases)(
  "matches full original point tree and queries on owner $name",
  (c) => {
    if (freemem() < 3072 * 1048576)
      throw Error(
        "Full-owner point indexing requires 3072 MiB free; do not lower admission",
      );
    expect(endianness()).toBe("LE");
    const input = readFileSync(directory + "/" + c.name);
    expect(createHash("sha256").update(input).digest("hex")).toBe(c.fileSha256);
    const { vertices } = parsePlyTopology(
      input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
    );
    expect(vertices.length / 3).toBe(c.count);
    expect(
      createHash("sha256")
        .update(
          Buffer.from(
            vertices.buffer,
            vertices.byteOffset,
            vertices.byteLength,
          ),
        )
        .digest("hex"),
    ).toBe(c.pointsSha256);
    const started = performance.now(),
      index = nativeGlobalPointIndex(vertices),
      buildMs = performance.now() - started;
    expect(index.depth).toBe(c.depth);
    expect(index.data.parent.length).toBe(c.nodes);
    const d = index.data,
      header = Buffer.alloc(76),
      hash = createHash("sha256");
    for (let i = 0; i < d.parent.length; i++) {
      header.writeInt32LE(d.parent[i], 0);
      header.writeInt32LE(d.high[i], 4);
      header.writeInt32LE(d.low[i], 8);
      header.writeInt8(d.axis[i], 12);
      header.writeDoubleLE(d.split[i], 16);
      for (let a = 0; a < 6; a++)
        header.writeDoubleLE(d.bounds[i * 6 + a], 24 + a * 8);
      header.writeUInt32LE(d.count[i], 72);
      hash.update(header);
      hash.update(
        Buffer.from(
          d.order.buffer,
          d.order.byteOffset + d.start[i] * 4,
          d.count[i] * 4,
        ),
      );
    }
    expect(hash.digest("hex")).toBe(c.treeSha256);
    const queryStart = performance.now();
    for (const q of c.queries) {
      const nearest = index.closest(q.point, q.radius);
      expect(nearest.id).toBe(q.nearest);
      expect(
        Buffer.from(Float64Array.of(nearest.distance).buffer).toString("hex"),
      ).toBe(q.distanceBits);
      expect(
        index.neighbours(q.point, q.radius).map((p) => ({
          id: p.id,
          distanceBits: Buffer.from(
            Float32Array.of(p.distanceSquared).buffer,
          ).toString("hex"),
        })),
      ).toEqual(q.neighbours);
    }
    const queryMs = performance.now() - queryStart;
    expect(nativeGlobalPointIndex(vertices)).toBe(index);
    records.push({
      name: c.name,
      vertices: c.count,
      nodes: c.nodes,
      buildMs,
      queryMs,
      nativeBuildMs: c.buildSeconds * 1000,
      nativeQueryMs: c.querySeconds * 1000,
      treeHashMatched: true,
      allQueryBytesMatched: true,
    });
    if (records.length === fixture.cases.length)
      writeFileSync(
        ".resources/global-fine-point-owner-replay.json",
        JSON.stringify(records, null, 2),
      );
  },
  60_000,
);

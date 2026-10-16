import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { freemem } from "node:os";
import { parsePlyTopology } from "../src/ply-topology";
import { createPreparedGlobalQueryPool } from "../src/scan-global-scene-client";
const directory = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const oracle = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/global-fine-prepared-owner-native.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const hash = (view: ArrayBufferView) =>
  createHash("sha256")
    .update(Buffer.from(view.buffer, view.byteOffset, view.byteLength))
    .digest("hex");
it.skipIf(!directory)(
  "matches connected original scene preparation and all full-owner correspondence queries",
  async () => {
    if (freemem() < 3072 * 1048576)
      throw Error(
        "Connected owner replay requires 3072 MiB free; do not lower admission.",
      );
    const scans = oracle.scene.sources.map(
      (
        s: {
          name: string;
          fileSha256: string;
          pointsSha256: string;
          normalsSha256: string;
        },
        i: number,
      ) => {
        const buffer = readFileSync(directory + "/" + s.name);
        expect(hash(buffer)).toBe(s.fileSha256);
        const topology = parsePlyTopology(
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ),
        );
        expect(hash(topology.vertices)).toBe(s.pointsSha256);
        expect(hash(topology.normals!)).toBe(s.normalsSha256);
        return {
          id: String(i),
          geometry: { points: topology.vertices, normals: topology.normals! },
        };
      },
    );
    const start = performance.now(),
      pool = await createPreparedGlobalQueryPool({
        scans,
        clocks: oracle.scene.results.map(
          (s: { clockInputs: number[] }) => s.clockInputs,
        ),
      });
    const preparedMs = performance.now() - start,
      queries = [];
    try {
      expect(pool.sampled).toEqual(
        oracle.scene.results.map((s: { sampled: number }) => s.sampled),
      );
      for (const c of oracle.cases) {
        const before = performance.now();
        const result = await pool.execute({
          sourceId: String(c.source),
          poses: scans.map((s: { id: string }, i: number) => ({
            id: s.id,
            matrix: c.poses[i],
          })),
          radius: c.radius,
          mode: c.mode,
        });
        expect(result.count).toBe(c.count);
        expect(
          result.pairs.map((p) => ({
            id: p.id,
            active: p.active,
            numericBits: Buffer.from(
              new Float64Array([...p.source, ...p.target, p.distance]).buffer,
            ).toString("hex"),
          })),
        ).toEqual(c.results);
        queries.push({
          source: c.source,
          mode: c.mode,
          count: result.count,
          queryMs: performance.now() - before,
        });
      }
      writeFileSync(
        ".resources/global-fine-prepared-owner-replay.json",
        JSON.stringify({ preparedMs, queries, allBytesMatched: true }, null, 2),
      );
    } finally {
      pool.close();
    }
  },
  90000,
);

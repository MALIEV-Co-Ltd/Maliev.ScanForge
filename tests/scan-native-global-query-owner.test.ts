import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { freemem } from "node:os";
import fixture from "./fixtures/global-fine-correspondence-owner-native.json";
import { parsePlyTopology } from "../src/ply-topology";
import {
  nativeGlobalQuery,
  prepareNativeGlobalQueryGeometry,
} from "../src/scan-native-global-query";
const directory = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const hash = (value: Uint8Array | Float32Array) =>
  createHash("sha256")
    .update(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    .digest("hex");
it.skipIf(!directory)(
  "matches original complete owner-scan correspondences and reuses full indexes across poses",
  () => {
    if (freemem() < 3072 * 1048576)
      throw Error(
        "Full-owner global query replay requires 3072 MiB available; do not lower admission.",
      );
    const scans = fixture.sources.map((source, i) => {
      const buffer = readFileSync(directory + "/" + source.name);
      expect(hash(buffer)).toBe(source.fileSha256);
      const topology = parsePlyTopology(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ),
      );
      expect(topology.normals).toBeDefined();
      expect(hash(topology.vertices)).toBe(source.pointsSha256);
      expect(hash(topology.normals!)).toBe(source.normalsSha256);
      return {
        id: `scan-${i}`,
        geometry: { points: topology.vertices, normals: topology.normals! },
      };
    });
    const started = performance.now(),
      indexes = scans.map((scan) =>
        prepareNativeGlobalQueryGeometry(scan.geometry),
      ),
      preparedMs = performance.now() - started;
    const results = [];
    for (const c of fixture.cases) {
      const placed = scans.map((scan, i) => ({ ...scan, matrix: c.poses[i] })),
        before = performance.now();
      const result = nativeGlobalQuery({
        source: placed[c.source],
        targets: placed,
        cells: c.cells,
        radius: c.radius,
        mode: c.mode as "pooled-plane" | "target-average",
      });
      const elapsed = performance.now() - before;
      expect(result.count, `${c.source}/${c.mode}/${c.transformed}`).toBe(
        c.count,
      );
      expect(
        result.pairs.map((p) => ({
          id: p.id,
          active: p.active,
          numericBits: Buffer.from(
            Float64Array.from([...p.source, ...p.target, p.distance]).buffer,
          ).toString("hex"),
        })),
      ).toEqual(c.results);
      scans.forEach((scan, i) =>
        expect(prepareNativeGlobalQueryGeometry(scan.geometry)).toBe(
          indexes[i],
        ),
      );
      results.push({
        source: c.source,
        mode: c.mode,
        transformed: c.transformed,
        count: result.count,
        queryMs: elapsed,
        allNumericBytesMatched: true,
      });
    }
    writeFileSync(
      ".resources/global-fine-correspondence-owner-replay.json",
      JSON.stringify({ preparedMs, indexesReused: true, results }, null, 2),
    );
  },
  60_000,
);

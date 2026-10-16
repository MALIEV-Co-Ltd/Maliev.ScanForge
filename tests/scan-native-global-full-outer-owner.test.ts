import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { freemem } from "node:os";
import { parsePlyTopology } from "../src/ply-topology";
import { createPreparedGlobalQueryPool } from "../src/scan-global-scene-client";
import { nativeGlobalRefineLocal } from "../src/scan-native-global-local";
import {
  nativeGlobalRefineOuter,
  type GlobalOuterState,
} from "../src/scan-native-global-outer";
const directory = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
const oracles = [
  "global-fine-full-outer-owner-native.json",
  "global-fine-multicore-outer-owner-native.json",
].map((name) =>
  JSON.parse(
    readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"),
  ),
);
const hash = (v: ArrayBufferView) =>
  createHash("sha256")
    .update(Buffer.from(v.buffer, v.byteOffset, v.byteLength))
    .digest("hex");
const bits = (v: readonly number[]) =>
  Buffer.from(new Float64Array(v).buffer).toString("hex");
const state = (s: GlobalOuterState) => ({
  matrixBits: bits(s.matrix),
  meanBits: bits([s.mean]),
  coverageBits: bits([s.std]),
  converged: s.converged,
  stable: s.stable,
});
it.skipIf(!directory).each(oracles)(
  "matches the complete original $mode outer/local/query chain on all three full scans",
  async (oracle) => {
    if (freemem() < 3072 * 1048576)
      throw Error(
        "Full outer replay requires 3072 MiB available; do not lower admission.",
      );
    const scans = oracle.scene.sources.map(
      (
        source: {
          name: string;
          fileSha256: string;
          pointsSha256: string;
          normalsSha256: string;
        },
        i: number,
      ) => {
        const b = readFileSync(directory + "/" + source.name);
        expect(hash(b)).toBe(source.fileSha256);
        const topology = parsePlyTopology(
          b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        );
        expect(hash(topology.vertices)).toBe(source.pointsSha256);
        expect(hash(topology.normals!)).toBe(source.normalsSha256);
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
    const initializedMs = performance.now() - start,
      passSnapshots: unknown[] = [],
      localCalls: unknown[] = [];
    let queries = 0;
    try {
      const result = await nativeGlobalRefineOuter(
        scans.map(
          (scan: { id: string; geometry: { points: Float32Array } }) => ({
            id: scan.id,
            pointCount: scan.geometry.points.length / 3,
            matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
            mean: 0,
            std: 0,
          }),
        ),
        async (source, ordered, pass) => {
          const local = await nativeGlobalRefineLocal(
            source,
            (matrix) => {
              queries++;
              return pool.execute({
                sourceId: source.id,
                poses: ordered.map((s) => ({
                  id: s.id,
                  matrix: s.id === source.id ? matrix : s.matrix,
                })),
                radius: oracle.radius,
                mode: oracle.mode,
              });
            },
            { tolerance: oracle.localTolerance },
          );
          localCalls.push({
            source: source.id,
            pass,
            status: local.status,
            iterations: local.iterations,
          });
          return local;
        },
        {
          clock: () => oracle.clockInputs[0],
          coverageTolerance: oracle.coverageTolerance,
          onProgress: (pass, _total, ordered) => {
            if (!pass) return;
            passSnapshots.push({
              order: ordered.map((s) => Number(s.id)),
              states: scans.map((scan: { id: string }) =>
                state(ordered.find((s) => s.id === scan.id)!),
              ),
            });
          },
        },
      );
      writeFileSync(
        `.resources/global-fine-full-outer-owner-${oracle.mode}-replay.json`,
        JSON.stringify(
          {
            initializedMs,
            elapsedMs: performance.now() - start,
            queries,
            localCalls,
            passes: result.passes,
            passSnapshots,
            final: {
              order: result.order.map(Number),
              states: result.states.map(state),
            },
            applications: result.applications.map((a) => ({
              source: Number(a.id),
              matrixBits: bits(a.matrix),
            })),
          },
          null,
          2,
        ),
      );
      expect(result.passes).toBe(oracle.passes);
      expect(passSnapshots).toEqual(oracle.passSnapshots);
      expect({
        order: result.order.map(Number),
        states: result.states.map(state),
      }).toEqual(oracle.final);
      expect(
        result.applications.map((a) => ({
          source: Number(a.id),
          matrixBits: bits(a.matrix),
        })),
      ).toEqual(oracle.applications);
    } finally {
      pool.close();
    }
  },
  90000,
);

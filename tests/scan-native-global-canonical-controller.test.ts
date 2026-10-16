import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { freemem } from "node:os";
import oracle from "./fixtures/global-fine-canonical-controller-native.json";
import sourceOracle from "./fixtures/global-fine-retained-owner-source-native.json";
import type { GlobalSceneInput } from "../src/scan-global-scene-worker";
import type { GlobalQueryJob } from "../src/scan-global-query-worker";
import { nativeGlobalPrepareScene } from "../src/scan-native-global-scene";
import { nativeGlobalQuery } from "../src/scan-native-global-query";
// Diagnostic core replay only. This deliberately does not advertise production
// pool admission or physical multicore operation on these large inputs.
async function createCanonicalCoreReplay(
  input: GlobalSceneInput & { clocks: readonly (readonly number[])[] },
) {
  const clocks = input.scans.map(() => 0);
  let scene: ReturnType<typeof nativeGlobalPrepareScene> | undefined =
    nativeGlobalPrepareScene(input.scans, {
      clock: (i: number) => input.clocks[i][clocks[i]++],
    });
  const started = performance.now();
  return {
    execute(job: Omit<GlobalQueryJob, "cells">) {
      if (!scene) throw Error("Core replay is closed");
      if (freemem() < 1024 * 1048576)
        throw Error("Runtime memory guard reached");
      if (performance.now() - started > 300000)
        throw Error("Core replay deadline reached");
      const targets = job.poses.map((pose) => ({
        ...pose,
        geometry: scene!.sources.find((source) => source.scan.id === pose.id)!
          .geometry,
      }));
      const i = input.scans.findIndex((scan) => scan.id === job.sourceId);
      return nativeGlobalQuery({
        ...job,
        source: targets.find((scan) => scan.id === job.sourceId)!,
        targets,
        cells: scene.selected[i],
      });
    },
    close() {
      scene = undefined;
    },
  };
}
import { nativeGlobalRefineLocal } from "../src/scan-native-global-local";
import {
  nativeGlobalRefineOuter,
  type GlobalOuterState,
} from "../src/scan-native-global-outer";
const directory = process.env.SCANFORGE_NATIVE_CANONICAL_CONTROLLER;
const oracles = [oracle];
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
it("binds the canonical controller to independently captured complete owner inputs", () => {
  expect(oracle.scene.sources).toHaveLength(3);
  expect(oracle.builds).toHaveLength(3);
  expect(oracle.passes).toBe(19);
  expect(oracle.passSnapshots).toHaveLength(19);
  expect(oracle.applications).toHaveLength(6);
  expect(oracle.provenance.productionPoolAdmissionVerified).toBe(false);
  for (let i = 0; i < 3; i++) {
    const source = oracle.scene.sources[i],
      build = oracle.builds[i],
      expected = sourceOracle.cases[i];
    expect(source.count).toBe(expected.vertices);
    expect(source.pointsSha256).toBe(expected.verticesSha256);
    expect(source.normalsSha256).toBe(expected.vertexNormalsSha256);
    expect(source.trianglesSha256).toBe(expected.trianglesSha256);
    expect(build.indexSha256).toBe(expected.indexSha256);
    expect(build.facetNormalsSha256).toBe(expected.facetNormalsSha256);
    expect(build.neighborMasksSha256).toBe(expected.neighborMasksSha256);
    expect(build.queryControls).toBe(33);
  }
});
it.skipIf(!directory).each(oracles)(
  "matches the canonical native $mode controller core on all three retained scans",
  async (oracle) => {
    if (freemem() < 4096 * 1048576)
      throw Error(
        "Full outer replay requires 4096 MiB available; do not lower admission.",
      );
    const mode = oracle.mode;
    if (mode !== "target-average" && mode !== "pooled-plane")
      throw Error("Unsupported native controller query mode");
    const scans = oracle.scene.sources.map((source, i) => {
      const meta = source;
      const p = readFileSync(directory + "/" + meta.pointsCarrier);
      const n = readFileSync(directory + "/" + meta.normalsCarrier);
      const t = readFileSync(directory + "/" + meta.trianglesCarrier);
      expect(hash(p)).toBe(source.pointsSha256);
      expect(hash(n)).toBe(source.normalsSha256);
      expect(hash(t)).toBe(meta.trianglesSha256);
      const topology = {
        vertices: new Float32Array(p.buffer, p.byteOffset, p.byteLength / 4),
        normals: new Float32Array(n.buffer, n.byteOffset, n.byteLength / 4),
        triangles: new Uint32Array(t.buffer, t.byteOffset, t.byteLength / 4),
      };
      return {
        id: String(i),
        geometry: {
          points: topology.vertices,
          normals: topology.normals!,
          rawTargetIds: new Uint32Array(),
          targetMeshes: [
            {
              vertices: topology.vertices,
              triangles: topology.triangles,
              packedNodes: true,
            },
          ],
        },
      };
    });
    const start = performance.now(),
      pool = await createCanonicalCoreReplay({
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
                mode,
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
        `.resources/global-fine-canonical-controller-${oracle.mode}-replay.json`,
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
  360000,
);

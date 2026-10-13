import { readFileSync } from "node:fs";
import { Worker as CpuWorker } from "node:worker_threads";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { SelectedSmoothingPool } from "../src/scan-smoothing-client";
import { smoothSelectedVertices } from "../src/scan-selected-smooth";
import annular from "./fixtures/defeature-annular.json";
import nativeAnnular from "./fixtures/smooth-annular.json";
import fans from "./fixtures/smooth-disconnected-fans.json";

// Inline the unchanged production target kernel into the production child entry
// point. Only module imports are removed for Node's browser-worker bridge.
const transpile = (path) =>
  ts
    .transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(/^import .*;\r?\n/gm, "");
const bridge = `
import { parentPort } from "node:worker_threads";
globalThis.self = globalThis;
globalThis.postMessage = (data, transfers) => parentPort.postMessage(data, transfers);
globalThis.close = () => process.exit(0);
${transpile("../src/scan-smoothing-kernel.ts")}
${transpile("../src/scan-smoothing-worker.ts")}
parentPort.on("message", data => globalThis.onmessage({data}));
`;
class ThreadWorker {
  static owned = [];
  initialized = 0;
  iterations = 0;
  vertexBuffers = new Set();
  constructor() {
    this.thread = new CpuWorker(
      new URL(`data:text/javascript,${encodeURIComponent(bridge)}`),
      { resourceLimits: { maxOldGenerationSizeMb: 96 } },
    );
    ThreadWorker.owned.push(this);
    this.exited = new Promise((resolve) => this.thread.once("exit", resolve));
    this.thread.on("message", (data) => this.onmessage?.({ data }));
    this.thread.on("error", (error) => this.onerror?.(error));
    this.thread.on("messageerror", () => this.onmessageerror?.());
  }
  postMessage(data) {
    if (data.initialize) this.initialized++;
    if ("iteration" in data) {
      this.iterations++;
      this.vertexBuffers.add(data.vertices.buffer);
    }
    this.thread.postMessage(data);
  }
  terminate() {
    return this.thread.terminate();
  }
}
afterEach(async () => {
  const owned = ThreadWorker.owned.splice(0);
  await Promise.all(owned.map((worker) => worker.terminate()));
  await Promise.all(owned.map((worker) => worker.exited));
  expect(owned.every((worker) => worker.thread.threadId === -1)).toBe(true);
  vi.unstubAllGlobals();
});

it.each([
  ["annular", annular, nativeAnnular.nativeOutput, 1e-6],
  ["disconnected fans", fans, fans.nativeOutput, 0],
])(
  "actual CPU threads preserve native %s selected smoothing",
  async (_, input, native, tolerance) => {
    vi.stubGlobal("Worker", ThreadWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
    const source = analyzeMesh(new Float32Array(input.positions));
    const count = 300_102;
    const remap = (id) => Math.floor(id / 2) + (id % 2 ? 150_051 : 0);
    const vertices = new Float64Array(count * 3);
    const occupied = new Set();
    for (let id = 0; id < source.vertices.length / 3; id++) {
      occupied.add(remap(id));
      vertices.set(source.vertices.subarray(id * 3, id * 3 + 3), remap(id) * 3);
    }
    // Isolated zero-area padding admits the real production pool without changing
    // any fixture neighborhood. Connected fixture vertices cross worker shards.
    const padding = [];
    for (let id = 0; id < count; id++) if (!occupied.has(id)) padding.push(id);
    while (padding.length % 3) padding.push(padding.at(-1));
    const triangles = new Uint32Array(source.triangles.length + padding.length);
    triangles.set(source.triangles.map(remap));
    triangles.set(padding, source.triangles.length);
    const edges = new Map();
    for (const [key, uses] of source.edges) {
      const [a, b] = key.split(":").map((id) => remap(Number(id)));
      edges.set(
        a < b ? `${a}:${b}` : `${b}:${a}`,
        uses.map((use) => ({
          ...use,
          from: remap(use.from),
          to: remap(use.to),
        })),
      );
    }
    const selection = new Uint8Array(triangles.length / 3).fill(1);
    selection.set(input.selection);
    const topology = { ...source, vertices, triangles, edges };
    const before = vertices.slice();
    const pool = new SelectedSmoothingPool();
    try {
      let totalIterations = 0;
      for (const [operation, iterations] of [2, 1, 3, 5, 2].entries()) {
        const stages = [];
        const actual = await pool.smooth(topology, selection, iterations, 0.5, {
          onProgress: (_, stage) => stages.push(stage),
        });
        totalIterations += iterations;
        expect(ThreadWorker.owned).toHaveLength(2);
        for (const worker of ThreadWorker.owned) {
          expect(worker.initialized).toBe(1);
          expect(worker.iterations).toBe(totalIterations);
          // One owned input buffer per operation, reused only after the joined
          // iteration. Real structured clones keep each child snapshot stable.
          expect(worker.vertexBuffers.size).toBe(operation + 1);
          expect(worker.vertexBuffers.has(actual.buffer)).toBe(true);
        }
        expect(stages).toHaveLength(iterations);
        expect(
          stages.every(
            (stage) =>
              stage === "Smoothing selected vertices on two CPU workers",
          ),
        ).toBe(true);
        const serial = smoothSelectedVertices(
          topology,
          selection,
          iterations,
          0.5,
          {},
        );
        const expectedBytes = new Uint8Array(serial.buffer);
        expect(
          new Uint8Array(actual.buffer).every(
            (byte, i) => byte === expectedBytes[i],
          ),
        ).toBe(true);
        if (iterations === 2) {
          let error = 0;
          source.triangles.forEach((id, corner) => {
            for (let axis = 0; axis < 3; axis++)
              error = Math.max(
                error,
                Math.abs(
                  actual[remap(id) * 3 + axis] - native[corner * 3 + axis],
                ),
              );
          });
          if (tolerance) expect(error).toBeLessThan(tolerance);
          else expect(error).toBe(0);
        }
      }
      const beforeBytes = new Uint8Array(before.buffer);
      expect(
        new Uint8Array(vertices.buffer).every(
          (byte, i) => byte === beforeBytes[i],
        ),
      ).toBe(true);
    } finally {
      pool.dispose();
    }
  },
  30_000,
);

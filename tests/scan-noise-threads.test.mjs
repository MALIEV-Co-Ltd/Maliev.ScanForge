import { readFileSync } from "node:fs";
import { Worker as CpuWorker } from "node:worker_threads";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { NoiseSmoothingPool } from "../src/scan-noise-parallel";
import selected1 from "./fixtures/noise-annular-selected-1.json";
import selected3 from "./fixtures/noise-annular-selected-3.json";
import whole2 from "./fixtures/noise-annular-whole-2.json";
import whole3 from "./fixtures/noise-annular-whole-3.json";
import boundaryOff from "./fixtures/noise-annular-boundary-off.json";
// Execute the production child entry point, including structured cloning and
// transferred result buffers, rather than simulating its message transport.
const workerSource = ts.transpileModule(
  readFileSync(new URL("../src/scan-noise-worker.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const bridge = `
import { parentPort } from "node:worker_threads";
globalThis.postMessage = (data, transfers) => parentPort.postMessage(data, transfers);
globalThis.close = () => process.exit(0);
${workerSource}
parentPort.on("message", data => globalThis.onmessage({ data }));
`;
class ThreadWorker {
  static owned = [];
  thread;
  exited;
  onmessage;
  onerror;
  onmessageerror;
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
it.each([selected1, selected3, whole2, whole3, boundaryOff])(
  "real CPU threads preserve native $iterations-iteration output, selection=$selectionOnly, boundary=$applyBoundaryEdges",
  async (capture) => {
    vi.stubGlobal("Worker", ThreadWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 16 });
    const source = analyzeMesh(new Float32Array(capture.positions));
    // Place the same independently indexed native fixture in both shards.
    // Isolated unused slots satisfy production admission without changing any
    // fixture coordinate, facet ordering, connectivity or selection membership.
    const count = 300_000;
    const second = count - source.vertices.length / 3;
    const vertices = new Float64Array(count * 3);
    vertices.set(source.vertices);
    vertices.set(source.vertices, second * 3);
    const triangles = new Uint32Array(source.triangles.length * 2);
    triangles.set(source.triangles);
    triangles.set(
      source.triangles.map((id) => id + second),
      source.triangles.length,
    );
    const edges = new Map(source.edges);
    for (const [key, facets] of source.edges) {
      const [a, b] = key.split(":").map(Number);
      edges.set(
        `${a + second}:${b + second}`,
        facets.map((use) => ({
          ...use,
          face: use.face + source.triangles.length / 3,
          from: use.from + second,
          to: use.to + second,
        })),
      );
    }
    const topology = {
      ...source,
      vertices,
      triangles,
      edges,
      boundaryEdges: source.boundaryEdges * 2,
    };
    let selection;
    if ("selection" in capture) {
      selection = new Uint8Array(capture.selection.length * 2);
      selection.set(capture.selection);
      selection.set(capture.selection, capture.selection.length);
    }
    const before = vertices.slice();
    const stages = [];
    const pool = new NoiseSmoothingPool();
    try {
      const result = await pool.smooth(
        topology,
        capture.iterations,
        selection,
        capture.applyBoundaryEdges,
        {
          onProgress: (_, stage) => stages.push(stage),
        },
      );
      expect(ThreadWorker.owned).toHaveLength(2);
      expect(stages).toContain("Reducing mesh noise on two CPU workers");
      // A transport failure falls back to serial. Require the multicore path
      // to finish successfully, not just produce a correct fallback result.
      expect(
        stages.filter((stage) => stage === "Preparing noise weights"),
      ).toHaveLength(1);
      for (const offset of [0, second]) {
        const actual = new Float32Array(capture.nativeOutput.length);
        source.triangles.forEach((id, corner) => {
          actual.set(
            result.subarray((id + offset) * 3, (id + offset) * 3 + 3),
            corner * 3,
          );
        });
        expect(new Uint8Array(actual.buffer)).toEqual(
          new Uint8Array(new Float32Array(capture.nativeOutput).buffer),
        );
      }
      const originalBytes = new Uint8Array(before.buffer);
      expect(
        new Uint8Array(vertices.buffer).every(
          (byte, i) => byte === originalBytes[i],
        ),
      ).toBe(true);
    } finally {
      pool.dispose();
    }
  },
  30_000,
);

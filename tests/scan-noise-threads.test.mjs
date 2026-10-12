import { readFileSync } from "node:fs";
import { Worker as CpuWorker } from "node:worker_threads";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { NoiseSmoothingPool } from "../src/scan-noise-parallel";
import selected1 from "./fixtures/noise-annular-selected-1.json";
import selected3 from "./fixtures/noise-annular-selected-3.json";
import selected2 from "./fixtures/noise-annular-selected-2.json";
import selected4 from "./fixtures/noise-annular-selected-4.json";
import selected5 from "./fixtures/noise-annular-selected-5.json";
import whole2 from "./fixtures/noise-annular-whole-2.json";
import whole3 from "./fixtures/noise-annular-whole-3.json";
import boundaryOff from "./fixtures/noise-annular-boundary-off.json";
import whole1 from "./fixtures/noise-annular-default.json";
import selectedBoundaryOff from "./fixtures/noise-annular-selected-boundary-off.json";
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
  initialized = 0;
  operations = 0;
  phases = 0;
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
    if (data.operation) this.operations++;
    if (data.job) this.phases++;
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
  selected1,
  selected2,
  selected3,
  selected4,
  selected5,
  whole1,
  whole2,
  whole3,
  boundaryOff,
  ...selectedBoundaryOff.cases.map((capture) => ({
    ...capture,
    positions: selectedBoundaryOff.positions,
    selection: selectedBoundaryOff.selection,
  })),
])(
  "connected neighborhoods crossing CPU shards preserve native $iterations-iteration output, selection=$selectionOnly, boundary=$applyBoundaryEdges",
  async (capture) => {
    vi.stubGlobal("Worker", ThreadWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 16 });
    const source = analyzeMesh(new Float32Array(capture.positions));
    const count = 300_000;
    const midpoint = count / 2;
    // Alternate connected vertices between the actual production worker ranges.
    // Preserve facet/corner order; only the vertex storage addresses change.
    const remap = (id) => Math.floor(id / 2) + (id % 2 ? midpoint : 0);
    const vertices = new Float64Array(count * 3);
    for (let id = 0; id < source.vertices.length / 3; id++)
      vertices.set(source.vertices.subarray(id * 3, id * 3 + 3), remap(id) * 3);
    const triangles = source.triangles.map(remap);
    const edges = new Map();
    let crossingEdges = 0;
    for (const [key, uses] of source.edges) {
      const [a, b] = key.split(":").map((id) => remap(Number(id)));
      if (a < midpoint !== b < midpoint) crossingEdges++;
      edges.set(
        a < b ? `${a}:${b}` : `${b}:${a}`,
        uses.map((use) => ({
          ...use,
          from: remap(use.from),
          to: remap(use.to),
        })),
      );
    }
    expect(crossingEdges).toBeGreaterThan(0);
    const selection =
      "selection" in capture ? new Uint8Array(capture.selection) : undefined;
    const movable = new Set();
    source.triangles.forEach((id, corner) => {
      if (!selection || selection[Math.floor(corner / 3)]) movable.add(id);
    });
    expect([...movable].some((id) => remap(id) < midpoint)).toBe(true);
    expect([...movable].some((id) => remap(id) >= midpoint)).toBe(true);
    const topology = { ...source, vertices, triangles, edges };
    const before = vertices.slice();
    const originalTriangles = triangles.slice();
    const stages = [];
    const pool = new NoiseSmoothingPool();
    try {
      const result = await pool.smooth(
        topology,
        capture.iterations,
        selection,
        capture.applyBoundaryEdges,
        { onProgress: (_, stage) => stages.push(stage) },
      );
      expect(ThreadWorker.owned).toHaveLength(2);
      expect(
        stages.filter((stage) => stage === "Preparing noise weights"),
      ).toHaveLength(1);
      expect(
        stages.filter(
          (stage) => stage === "Reducing mesh noise on two CPU workers",
        ),
      ).toHaveLength(capture.iterations);
      const actual = new Float32Array(capture.nativeOutput.length);
      triangles.forEach((id, corner) => {
        actual.set(result.subarray(id * 3, id * 3 + 3), corner * 3);
      });
      expect(new Uint8Array(actual.buffer)).toEqual(
        new Uint8Array(new Float32Array(capture.nativeOutput).buffer),
      );
      if (selection) {
        let movedSharedSeams = 0;
        source.triangles.forEach((id, corner) => {
          const index = remap(id) * 3;
          if (!movable.has(id))
            expect(result.subarray(index, index + 3)).toEqual(
              before.subarray(index, index + 3),
            );
          else if (
            !selection[Math.floor(corner / 3)] &&
            result
              .subarray(index, index + 3)
              .some((value, axis) => value !== before[index + axis])
          )
            movedSharedSeams++;
        });
        expect(movedSharedSeams).toBeGreaterThan(0);
      }
      expect(triangles).toEqual(originalTriangles);
      // Compare bytes without materializing millions of assertion objects.
      const originalBytes = new Uint8Array(before.buffer);
      expect(
        new Uint8Array(vertices.buffer).every(
          (value, i) => value === originalBytes[i],
        ),
      ).toBe(true);
    } finally {
      pool.dispose();
    }
  },
  30_000,
);
it.each([
  selected1,
  selected2,
  selected3,
  selected4,
  selected5,
  whole2,
  whole3,
  boundaryOff,
])(
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

it("reused CPU threads preserve native selected iterations one through five across boundary-policy changes", async () => {
  vi.stubGlobal("Worker", ThreadWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 16 });
  const source = analyzeMesh(new Float32Array(selected3.positions));
  const vertices = new Float64Array(300_000 * 3);
  vertices.set(source.vertices);
  const topology = { ...source, vertices };
  const before = vertices.slice();
  const pool = new NoiseSmoothingPool();
  try {
    const captures = [
      selected1,
      whole2,
      selected2,
      selected3,
      boundaryOff,
      selected4,
      selected5,
      ...selectedBoundaryOff.cases.map((capture) => ({
        ...capture,
        positions: selectedBoundaryOff.positions,
        selection: selectedBoundaryOff.selection,
      })),
      selected1,
    ];
    let phases = 0;
    for (const [operation, capture] of captures.entries()) {
      const stages = [];
      const selection =
        "selection" in capture ? new Uint8Array(capture.selection) : undefined;
      const result = await pool.smooth(
        topology,
        capture.iterations,
        selection,
        capture.applyBoundaryEdges,
        { onProgress: (_, stage) => stages.push(stage) },
      );
      expect(ThreadWorker.owned).toHaveLength(2);
      phases += capture.iterations * 2;
      for (const worker of ThreadWorker.owned) {
        // Cached connectivity is initialized once; every preview gets fresh
        // masks and weights, with exactly two joined phases per iteration.
        expect(worker.initialized).toBe(1);
        expect(worker.operations).toBe(operation + 1);
        expect(worker.phases).toBe(phases);
      }
      expect(
        stages.filter(
          (stage) => stage === "Reducing mesh noise on two CPU workers",
        ),
      ).toHaveLength(capture.iterations);
      expect(
        stages.filter((stage) => stage === "Preparing noise weights"),
      ).toHaveLength(1);
      const actual = new Float32Array(capture.nativeOutput.length);
      source.triangles.forEach((id, corner) => {
        actual.set(result.subarray(id * 3, id * 3 + 3), corner * 3);
      });
      expect(new Uint8Array(actual.buffer)).toEqual(
        new Uint8Array(new Float32Array(capture.nativeOutput).buffer),
      );
      if (selection) {
        const movable = new Set();
        source.triangles.forEach((id, corner) => {
          if (selection[Math.floor(corner / 3)]) movable.add(id);
        });
        for (let id = 0; id < source.vertices.length / 3; id++) {
          if (!movable.has(id))
            expect(result.subarray(id * 3, id * 3 + 3)).toEqual(
              before.subarray(id * 3, id * 3 + 3),
            );
        }
      }
    }
    expect(vertices).toEqual(before);
  } finally {
    pool.dispose();
  }
}, 30_000);

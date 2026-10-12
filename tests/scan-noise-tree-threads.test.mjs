import { Worker as CpuWorker } from "node:worker_threads";
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import captures from "./fixtures/noise-octree-trees.json";
import { packNoiseOctree, partitionNoiseRoot } from "../src/scan-noise-octree";
import {
  noiseTreeWorkerCount,
  prepareNoiseOctreeAsync,
  refineNoiseTreeAsync,
} from "../src/scan-noise-tree-parallel";
import { queryNoiseOctree } from "../src/scan-noise-octree-query";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";

const bundle = await build({
  entryPoints: ["src/scan-noise-tree-worker.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const bridge = `import { parentPort } from "node:worker_threads";
globalThis.postMessage = data => parentPort.postMessage(data);
globalThis.close = () => process.exit(0);
${bundle.outputFiles[0].text}
parentPort.on("message", data => globalThis.onmessage({ data }));`;
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
  vi.useRealTimers();
});

it.each(captures.cases)(
  "real construction threads retain the native tree and signed queries: $name",
  async (capture) => {
    vi.stubGlobal("Worker", ThreadWorker);
    const prepared = packNoiseOctree(
      capture.points,
      capture.minextent,
      capture.maxdepth,
    );
    partitionNoiseRoot(prepared);
    const before = structuredClone(prepared);
    const result = await refineNoiseTreeAsync(
      prepared,
      capture.minextent,
      capture.maxdepth,
    );
    expect(ThreadWorker.owned).toHaveLength(2);
    expect(prepared).toEqual(before);
    expect(result.root.children[0]).not.toBe(prepared.root.children[0]);
    expect(
      JSON.parse(
        JSON.stringify(result.root, (key, value) =>
          key === "mode" ? undefined : value,
        ),
      ),
    ).toEqual(capture.root);
    for (const sample of capture.samples) {
      const hit = queryNoiseOctree(
        result.root,
        sample.point,
        sample.radius,
        result.triangleBounds,
        (id, radius) =>
          noiseTriangleDistance(sample.point, ...capture.points[id], radius),
      );
      expect(hit?.triangle ?? null).toBe(sample.winner);
      expect(hit?.distance ?? null).toBe(sample.distance);
    }
  },
  30000,
);

it("transport failure retries without changing the native construction", async () => {
  let stopped = 0;
  vi.stubGlobal(
    "Worker",
    class {
      postMessage() {
        throw new Error("transport failure");
      }
      terminate() {
        stopped++;
      }
    },
  );
  const capture = captures.cases[0];
  const prepared = packNoiseOctree(
    capture.points,
    capture.minextent,
    capture.maxdepth,
  );
  partitionNoiseRoot(prepared);
  const result = await refineNoiseTreeAsync(
    prepared,
    capture.minextent,
    capture.maxdepth,
  );
  expect(stopped).toBe(1);
  expect(
    JSON.parse(
      JSON.stringify(result.root, (key, value) =>
        key === "mode" ? undefined : value,
      ),
    ),
  ).toEqual(capture.root);
});

it.each(["abort", "timeout"])(
  "%s discards unfinished worker results and releases both tasks",
  async (mode) => {
    let stopped = 0;
    vi.useFakeTimers();
    vi.stubGlobal(
      "Worker",
      class {
        postMessage() {}
        terminate() {
          stopped++;
        }
      },
    );
    const capture = captures.cases[0];
    const prepared = packNoiseOctree(
      capture.points,
      capture.minextent,
      capture.maxdepth,
    );
    partitionNoiseRoot(prepared);
    const before = structuredClone(prepared);
    const controller = new AbortController();
    const request = refineNoiseTreeAsync(
      prepared,
      capture.minextent,
      capture.maxdepth,
      { signal: controller.signal },
    );
    if (mode === "abort") {
      const assertion = expect(request).rejects.toThrow("cancelled");
      controller.abort();
      await assertion;
      expect(prepared).toEqual(before);
    } else {
      await vi.advanceTimersByTimeAsync(120000);
      const result = await request;
      expect(
        JSON.parse(
          JSON.stringify(result.root, (key, value) =>
            key === "mode" ? undefined : value,
          ),
        ),
      ).toEqual(capture.root);
    }
    expect(stopped).toBe(2);
  },
);

it("construction admission retains CPU and memory bounds", () => {
  vi.stubGlobal("Worker", ThreadWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 16 });
  expect(noiseTreeWorkerCount(80000)).toBe(2);
  expect(noiseTreeWorkerCount(79999)).toBe(1);
  expect(noiseTreeWorkerCount(1000000)).toBe(1);
  vi.stubGlobal("navigator", { hardwareConcurrency: 2, deviceMemory: 16 });
  expect(noiseTreeWorkerCount(80000)).toBe(1);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 4 });
  expect(noiseTreeWorkerCount(80000)).toBe(1);
});

it("default production construction keeps the experimental workers disabled even when admission allows them", async () => {
  vi.stubGlobal("Worker", ThreadWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 16 });
  const indices = new Uint32Array(80000 * 3);
  for (let i = 0; i < indices.length; i += 3) indices.set([0, 1, 2], i);
  expect(noiseTreeWorkerCount(80000)).toBe(2);
  const prepared = await prepareNoiseOctreeAsync({
    coordinates: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices,
  });
  expect(prepared.points).toHaveLength(80000 * 9);
  expect(ThreadWorker.owned).toHaveLength(0);
});

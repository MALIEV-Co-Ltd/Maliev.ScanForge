import { afterEach, expect, it, vi } from "vitest";
import { analyzeMesh, type MeshTopology } from "../src/mesh-processing";
import { nativeNoiseVertices, noiseWeights } from "../src/scan-native-noise";
import {
  NoiseSmoothingPool,
  noiseRings,
  noiseWorkerCount,
  selectedNoiseMeans,
} from "../src/scan-noise-parallel";
import {
  noiseRange,
  type NoiseWorkerRequest,
  type NoiseWorkerResponse,
} from "../src/scan-noise-worker";
import base from "./fixtures/noise-annular-default.json";
import whole2 from "./fixtures/noise-annular-whole-2.json";
import whole3 from "./fixtures/noise-annular-whole-3.json";
import selected1 from "./fixtures/noise-annular-selected-1.json";
import selected3 from "./fixtures/noise-annular-selected-3.json";
import boundaryOff from "./fixtures/noise-annular-boundary-off.json";

const captures = [base, whole2, whole3, selected1, selected3, boundaryOff];
function identical(a: Float64Array, b: Float64Array) {
  const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
const pools: NoiseSmoothingPool[] = [];
afterEach(() => {
  pools.splice(0).forEach((p) => p.dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function pool() {
  const p = new NoiseSmoothingPool();
  pools.push(p);
  return p;
}
function marked(topology: MeshTopology, selection?: Uint8Array) {
  const result = new Uint8Array(topology.vertices.length / 3);
  topology.triangles.forEach((id, corner) => {
    if (!selection || selection[Math.floor(corner / 3)]) result[id] = 1;
  });
  return result;
}
it.each(captures)(
  "two-phase partition kernel matches native $iterations iteration capture selection=$selectionOnly",
  (capture) => {
    const topology = analyzeMesh(new Float32Array(capture.positions));
    const rings = noiseRings(topology);
    const weights = noiseWeights(topology, {});
    const selection =
      "selection" in capture
        ? new Uint8Array(capture.selection as number[])
        : undefined;
    const movable = marked(topology, selection);
    const neededMeans = selection
      ? selectedNoiseMeans(rings, movable, capture.applyBoundaryEdges)
      : undefined;
    let vertices = Float64Array.from(topology.vertices, Math.fround);
    const count = vertices.length / 3;
    const split = Math.floor(count / 2);
    for (let step = 0; step < capture.iterations; step++) {
      const means = new Float64Array(vertices.length);
      means.set(
        noiseRange(
          rings,
          0,
          split,
          vertices,
          undefined,
          undefined,
          undefined,
          true,
          neededMeans,
        ),
      );
      means.set(
        noiseRange(
          rings,
          split,
          count,
          vertices,
          undefined,
          undefined,
          undefined,
          true,
          neededMeans,
        ),
        split * 3,
      );
      const next = new Float64Array(vertices.length);
      next.set(
        noiseRange(
          rings,
          0,
          split,
          vertices,
          means,
          weights,
          movable,
          capture.applyBoundaryEdges,
        ),
      );
      next.set(
        noiseRange(
          rings,
          split,
          count,
          vertices,
          means,
          weights,
          movable,
          capture.applyBoundaryEdges,
        ),
        split * 3,
      );
      vertices = next;
    }
    const expanded = Array.from(topology.triangles).flatMap((id) =>
      Array.from(vertices.slice(id * 3, id * 3 + 3)),
    );
    expect(expanded).toEqual(capture.nativeOutput);
    expect(new Uint8Array(vertices.buffer)).toEqual(
      new Uint8Array(
        nativeNoiseVertices(
          topology,
          capture.iterations,
          selection,
          capture.applyBoundaryEdges,
        ).buffer,
      ),
    );
  },
);

it.each([true, false])(
  "selected means retain seam dependencies with boundary smoothing %s",
  (boundary) => {
    const topology = analyzeMesh(new Float32Array(selected3.positions));
    const rings = noiseRings(topology);
    const movable = marked(topology, new Uint8Array(selected3.selection));
    const needed = selectedNoiseMeans(rings, movable, boundary);
    expect(needed.some((value) => !value)).toBe(true);
    let unselectedDependencies = 0;
    for (let id = 0; id < movable.length; id++) {
      if (!movable[id] || (!boundary && rings.boundary[id])) continue;
      expect(needed[id]).toBe(1);
      for (
        let entry = rings.offsets[id];
        entry < rings.offsets[id + 1];
        entry++
      ) {
        const neighbor = rings.neighbors[entry];
        expect(needed[neighbor]).toBe(1);
        if (!movable[neighbor]) unselectedDependencies++;
      }
    }
    expect(unselectedDependencies).toBeGreaterThan(0);
    const vertices = Float64Array.from(topology.vertices, Math.fround);
    const complete = noiseRange(rings, 0, movable.length, vertices);
    const selected = noiseRange(
      rings,
      0,
      movable.length,
      vertices,
      undefined,
      undefined,
      undefined,
      boundary,
      needed,
    );
    for (let id = 0; id < movable.length; id++)
      expect(selected.subarray(id * 3, id * 3 + 3)).toEqual(
        needed[id]
          ? complete.subarray(id * 3, id * 3 + 3)
          : new Float64Array(3),
      );
  },
);

it("selected dependency preparation respects cancellation and empty selections", () => {
  const topology = analyzeMesh(new Float32Array(selected3.positions));
  const rings = noiseRings(topology);
  const movable = new Uint8Array(topology.vertices.length / 3);
  expect(selectedNoiseMeans(rings, movable, true)).toEqual(movable);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    selectedNoiseMeans(rings, movable, true, { signal: controller.signal }),
  ).toThrow("cancelled");
});

class FakeWorker {
  static workers: FakeWorker[] = [];
  static fail = false;
  static hang = false;
  onmessage?: (event: MessageEvent<NoiseWorkerResponse>) => void;
  onerror?: (event: ErrorEvent) => void;
  onmessageerror?: () => void;
  terminated = false;
  state?: NonNullable<NoiseWorkerRequest["initialize"]>;
  operation?: NoiseWorkerRequest["operation"];
  operationMessages = 0;
  jobs: NonNullable<NoiseWorkerRequest["job"]>[] = [];
  constructor() {
    FakeWorker.workers.push(this);
  }
  postMessage(data: NoiseWorkerRequest) {
    if (FakeWorker.fail) throw new Error("transport failure");
    if (data.initialize) {
      this.state = structuredClone(data.initialize);
      return;
    }
    if (data.operation) {
      this.operation = structuredClone(data.operation);
      this.operationMessages++;
      return;
    }
    if (!data.job || FakeWorker.hang) return;
    this.jobs.push(data.job);
    const job = structuredClone(data.job),
      state = this.state!,
      operation = this.operation!;
    // The second partition deliberately completes first.
    setTimeout(
      () => {
        if (this.terminated) return;
        const values = noiseRange(
          state.rings,
          state.begin,
          state.end,
          job.vertices,
          job.means,
          operation.weights,
          operation.movable,
          operation.applyBoundaryEdges,
          operation.neededMeans,
        );
        this.onmessage?.({
          data: { id: job.id, values },
        } as MessageEvent<NoiseWorkerResponse>);
      },
      state.begin ? 0 : 1,
    );
  }
  terminate() {
    this.terminated = true;
  }
}
function enabled() {
  FakeWorker.workers = [];
  FakeWorker.fail = false;
  FakeWorker.hang = false;
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 16 });
}
function padded() {
  const t = analyzeMesh(new Float32Array(selected3.positions));
  const vertices = new Float64Array(300_000 * 3);
  vertices.set(t.vertices);
  return { ...t, vertices };
}
it("pool retains rings, preserves immutable input and exact output across repeated selections", async () => {
  enabled();
  const t = padded(),
    p = pool(),
    before = t.vertices.slice();
  const mask = new Uint8Array(selected3.selection);
  const first = await p.smooth(t, 3, mask);
  expect(identical(first, nativeNoiseVertices(t, 3, mask))).toBe(true);
  const second = await p.smooth(t, 2);
  expect(identical(second, nativeNoiseVertices(t, 2))).toBe(true);
  expect(identical(t.vertices, before)).toBe(true);
  expect(FakeWorker.workers.length).toBe(2);
  for (const worker of FakeWorker.workers) {
    expect(worker.operationMessages).toBe(2);
    expect(worker.jobs).toHaveLength(10);
    expect(
      worker.jobs.every((job) => !("weights" in job) && !("movable" in job)),
    ).toBe(true);
  }
  expect(noiseRings(t)).toBe(noiseRings(t));
  p.dispose();
  expect(FakeWorker.workers.every((w) => w.terminated)).toBe(true);
});
it("serial fallback and failed transport preserve exact output", async () => {
  const small = analyzeMesh(new Float32Array(base.positions));
  expect(await pool().smooth(small, 3)).toEqual(nativeNoiseVertices(small, 3));
  enabled();
  FakeWorker.fail = true;
  const t = padded();
  expect(identical(await pool().smooth(t, 1), nativeNoiseVertices(t, 1))).toBe(
    true,
  );
  expect(FakeWorker.workers.every((w) => w.terminated)).toBe(true);
});
it("cancellation discards pending iteration and terminates both workers", async () => {
  enabled();
  FakeWorker.hang = true;
  const t = padded(),
    p = pool(),
    before = t.vertices.slice(),
    controller = new AbortController();
  const request = p.smooth(t, 3, undefined, true, {
    signal: controller.signal,
  });
  controller.abort();
  await expect(request).rejects.toThrow("cancelled");
  expect(identical(t.vertices, before)).toBe(true);
  expect(FakeWorker.workers.every((w) => w.terminated)).toBe(true);
});
it("operation timeout and idle expiry release owned workers", async () => {
  enabled();
  vi.useFakeTimers();
  FakeWorker.hang = true;
  const p = pool(),
    t = padded();
  const pending = expect(p.smooth(t)).rejects.toThrow("cancelled");
  await vi.advanceTimersByTimeAsync(120_000);
  await pending;
  expect(FakeWorker.workers.every((w) => w.terminated)).toBe(true);
  FakeWorker.hang = false;
  const result = p.smooth(t);
  await vi.advanceTimersByTimeAsync(10);
  await result;
  expect(FakeWorker.workers.some((w) => !w.terminated)).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(FakeWorker.workers.every((w) => w.terminated)).toBe(true);
});
it("admission respects CPUs, reported memory and extra copy budget", () => {
  enabled();
  expect(noiseWorkerCount(300_000, 1_000_000)).toBe(2);
  expect(noiseWorkerCount(299_999, 1)).toBe(1);
  expect(noiseWorkerCount(2_000_000, 20_000_000)).toBe(1);
  vi.stubGlobal("navigator", { hardwareConcurrency: 2, deviceMemory: 16 });
  expect(noiseWorkerCount(300_000, 1_000_000)).toBe(1);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 4 });
  expect(noiseWorkerCount(300_000, 1_000_000)).toBe(1);
});

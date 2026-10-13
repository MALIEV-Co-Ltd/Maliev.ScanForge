import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  AsyncScreenSelectionIndex,
  selectionWorkerCount,
} from "../src/screen-selection-client";
class WorkerDouble {
  static latest: WorkerDouble;
  static instances: WorkerDouble[] = [];
  sent: any[] = [];
  terminated = false;
  onmessage?: (event: any) => void;
  onerror?: (event: any) => void;
  constructor() {
    WorkerDouble.latest = this;
    WorkerDouble.instances.push(this);
  }
  postMessage(message: any) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("bounds parallelism by geometry size, CPU availability and memory", () => {
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
  expect(selectionWorkerCount(99_999)).toBe(1);
  expect(selectionWorkerCount(100_000)).toBe(2);
  expect(selectionWorkerCount(1_000_000)).toBe(1);
  vi.stubGlobal("navigator", { hardwareConcurrency: 2, deviceMemory: 8 });
  expect(selectionWorkerCount(100_000)).toBe(1);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 4 });
  expect(selectionWorkerCount(100_000)).toBe(1);
});

it("initializes point workers with one mask slot per XYZ sample", async () => {
  vi.stubGlobal("Worker", WorkerDouble);
  WorkerDouble.instances = [];
  const index = new AsyncScreenSelectionIndex([0, 0, 0, 1, 0, 0], [1], true);
  try {
    const pending = index.select(new THREE.OrthographicCamera(), region, view);
    const worker = WorkerDouble.latest;
    expect(worker.sent[0].initialize.pointCloud).toBe(true);
    expect(worker.sent[0].initialize.hidden).toEqual([1]);
    expect(worker.sent[1].range).toEqual({ start: 0, end: 2 });
    worker.onmessage?.({ data: { mask: new Uint8Array([1, 0]), start: 0 } });
    expect([...(await pending)]).toEqual([1, 0]);
  } finally {
    index.dispose();
  }
});

it("merges out-of-order shards only after both finish and releases both", async () => {
  vi.stubGlobal("Worker", WorkerDouble);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
  vi.useFakeTimers();
  WorkerDouble.instances = [];
  const index = new AsyncScreenSelectionIndex(new Float32Array(100_000 * 9));
  const pending = index.select(new THREE.OrthographicCamera(), region, view);
  const [a, b] = WorkerDouble.instances;
  expect(a.sent[1].range).toEqual({ start: 0, end: 50_000 });
  expect(b.sent[1].range).toEqual({ start: 50_000, end: 100_000 });
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  b.onmessage?.({
    data: { mask: new Uint8Array(50_000).fill(1), start: 50_000 },
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  a.onmessage?.({ data: { mask: new Uint8Array(50_000), start: 0 } });
  const mask = await pending;
  expect(mask.slice(0, 50_000).some(Boolean)).toBe(false);
  expect(mask.slice(50_000).every(Boolean)).toBe(true);
  index.dispose();
  expect(a.terminated && b.terminated).toBe(true);
});
const region = {
  kind: "lasso" as const,
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
  ] as [number, number][],
  radius: 1,
};
const view = { width: 100, height: 100, through: false };
function fixture() {
  vi.stubGlobal("Worker", WorkerDouble);
  vi.useFakeTimers();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return {
    positions,
    index: new AsyncScreenSelectionIndex(positions),
    camera: new THREE.OrthographicCamera(),
  };
}
it("prepares once before drawing, reuses the idle index and disposes its lease", async () => {
  const { index, camera } = fixture();
  index.prepare();
  const worker = WorkerDouble.latest;
  expect(worker.sent.length).toBe(1);
  index.prepare();
  index.cancel();
  expect(worker.terminated).toBe(false);
  const selection = index.select(camera, region, view);
  expect(WorkerDouble.latest).toBe(worker);
  expect(worker.sent.length).toBe(2);
  worker.onmessage?.({ data: { mask: new Uint8Array([1]) } });
  await selection;
  index.dispose();
  expect(worker.terminated).toBe(true);
});
it("copies geometry once, reuses worker and releases it after idle lease", async () => {
  const { positions, index, camera } = fixture();
  const pending = index.select(camera, region, view),
    worker = WorkerDouble.latest;
  expect(worker.sent[0].initialize.positions).not.toBe(positions);
  expect(worker.sent[0].initialize.positions).toEqual(positions);
  expect(worker.sent[1].frame.orthographic).toBe(true);
  worker.onmessage?.({ data: { mask: new Uint8Array([1]) } });
  expect([...(await pending)]).toEqual([1]);
  index.cancel();
  expect(worker.terminated).toBe(false);
  const next = index.select(camera, region, view);
  expect(worker.sent.length).toBe(3);
  worker.onmessage?.({ data: { mask: new Uint8Array([0]) } });
  await next;
  vi.advanceTimersByTime(60_000);
  expect(worker.terminated).toBe(true);
  index.dispose();
});
it("supersedes pending work without accepting its stale worker response", async () => {
  const { index, camera } = fixture();
  const first = index.select(camera, region, view);
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const old = WorkerDouble.latest;
  const second = index.select(camera, region, view),
    current = WorkerDouble.latest;
  expect(old.terminated).toBe(true);
  old.onmessage?.({ data: { mask: new Uint8Array([0]) } });
  old.onerror?.({ message: "late failure" });
  current.onmessage?.({ data: { mask: new Uint8Array([1]) } });
  await rejected;
  expect([...(await second)]).toEqual([1]);
  index.dispose();
});
it("times out and releases worker; dispose cancels an active job", async () => {
  const { index, camera } = fixture();
  const first = index.select(camera, region, view);
  const rejection = expect(first).rejects.toThrow("timed out");
  vi.advanceTimersByTime(120_000);
  await rejection;
  expect(WorkerDouble.latest.terminated).toBe(true);
  const second = index.select(camera, region, view);
  const canceled = expect(second).rejects.toMatchObject({ name: "AbortError" });
  index.dispose();
  await canceled;
  expect(WorkerDouble.latest.terminated).toBe(true);
});

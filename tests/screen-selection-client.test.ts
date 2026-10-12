import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { AsyncScreenSelectionIndex } from "../src/screen-selection-client";
class WorkerDouble {
  static latest: WorkerDouble;
  sent: any[] = [];
  terminated = false;
  onmessage?: (event: any) => void;
  onerror?: (event: any) => void;
  constructor() {
    WorkerDouble.latest = this;
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
it("copies geometry once, reuses worker and releases it after idle lease", async () => {
  const { positions, index, camera } = fixture();
  const pending = index.select(camera, region, view),
    worker = WorkerDouble.latest;
  expect(worker.sent[0].initialize.positions).not.toBe(positions);
  expect(worker.sent[0].initialize.positions).toEqual(positions);
  expect(worker.sent[1].frame.orthographic).toBe(true);
  worker.onmessage?.({ data: { mask: new Uint8Array([1]) } });
  expect([...(await pending)]).toEqual([1]);
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fitGridSurfaceAsync,
  SURFACE_HARD_LEASE_MS,
  SURFACE_INACTIVITY_MS,
} from "../src/surface-client";
import { createGridPatch } from "../src/surfaces";

class WorkerDouble {
  static instances: WorkerDouble[] = [];
  static failPost = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  payload?: { positions: Float32Array | Float64Array };
  constructor() {
    WorkerDouble.instances.push(this);
  }
  postMessage(
    message: { positions: Float32Array | Float64Array },
    transfer: ArrayBuffer[],
  ) {
    if (WorkerDouble.failPost) throw new Error("allocation failed");
    this.payload = structuredClone(message, { transfer });
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}
const options = {
  countU: 2,
  countV: 2,
  degree: 1,
  projection: "xy" as const,
  sampleLimit: 16,
};
const source = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const result = () => ({
  patch: createGridPatch(2, 2, 1, 1, 1),
  samples: 16,
  rms: 0,
  maxError: 0,
  projection: "xy",
  solverBytes: 128,
});
let page: EventTarget;
beforeEach(() => {
  vi.useFakeTimers();
  WorkerDouble.instances = [];
  WorkerDouble.failPost = false;
  vi.stubGlobal("Worker", WorkerDouble);
  page = new EventTarget();
  vi.stubGlobal("window", page);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("surface worker isolation and finite leases", () => {
  it("transfers an independent Float32 copy and releases the worker on success", async () => {
    const positions = new Float32Array(source);
    const promise = fitGridSurfaceAsync(positions, options);
    const worker = WorkerDouble.instances[0];
    expect(positions.byteLength).toBe(source.length * 4);
    expect(worker.payload?.positions).toEqual(positions);
    expect(worker.payload?.positions.buffer).not.toBe(positions.buffer);
    worker.reply({ result: result() });
    await expect(promise).resolves.toMatchObject({ rms: 0 });
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves double precision for array inputs", async () => {
    const positions = [...source];
    positions[0] = Math.PI;
    const promise = fitGridSurfaceAsync(positions, options),
      worker = WorkerDouble.instances[0];
    expect(worker.payload?.positions).toBeInstanceOf(Float64Array);
    expect(worker.payload?.positions[0]).toBe(Math.PI);
    expect(positions[0]).toBe(Math.PI);
    worker.reply({ result: result() });
    await promise;
  });
  it("supports cancellation before construction, during execution and on pagehide", async () => {
    const before = new AbortController();
    before.abort();
    await expect(
      fitGridSurfaceAsync(source, options, { signal: before.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(WorkerDouble.instances).toHaveLength(0);
    const controller = new AbortController(),
      promise = fitGridSurfaceAsync(source, options, {
        signal: controller.signal,
      });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(WorkerDouble.instances[0].terminated).toBe(true);
    const pagePromise = fitGridSurfaceAsync(source, options);
    page.dispatchEvent(new Event("pagehide"));
    await expect(pagePromise).rejects.toMatchObject({ name: "AbortError" });
    expect(WorkerDouble.instances[1].terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases failed, malformed and untransferable responses", async () => {
    for (const data of [
      { error: "singular fit" },
      { result: { ...result(), rms: NaN } },
      {},
    ]) {
      const promise = fitGridSurfaceAsync(source, options),
        worker = WorkerDouble.instances.at(-1)!;
      worker.reply(data);
      await expect(promise).rejects.toBeInstanceOf(Error);
      expect(worker.terminated).toBe(true);
    }
    const promise = fitGridSurfaceAsync(source, options),
      worker = WorkerDouble.instances.at(-1)!;
    worker.onmessageerror?.();
    await expect(promise).rejects.toThrow(/transfer/);
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases allocation and runtime failures", async () => {
    WorkerDouble.failPost = true;
    await expect(fitGridSurfaceAsync(source, options)).rejects.toThrow(
      /allocation/,
    );
    expect(WorkerDouble.instances[0].terminated).toBe(true);
    WorkerDouble.failPost = false;
    const promise = fitGridSurfaceAsync(source, options),
      worker = WorkerDouble.instances.at(-1)!;
    worker.onerror?.({ message: "worker crashed" });
    await expect(promise).rejects.toThrow(/crashed/);
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("renews inactivity on progress but retains an independent hard expiry", async () => {
    const progress = vi.fn(),
      promise = fitGridSurfaceAsync(source, options, { onProgress: progress });
    const rejected = expect(promise).rejects.toThrow(/ten-minute/),
      worker = WorkerDouble.instances[0];
    for (
      let elapsed = 0;
      elapsed < SURFACE_HARD_LEASE_MS;
      elapsed += SURFACE_INACTIVITY_MS / 2
    ) {
      worker.reply({ status: "running" });
      await vi.advanceTimersByTimeAsync(SURFACE_INACTIVITY_MS / 2);
    }
    await rejected;
    expect(progress).toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("expires workers without progress", async () => {
    const promise = fitGridSurfaceAsync(source, options),
      rejected = expect(promise).rejects.toThrow(/without progress/);
    await vi.advanceTimersByTimeAsync(SURFACE_INACTIVITY_MS);
    await rejected;
    expect(WorkerDouble.instances[0].terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

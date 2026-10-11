import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  processMesh,
  type ProcessingRequest,
  type ProcessingResult,
} from "../src/processing-client";

class ProcessingWorkerDouble {
  static latest: ProcessingWorkerDouble;
  static creates = 0;
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent?: ProcessingRequest;
  transfers?: Transferable[];
  constructor() {
    ProcessingWorkerDouble.latest = this;
    ProcessingWorkerDouble.creates++;
  }
  postMessage(request: ProcessingRequest, transfers: Transferable[]) {
    this.sent = request;
    this.transfers = transfers;
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const request: ProcessingRequest = {
  kind: "report",
  positions,
  tolerance: 0.001,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", ProcessingWorkerDouble);
  ProcessingWorkerDouble.creates = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("processing worker resource ownership", () => {
  it("transfers cloned input while preserving the scene buffer and releases the successful worker", async () => {
    const pending = processMesh(request);
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.sent?.positions).not.toBe(positions);
    expect(Array.from(worker.sent!.positions)).toEqual(Array.from(positions));
    expect(worker.transfers).toEqual([
      (worker.sent!.positions as Float32Array).buffer,
    ]);
    const result: ProcessingResult = { kind: "report", diagnostics: {} };
    worker.reply({ result });
    expect(await pending).toBe(result);
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(positions.byteLength).toBe(36);
  });
  it("clones both ICP buffers and releases on cancellation", async () => {
    const controller = new AbortController();
    const pending = processMesh(
      {
        kind: "icp",
        positions,
        target: positions,
        maxDistance: 1,
        maxIterations: 10,
        sampleSize: 3,
        targetSampleSize: 3,
        tolerance: 1e-5,
        trimFraction: 1,
      },
      { signal: controller.signal },
    );
    const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.transfers).toHaveLength(2);
    expect((worker.sent as { target: Float32Array }).target).not.toBe(
      positions,
    );
    controller.abort();
    await check;
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not create a worker when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      processMesh(request, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(ProcessingWorkerDouble.creates).toBe(0);
  });
  it("renews inactivity on progress but always enforces the hard lease", async () => {
    const progress = vi.fn();
    const pending = processMesh(request, { onProgress: progress });
    const check = expect(pending).rejects.toThrow(/fifteen-minute/);
    const worker = ProcessingWorkerDouble.latest;
    for (let i = 0; i < 14; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      worker.reply({ progress: i / 15, stage: "Processing" });
    }
    await vi.advanceTimersByTimeAsync(60_000);
    await check;
    expect(progress).toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases a stalled worker and parse/decode/error paths", async () => {
    const stalled = processMesh(request);
    const check = expect(stalled).rejects.toThrow(/without progress/);
    await vi.advanceTimersByTimeAsync(120_000);
    await check;
    expect(ProcessingWorkerDouble.latest.terminated).toBe(true);
    const failed = processMesh(request);
    const failure = expect(failed).rejects.toThrow("Invalid topology");
    ProcessingWorkerDouble.latest.reply({ error: "Invalid topology" });
    await failure;
    const decode = processMesh(request);
    const decoded = expect(decode).rejects.toThrow(/decode/);
    ProcessingWorkerDouble.latest.onmessageerror?.();
    await decoded;
    const error = processMesh(request);
    const errored = expect(error).rejects.toThrow("Worker failed");
    ProcessingWorkerDouble.latest.onerror?.({ message: "Worker failed" });
    await errored;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases the worker on pagehide and removes its listener", async () => {
    const listeners = new Map<string, () => void>();
    const add = vi.fn((event: string, callback: () => void) =>
      listeners.set(event, callback),
    );
    const remove = vi.fn((event: string) => listeners.delete(event));
    vi.stubGlobal("addEventListener", add);
    vi.stubGlobal("removeEventListener", remove);
    const pending = processMesh(request);
    const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    listeners.get("pagehide")?.();
    await check;
    expect(remove).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(ProcessingWorkerDouble.latest.terminated).toBe(true);
    expect(listeners.size).toBe(0);
  });
  it("releases the worker on dispatch and callback failures or malformed replies", async () => {
    const throwing = new Float32Array(positions);
    throwing.slice = () => {
      throw new Error("Copy allocation failed");
    };
    await expect(
      processMesh({ ...request, positions: throwing }),
    ).rejects.toThrow("Copy allocation failed");
    expect(ProcessingWorkerDouble.latest.terminated).toBe(true);
    const callback = processMesh(request, {
      onProgress: () => {
        throw new Error("Progress failed");
      },
    });
    const callbackCheck = expect(callback).rejects.toThrow("Progress failed");
    ProcessingWorkerDouble.latest.reply({ progress: 0.5, stage: "test" });
    await callbackCheck;
    const malformed = processMesh(request);
    const malformedCheck = expect(malformed).rejects.toThrow(/Unexpected/);
    ProcessingWorkerDouble.latest.reply(null);
    await malformedCheck;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("runs actual worker segmentation and registration, transferring geometry without topology Maps", async () => {
    const replies: { message: unknown; transfers?: Transferable[] }[] = [];
    const scope = {
      onmessage: null as ((event: { data: ProcessingRequest }) => void) | null,
      postMessage: (message: unknown, transfers?: Transferable[]) =>
        replies.push({ message, transfers }),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    const triangles = new Float32Array([
      ...positions,
      5,
      0,
      0,
      6,
      0,
      0,
      5,
      1,
      0,
    ]);
    scope.onmessage?.({
      data: {
        kind: "segment",
        positions: triangles,
        tolerance: 0.001,
        angleDegrees: 25,
      },
    });
    const final = replies.at(-1)!;
    const result = (final.message as { result: ProcessingResult }).result;
    expect(result.segments).toHaveLength(2);
    expect(result.segments?.map((segment) => segment.length)).toEqual([9, 9]);
    expect(final.transfers).toHaveLength(2);
    expect(result.topology).toBeUndefined();
    replies.length = 0;
    scope.onmessage?.({
      data: {
        kind: "paired",
        positions,
        sourceLandmarks: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        targetLandmarks: [2, 0, 0, 3, 0, 0, 2, 1, 0],
      },
    });
    const aligned = (replies.at(-1)!.message as { result: ProcessingResult })
      .result;
    expect(aligned.positions?.[0]).toBeCloseTo(2);
    expect(aligned.registration?.rms).toBeLessThan(1e-10);
    expect(replies.at(-1)!.transfers).toHaveLength(1);
  });
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  prepareMeshInBackground,
  backgroundMeshPreparation,
  stopBackgroundMeshPreparation,
} from "../src/scan-background-preparation";
import type { Positions } from "../src/types";
import { queueProcessing } from "../src/processing-queue";
import { SCAN_DEFAULT_BUDGET_BYTES } from "../src/scan-geometry-source";
const mesh = () => Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const admittedFacets = SCAN_DEFAULT_BUDGET_BYTES / 512;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stopBackgroundMeshPreparation();
  vi.useRealTimers();
});
it("admits the exact optional warmup budget boundary", async () => {
  const positions = new Float32Array(admittedFacets * 9);
  const observe = vi.fn((_positions: Positions) => vi.fn());
  prepareMeshInBackground(positions, { observe });
  expect(backgroundMeshPreparation(positions).phase).toBe("scheduled");
  await vi.advanceTimersByTimeAsync(250);
  expect(observe).toHaveBeenCalledOnce();
  expect(observe.mock.calls[0][0]).toBe(positions);
});

it("leaves oversized optional warmup inactive without timers, idle callbacks, or expiry errors", async () => {
  const positions = new Float32Array((admittedFacets + 1) * 9);
  const observe = vi.fn((_positions: Positions) => vi.fn());
  const idle = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);
  try {
    prepareMeshInBackground(positions, { observe });
    expect(backgroundMeshPreparation(positions).phase).toBe("inactive");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 500);
    expect(observe).not.toHaveBeenCalled();
    expect(idle).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(backgroundMeshPreparation(positions).phase).toBe("inactive");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("prepares a small source after an oversized source was skipped", async () => {
  const observe = vi.fn((_positions: Positions) => vi.fn());
  prepareMeshInBackground(new Float32Array((admittedFacets + 1) * 9), {
    observe,
  });
  const small = mesh();
  const stop = prepareMeshInBackground(small, { observe });
  await vi.advanceTimersByTimeAsync(250);
  expect(observe).toHaveBeenCalledOnce();
  expect(observe.mock.calls[0][0]).toBe(small);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});
it("yields before preparation and exposes background progress without changing geometry", async () => {
  const positions = mesh(),
    before = positions.slice(),
    leave = vi.fn();
  let notify: any;
  const observe = vi.fn((_p: any, update: any, _run: any, options: any) => {
    notify = update;
    expect(options.prepareTopology).toBe(true);
    update({ phase: "pending", progress: "Welding vertices · 20%" });
    return leave;
  });
  const stop = prepareMeshInBackground(positions, { observe });
  expect(observe).not.toHaveBeenCalled();
  expect(backgroundMeshPreparation(positions).phase).toBe("scheduled");
  await vi.advanceTimersByTimeAsync(500);
  expect(observe).toHaveBeenCalledOnce();
  expect(backgroundMeshPreparation(positions)).toMatchObject({
    phase: "pending",
    progress: expect.stringContaining("Welding"),
  });
  notify({ phase: "ready", topology: { triangles: 1 } });
  expect(backgroundMeshPreparation(positions).phase).toBe("ready");
  expect(positions).toEqual(before);
  stop();
  expect(leave).toHaveBeenCalledOnce();
  expect(backgroundMeshPreparation(positions).phase).toBe("inactive");
});
it("waits for foreground processing rather than launching a competing worker", async () => {
  let release!: () => void;
  const foreground = queueProcessing(
    mesh(),
    undefined,
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  const observe = vi.fn((_positions: Positions) => vi.fn());
  prepareMeshInBackground(mesh(), { observe });
  await vi.advanceTimersByTimeAsync(1000);
  expect(observe).not.toHaveBeenCalled();
  release();
  await foreground;
  await vi.advanceTimersByTimeAsync(500);
  expect(observe).toHaveBeenCalledOnce();
});
it("cancels obsolete scheduled work and keeps one preparation owner", async () => {
  const first = mesh(),
    second = mesh(),
    observe = vi.fn((_positions: Positions) => vi.fn());
  prepareMeshInBackground(first, { observe });
  prepareMeshInBackground(second, { observe });
  await vi.advanceTimersByTimeAsync(500);
  expect(observe).toHaveBeenCalledOnce();
  expect(observe.mock.calls[0][0]).toBe(second);
  expect(backgroundMeshPreparation(first).phase).toBe("inactive");
});
it("does not start while the host is busy and cancels pending timers on disposal", async () => {
  let busy = true;
  const observe = vi.fn((_positions: Positions) => vi.fn());
  const stop = prepareMeshInBackground(mesh(), {
    observe,
    canStart: () => !busy,
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(observe).not.toHaveBeenCalled();
  busy = false;
  stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(observe).not.toHaveBeenCalled();
});

it("bounds postponed work with a finite lease", async () => {
  const positions = mesh(),
    observe = vi.fn((_positions: Positions) => vi.fn());
  prepareMeshInBackground(positions, { observe, canStart: () => false });
  await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 500);
  expect(observe).not.toHaveBeenCalled();
  expect(backgroundMeshPreparation(positions).phase).toBe("error");
  expect(vi.getTimerCount()).toBe(0);
});

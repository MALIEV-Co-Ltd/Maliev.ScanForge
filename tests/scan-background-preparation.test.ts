import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  prepareMeshInBackground,
  backgroundMeshPreparation,
  stopBackgroundMeshPreparation,
} from "../src/scan-background-preparation";
import type { Positions } from "../src/types";
import { queueProcessing } from "../src/processing-queue";
const mesh = () => Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stopBackgroundMeshPreparation();
  vi.useRealTimers();
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

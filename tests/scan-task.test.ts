import { afterEach, expect, it, vi } from "vitest";
import { yieldScanTask } from "../src/scan-task";
afterEach(() => vi.unstubAllGlobals());
it("awaits the browser scheduler with its receiver intact", async () => {
  let release!: () => void;
  const pending = new Promise<void>((r) => (release = r));
  const scheduler = {
    yield: vi.fn(function (this: unknown) {
      expect(this).toBe(scheduler);
      return pending;
    }),
  };
  vi.stubGlobal("scheduler", scheduler);
  let finished = false;
  const task = yieldScanTask().then(() => (finished = true));
  await Promise.resolve();
  expect(finished).toBe(false);
  release();
  await task;
  expect(finished).toBe(true);
  expect(scheduler.yield).toHaveBeenCalledTimes(1);
});
it.each([undefined, {}])(
  "uses an asynchronous timer when cooperative scheduling is unavailable: %s",
  async (scheduler) => {
    vi.stubGlobal("scheduler", scheduler);
    let completed = false;
    const task = yieldScanTask().then(() => (completed = true));
    expect(completed).toBe(false);
    await task;
    expect(completed).toBe(true);
  },
);
it("propagates a scheduler failure rather than silently running a long synchronous task", async () => {
  vi.stubGlobal("scheduler", {
    yield: () => Promise.reject(new Error("scheduler failed")),
  });
  await expect(yieldScanTask()).rejects.toThrow("scheduler failed");
});

import { afterEach, expect, it, vi } from "vitest";
import { presentFrame } from "../src/frame-presentation";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("does not report completion until the drawn frame has a paint opportunity", async () => {
  vi.useFakeTimers();
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++id, fn);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  let rendered = false,
    completed = false;
  const pending = presentFrame(() => {
    rendered = true;
  }).then(() => {
    completed = true;
  });
  expect(rendered).toBe(false);
  frames.get(1)!(0);
  await Promise.resolve();
  expect(rendered).toBe(true);
  expect(completed).toBe(false);
  frames.get(2)!(16);
  await pending;
  expect(completed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels the owned frame and lease without rendering", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(),
    render = vi.fn();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  const controller = new AbortController();
  const pending = presentFrame(render, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await rejected;
  expect(render).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledWith(1);
  expect(vi.getTimerCount()).toBe(0);
});

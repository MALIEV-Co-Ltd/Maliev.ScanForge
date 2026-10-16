import { afterEach, expect, it, vi } from "vitest";
import { queueProcessing } from "../src/processing-queue";

afterEach(() => vi.unstubAllGlobals());

it("discards queued work on page exit before it can allocate another worker", async () => {
  const events = new EventTarget();
  vi.stubGlobal("addEventListener", events.addEventListener.bind(events));
  vi.stubGlobal("removeEventListener", events.removeEventListener.bind(events));
  const positions = new Float32Array(9);
  let finish!: (result: string) => void;
  const active = queueProcessing(
    positions,
    undefined,
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const startQueued = vi.fn(async () => "queued");
  const queued = queueProcessing(positions, undefined, startQueued);
  const checked = expect(queued).rejects.toMatchObject({ name: "AbortError" });
  events.dispatchEvent(new Event("pagehide"));
  finish("active");
  await active;
  await checked;
  expect(startQueued).not.toHaveBeenCalled();
});

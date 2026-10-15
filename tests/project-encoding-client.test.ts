import { afterEach, expect, it, vi } from "vitest";
import { encodeProjectInBackground } from "../src/project-encoding-client";
import type { ProjectSession } from "../src/project-file";

class EncodingWorker {
  static instances: EncodingWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    EncodingWorker.instances.push(this);
  }
}
const session = {
  project: { entities: [] },
  history: [],
  future: [],
} as unknown as ProjectSession;
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  EncodingWorker.instances = [];
});
it("serializes background encoders and returns the original lossless blob", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  const first = encodeProjectInBackground(session),
    second = encodeProjectInBackground(session);
  await Promise.resolve();
  expect(EncodingWorker.instances).toHaveLength(1);
  const worker = EncodingWorker.instances[0],
    file = new Blob(["exact payload"]);
  expect(worker.postMessage).toHaveBeenCalledWith({ session, localClouds: [] });
  worker.onmessage!({ data: { file } });
  expect(await first).toBe(file);
  await Promise.resolve();
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(EncodingWorker.instances).toHaveLength(2);
  EncodingWorker.instances[1].onmessage!({ data: { file } });
  await second;
  expect(EncodingWorker.instances[1].terminate).toHaveBeenCalledOnce();
});
it("rejects a failed worker without running costly encoding on the UI thread", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  const result = encodeProjectInBackground(session);
  const rejected = expect(result).rejects.toThrow("Invalid geometry");
  await Promise.resolve();
  const worker = EncodingWorker.instances[0];
  worker.onmessage!({ data: { error: "Invalid geometry" } });
  await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("releases an unresponsive encoder after its finite lease and admits the next request", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", EncodingWorker);
  const result = encodeProjectInBackground(session);
  const rejected = expect(result).rejects.toThrow(/lease/);
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(120_000);
  await rejected;
  expect(EncodingWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it("cancels active and queued work on page exit without launching another worker", async () => {
  const events = new EventTarget();
  vi.stubGlobal("addEventListener", events.addEventListener.bind(events));
  vi.stubGlobal("removeEventListener", events.removeEventListener.bind(events));
  vi.stubGlobal("Worker", EncodingWorker);
  vi.resetModules();
  const { encodeProjectInBackground: encode } =
    await import("../src/project-encoding-client");
  const first = encode(session),
    second = encode(session);
  const firstRejected = expect(first).rejects.toThrow(/page exit/);
  const secondRejected = expect(second).rejects.toThrow(/page exit/);
  await Promise.resolve();
  events.dispatchEvent(new Event("pagehide"));
  await Promise.all([firstRejected, secondRejected]);
  expect(EncodingWorker.instances).toHaveLength(1);
  expect(EncodingWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it("terminates a cancelled active encoder and never starts a cancelled queued encoder", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  const active = new AbortController(),
    queued = new AbortController();
  const first = encodeProjectInBackground(session, active.signal);
  const second = encodeProjectInBackground(session, queued.signal);
  const rejectedFirst = expect(first).rejects.toMatchObject({
    name: "AbortError",
  });
  const rejectedSecond = expect(second).rejects.toMatchObject({
    name: "AbortError",
  });
  await Promise.resolve();
  queued.abort();
  active.abort();
  await Promise.all([rejectedFirst, rejectedSecond]);
  expect(EncodingWorker.instances).toHaveLength(1);
  expect(EncodingWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

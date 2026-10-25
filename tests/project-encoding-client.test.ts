import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectSession } from "../src/project-file";

let encodeBackground: typeof import("../src/project-encoding-client").encodeProjectInBackground;
beforeEach(async () => {
  vi.resetModules();
  ({ encodeProjectInBackground: encodeBackground } =
    await import("../src/project-encoding-client"));
});

const pending = new Set<Promise<Blob>>();
function encodeProjectInBackground(
  session: ProjectSession,
  signal?: AbortSignal,
) {
  const promise = encodeBackground(session, signal);
  pending.add(promise);
  void promise.then(
    () => pending.delete(promise),
    () => pending.delete(promise),
  );
  return promise;
}
async function flushEncoding() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

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

it("reports large-container disk failures instead of retaining another in-memory result", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  vi.stubGlobal("indexedDB", {
    open: () => {
      throw new Error("Temporary storage unavailable");
    },
  });
  const result = encodeProjectInBackground(session);
  const rejected = expect(result).rejects.toThrow(
    "Temporary storage unavailable",
  );
  await flushEncoding();
  const file = new Blob(["small backing for allocation policy test"]);
  Object.defineProperty(file, "size", { value: 64 * 1024 * 1024 });
  EncodingWorker.instances[0].onmessage!({ data: { file } });
  await rejected;
  expect(EncodingWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
afterEach(async () => {
  // A failed assertion must retire controlled work before the next fixture.
  for (let i = 0; pending.size && i < 16; i++) {
    for (const worker of EncodingWorker.instances)
      if (!worker.terminate.mock.calls.length)
        worker.onmessage?.({ data: { error: "Test cleanup" } });
    await flushEncoding();
  }
  expect(pending.size).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  EncodingWorker.instances = [];
});
it("serializes different snapshots and returns the original lossless blob", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  const first = encodeProjectInBackground(session),
    second = encodeProjectInBackground({
      ...session,
      project: { ...session.project, name: "Different project" },
    });
  await flushEncoding();
  expect(EncodingWorker.instances).toHaveLength(1);
  const worker = EncodingWorker.instances[0],
    file = new Blob(["exact payload"]);
  expect(worker.postMessage).toHaveBeenCalledWith({ session, localClouds: [] });
  worker.onmessage!({ data: { file } });
  expect(await first).toBe(file);
  await flushEncoding();
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
  await flushEncoding();
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
  await flushEncoding();
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
  await flushEncoding();
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
  const second = encodeProjectInBackground(
    { ...session, project: { ...session.project, name: "Queued project" } },
    queued.signal,
  );
  const rejectedFirst = expect(first).rejects.toMatchObject({
    name: "AbortError",
  });
  const rejectedSecond = expect(second).rejects.toMatchObject({
    name: "AbortError",
  });
  await flushEncoding();
  queued.abort();
  active.abort();
  await Promise.all([rejectedFirst, rejectedSecond]);
  expect(EncodingWorker.instances).toHaveLength(1);
  expect(EncodingWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it("shares an in-flight encode across fresh GUI/backup/MCP wrappers for the same snapshot", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  const snapshot = {
    ...session,
    project: { ...session.project, authoring: {} },
  };
  const first = encodeProjectInBackground(snapshot);
  const second = encodeProjectInBackground({
    ...snapshot,
    project: { ...snapshot.project, authoring: {} },
  });
  await flushEncoding();
  const file = new Blob(["one complete lossless project"]);
  EncodingWorker.instances[0].onmessage!({ data: { file } });
  expect(await first).toBe(file);
  await flushEncoding();
  expect(EncodingWorker.instances).toHaveLength(1);
  expect(await second).toBe(file);
  expect(EncodingWorker.instances).toHaveLength(1);
  expect(EncodingWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it("cancels only the departing consumer while another caller still needs the encode", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  const cancelled = new AbortController();
  const first = encodeProjectInBackground(session, cancelled.signal);
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const second = encodeProjectInBackground(session);
  await flushEncoding();
  cancelled.abort();
  await rejected;
  expect(EncodingWorker.instances).toHaveLength(1);
  expect(EncodingWorker.instances[0].terminate).not.toHaveBeenCalled();
  const file = new Blob(["still needed"]);
  EncodingWorker.instances[0].onmessage!({ data: { file } });
  expect(await second).toBe(file);
  expect(EncodingWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it("terminates shared work when its last consumer cancels and admits a fresh request", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  const a = new AbortController(),
    b = new AbortController();
  const first = encodeProjectInBackground(session, a.signal);
  const second = encodeProjectInBackground(session, b.signal);
  const rejectedA = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const rejectedB = expect(second).rejects.toMatchObject({
    name: "AbortError",
  });
  await flushEncoding();
  a.abort();
  b.abort();
  await Promise.all([rejectedA, rejectedB]);
  expect(EncodingWorker.instances).toHaveLength(1);
  expect(EncodingWorker.instances[0].terminate).toHaveBeenCalledOnce();
  const fresh = encodeProjectInBackground(session);
  await flushEncoding();
  expect(EncodingWorker.instances).toHaveLength(2);
  const file = new Blob(["fresh"]);
  EncodingWorker.instances[1].onmessage!({ data: { file } });
  expect(await fresh).toBe(file);
});

it.each(["entities", "history", "future", "projectId", "authoring"] as const)(
  "does not share a changed %s snapshot",
  async (field) => {
    vi.stubGlobal("Worker", EncodingWorker);
    const next: ProjectSession = {
      ...session,
      project: { ...session.project },
    };
    if (field === "entities")
      next.project.entities = [...session.project.entities];
    else if (field === "history") next.history = [...session.history];
    else if (field === "future") next.future = [...session.future];
    else if (field === "projectId") next.projectId = "another-project";
    else next.project.authoring = { activeSketchId: "different-authoring" };
    const first = encodeProjectInBackground(session);
    const second = encodeProjectInBackground(next);
    await flushEncoding();
    const file = new Blob(["first"]);
    EncodingWorker.instances[0].onmessage!({ data: { file } });
    await first;
    await flushEncoding();
    expect(EncodingWorker.instances).toHaveLength(2);
    const changed = new Blob(["changed"]);
    EncodingWorker.instances[1].onmessage!({ data: { file: changed } });
    expect(await second).toBe(changed);
  },
);

it("reuses a completed identical file while another consumer retains it", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  const first = encodeProjectInBackground(session);
  await flushEncoding();
  const file = new Blob(["retained by the export artifact"]);
  EncodingWorker.instances[0].onmessage!({ data: { file } });
  expect(await first).toBe(file);
  const second = encodeProjectInBackground(session);
  await flushEncoding();
  expect(EncodingWorker.instances).toHaveLength(1);
  expect(await second).toBe(file);
});

it("starts a fresh encode when the weak completed result is no longer available", async () => {
  class CollectedReference {
    static all: CollectedReference[] = [];
    constructor(public target: object | undefined) {
      CollectedReference.all.push(this);
    }
    deref() {
      return this.target;
    }
  }
  vi.stubGlobal("WeakRef", CollectedReference);
  vi.stubGlobal("Worker", EncodingWorker);
  const first = encodeProjectInBackground(session);
  await flushEncoding();
  const firstFile = new Blob(["first"]);
  EncodingWorker.instances[0].onmessage!({ data: { file: firstFile } });
  await first;
  const fileReferences = CollectedReference.all.filter(
    (reference) => reference.target === firstFile,
  );
  expect(fileReferences).toHaveLength(1);
  fileReferences[0].target = undefined;
  const second = encodeProjectInBackground(session);
  await flushEncoding();
  expect(EncodingWorker.instances).toHaveLength(2);
  const file = new Blob(["new result"]);
  EncodingWorker.instances[1].onmessage!({ data: { file } });
  expect(await second).toBe(file);
});

it("cancels a cached result delivery without losing the other consumer's file", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  const first = encodeProjectInBackground(session);
  await flushEncoding();
  const file = new Blob(["still retained"]);
  EncodingWorker.instances[0].onmessage!({ data: { file } });
  await first;
  const cancelled = new AbortController();
  const delivery = encodeProjectInBackground(session, cancelled.signal);
  const rejected = expect(delivery).rejects.toMatchObject({
    name: "AbortError",
  });
  cancelled.abort();
  await rejected;
  expect(await encodeProjectInBackground(session)).toBe(file);
  expect(EncodingWorker.instances).toHaveLength(1);
});

it("rejects both consumers on failure and permits another encode of the same snapshot", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  const first = encodeProjectInBackground(session);
  const second = encodeProjectInBackground(session);
  const rejectedA = expect(first).rejects.toThrow("Invalid shared geometry");
  const rejectedB = expect(second).rejects.toThrow("Invalid shared geometry");
  await flushEncoding();
  EncodingWorker.instances[0].onmessage!({
    data: { error: "Invalid shared geometry" },
  });
  await Promise.all([rejectedA, rejectedB]);
  const fresh = encodeProjectInBackground(session);
  await flushEncoding();
  expect(EncodingWorker.instances).toHaveLength(2);
  const file = new Blob(["recovered"]);
  EncodingWorker.instances[1].onmessage!({ data: { file } });
  expect(await fresh).toBe(file);
});

it("does not attach an already cancelled caller to another consumer's encode", async () => {
  vi.stubGlobal("Worker", EncodingWorker);
  const active = encodeProjectInBackground(session);
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(
    encodeProjectInBackground(session, cancelled.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await flushEncoding();
  expect(EncodingWorker.instances).toHaveLength(1);
  expect(EncodingWorker.instances[0].terminate).not.toHaveBeenCalled();
  const file = new Blob(["active"]);
  EncodingWorker.instances[0].onmessage!({ data: { file } });
  expect(await active).toBe(file);
});

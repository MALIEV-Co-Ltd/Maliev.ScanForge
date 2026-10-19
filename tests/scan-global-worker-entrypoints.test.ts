import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

function workerRealm() {
  vi.resetModules();
  vi.useFakeTimers();
  const sentinel = vi.fn();
  const postMessage = vi.fn();
  const close = vi.fn();
  vi.stubGlobal("document", undefined);
  vi.stubGlobal("postMessage", postMessage);
  vi.stubGlobal("close", close);
  vi.stubGlobal("onmessage", sentinel);
  return { sentinel, postMessage, close };
}

// Worker entries install a worker handler, not a Window-bound DOM method.
const workerScope = () =>
  globalThis as unknown as { onmessage: (event: MessageEvent) => void };

const pureImports = [
  ["scene factory", () => import("../src/scan-global-scene-core")],
  ["query factory", () => import("../src/scan-global-query-core")],
  ["input factory", () => import("../src/global-alignment-input-core")],
  ["transform factory", () => import("../src/datum-transform-core")],
  ["scene client", () => import("../src/scan-global-scene-client")],
  ["query pool", () => import("../src/scan-global-query-pool")],
  ["registration controller", () => import("../src/scan-global-registration")],
  ["public input adapter", () => import("../src/global-alignment-input")],
] as const;

it.each(pureImports)(
  "%s import leaves a worker-like global untouched",
  async (_name, load) => {
    const realm = workerRealm();
    expect(vi.getTimerCount()).toBe(0);
    await load();
    expect(globalThis.onmessage).toBe(realm.sentinel);
    expect(vi.getTimerCount()).toBe(0);
    expect(realm.postMessage).not.toHaveBeenCalled();
    expect(realm.close).not.toHaveBeenCalled();
  },
);

const entryImports = [
  ["scene", () => import("../src/scan-global-scene-worker")],
  ["query", () => import("../src/scan-global-query-worker")],
  ["input", () => import("../src/global-alignment-input-worker")],
  ["transform", () => import("../src/datum-transform-worker")],
] as const;

it.each(entryImports)(
  "%s entry remains inactive with a document",
  async (_name, load) => {
    const realm = workerRealm();
    vi.stubGlobal("document", {});
    await load();
    expect(globalThis.onmessage).toBe(realm.sentinel);
    expect(vi.getTimerCount()).toBe(0);
    expect(realm.postMessage).not.toHaveBeenCalled();
  },
);

it("scene entry installs its existing handler, sends errors and closes its lease", async () => {
  const realm = workerRealm();
  const entry = await import("../src/scan-global-scene-worker");
  const core = await import("../src/scan-global-scene-core");
  expect(entry.executeGlobalScenePreparation).toBe(
    core.executeGlobalScenePreparation,
  );
  expect(globalThis.onmessage).not.toBe(realm.sentinel);
  expect(vi.getTimerCount()).toBe(1);
  workerScope().onmessage({ data: { scans: [], radius: -1 } } as MessageEvent);
  expect(realm.postMessage).toHaveBeenCalledTimes(1);
  expect(realm.postMessage.mock.calls[0][0]).toEqual({
    error: expect.any(String),
  });
  expect(realm.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("query entry retains initialization, request IDs and its original idle lease", async () => {
  const realm = workerRealm();
  const entry = await import("../src/scan-global-query-worker");
  const core = await import("../src/scan-global-query-core");
  expect(entry.createGlobalQueryWorkerState).toBe(
    core.createGlobalQueryWorkerState,
  );
  expect(globalThis.onmessage).not.toBe(realm.sentinel);
  expect(vi.getTimerCount()).toBe(2);
  workerScope().onmessage({
    data: { id: 7, initialize: { scans: [] } },
  } as MessageEvent);
  expect(realm.postMessage.mock.calls[0][0]).toMatchObject({
    id: 7,
    ready: true,
    indexes: 0,
  });
  vi.advanceTimersByTime(30_000);
  expect(realm.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("input entry preserves error response and finally closes its worker", async () => {
  const realm = workerRealm();
  const entry = await import("../src/global-alignment-input-worker");
  const core = await import("../src/global-alignment-input-core");
  expect(entry.executeGlobalAlignmentInputPreparation).toBe(
    core.executeGlobalAlignmentInputPreparation,
  );
  expect(globalThis.onmessage).not.toBe(realm.sentinel);
  expect(vi.getTimerCount()).toBe(1);
  workerScope().onmessage({
    data: { vertices: new Float32Array(), triangles: new Uint32Array() },
  } as MessageEvent);
  expect(realm.postMessage.mock.calls[0][0]).toEqual({
    error: expect.any(String),
  });
  expect(realm.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("transform entry preserves typed response transfer and its idle lease", async () => {
  const realm = workerRealm();
  const entry = await import("../src/datum-transform-worker");
  const core = await import("../src/datum-transform-core");
  expect(entry.executeDatumTransform).toBe(core.executeDatumTransform);
  expect(globalThis.onmessage).not.toBe(realm.sentinel);
  expect(vi.getTimerCount()).toBe(1);
  const input = Float32Array.of(1, 2, 3);
  workerScope().onmessage({
    data: {
      id: 9,
      input,
      vector: false,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    },
  } as MessageEvent);
  const [response, transfers] = realm.postMessage.mock.calls[0];
  expect(response.id).toBe(9);
  expect(response.output).toBeInstanceOf(Float32Array);
  expect(transfers).toEqual([response.output.buffer]);
  expect(Array.from(input)).toEqual([1, 2, 3]);
  vi.advanceTimersByTime(30_000);
  expect(realm.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

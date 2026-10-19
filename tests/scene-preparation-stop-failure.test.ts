import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  GlobalSceneInput,
  GlobalSceneResult,
} from "../src/scan-global-scene-core";
let cleanup: typeof import("../src/scan-global-worker-cleanup");

// Lifecycle-only transport fixture. No scene numerical result is asserted here.
const input = (): GlobalSceneInput => ({
  scans: ["a", "b"].map((id) => ({
    id,
    geometry: { points: new Float32Array(9), normals: new Float32Array(9) },
  })),
});
class StopFailureWorker {
  static instances: StopFailureWorker[] = [];
  onmessage: ((event: { data: { result: GlobalSceneResult } }) => void) | null =
    null;
  onerror: unknown;
  onmessageerror: unknown;
  fails = true;
  terminate = vi.fn(() => {
    if (this.fails) throw Error("scene fixture exact stop failed");
  });
  postMessage = vi.fn();
  constructor() {
    StopFailureWorker.instances.push(this);
  }
}
const pendingRuns: Promise<unknown>[] = [];
beforeEach(async () => {
  vi.resetModules();
  cleanup = await import("../src/scan-global-worker-cleanup");
  vi.useFakeTimers();
  vi.stubGlobal("Worker", StopFailureWorker);
  expect(cleanup.ownedWorkerCleanupPending()).toEqual([]);
});
afterEach(async () => {
  // Always release the exact fake handles, even when the RED assertion fails.
  for (const worker of StopFailureWorker.instances) {
    worker.fails = false;
    worker.terminate();
  }
  cleanup.retryOwnedWorkerStops();
  // Never await an implementation promise known to hang. Observers already handle rejection.
  pendingRuns.length = 0;
  StopFailureWorker.instances.length = 0;
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // The broken implementation's preparationActive remains true until module reset.
  vi.resetModules();
});

it.each(["result", "abort"] as const)(
  "settles and retains exact recovery ownership when scene stop throws on %s",
  async (path) => {
    // A fresh module isolates the known RED hang between the two cases.
    const { prepareGlobalScene: prepare } =
      await import("../src/scan-global-scene-client");
    const controller = new AbortController();
    let abortListener: EventListenerOrEventListenerObject | undefined;
    // Deliver the real client's abort callback synchronously so its thrown stop error
    // is captured as evidence, rather than becoming a host uncaught-event exception.
    vi.spyOn(controller.signal, "addEventListener").mockImplementation(
      (type, listener) => {
        if (type === "abort") abortListener = listener ?? undefined;
      },
    );
    const removeAbortListener = vi.spyOn(
      controller.signal,
      "removeEventListener",
    );
    const run = prepare(input(), controller.signal);
    pendingRuns.push(run);
    let outcome: "pending" | "resolved" | "rejected" = "pending";
    let rejection: unknown;
    void run.then(
      () => {
        outcome = "resolved";
      },
      (error) => {
        outcome = "rejected";
        rejection = error;
      },
    );
    expect(StopFailureWorker.instances).toHaveLength(1);
    const worker = StopFailureWorker.instances[0];
    let escapedStopError: unknown;
    try {
      if (path === "result") {
        // Exact scene-client admission at this boundary checks only source cardinality.
        // This intentionally synthetic envelope exercises cleanup, never fitter/math behavior.
        const result = {
          sources: [{ id: "a" }, { id: "b" }],
        } as unknown as GlobalSceneResult;
        worker.onmessage?.({ data: { result } });
      } else {
        controller.abort(new DOMException("fixture cancelled", "AbortError"));
        expect(abortListener).toBeDefined();
        if (typeof abortListener === "function")
          abortListener.call(controller.signal, new Event("abort"));
        else abortListener!.handleEvent(new Event("abort"));
      }
    } catch (error) {
      escapedStopError = error;
    }
    // Finite logical wait: an implementation hang cannot stall the test runner.
    await vi.advanceTimersByTimeAsync(50);
    expect(
      outcome,
      "termination failure must settle preparation before its timeout is cleared",
    ).not.toBe("pending");
    expect(
      escapedStopError,
      "cleanup failure must reject through the promise, not escape delivery",
    ).toBeUndefined();
    expect(outcome).toBe("rejected");
    if (path === "abort")
      expect(rejection).toMatchObject({ name: "AbortError" });
    expect(removeAbortListener).toHaveBeenCalledWith("abort", abortListener);
    expect(removeAbortListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount(), "failed preparation must leave no timer").toBe(
      0,
    );
    const recovery = cleanup.ownedWorkerCleanupPending();
    expect(recovery).toHaveLength(1);
    expect(recovery[0]).toMatchObject({
      retained: true,
      status: "termination-unconfirmed",
    });
    const countBefore = StopFailureWorker.instances.length;
    await expect(prepare(input())).rejects.toThrow(
      "Unresolved exact worker cleanup",
    );
    expect(StopFailureWorker.instances).toHaveLength(countBefore);
    worker.fails = false;
    cleanup.retryOwnedWorkerStops();
    expect(cleanup.ownedWorkerCleanupPending()).toEqual([]);
    expect(vi.getTimerCount(), "exact stop recovery must leave no timer").toBe(
      0,
    );
    // Exercise the preparationActive gate after recovery, rather than only the registry.
    const freshInput = input();
    const fresh = prepare(freshInput);
    pendingRuns.push(fresh);
    let freshOutcome: "pending" | "resolved" | "rejected" = "pending";
    let freshResult: GlobalSceneResult | undefined;
    void fresh.then(
      (value) => {
        freshOutcome = "resolved";
        freshResult = value;
      },
      () => {
        freshOutcome = "rejected";
      },
    );
    expect(StopFailureWorker.instances).toHaveLength(countBefore + 1);
    const recoveredWorker = StopFailureWorker.instances[countBefore];
    recoveredWorker.fails = false;
    expect(recoveredWorker.postMessage).toHaveBeenCalledWith(freshInput);
    const recoveredResult = {
      sources: [{ id: "a" }, { id: "b" }],
    } as unknown as GlobalSceneResult;
    recoveredWorker.onmessage?.({ data: { result: recoveredResult } });
    await vi.advanceTimersByTimeAsync(50);
    expect(
      freshOutcome,
      "preparationActive must reset after stop failure",
    ).toBe("resolved");
    expect(freshResult).toBe(recoveredResult);
    expect(recoveredWorker.terminate).toHaveBeenCalledTimes(1);
    expect(recoveredWorker.onmessage).toBeNull();
    expect(recoveredWorker.onerror).toBeNull();
    expect(recoveredWorker.onmessageerror).toBeNull();
    expect(cleanup.ownedWorkerCleanupPending()).toEqual([]);
    expect(
      vi.getTimerCount(),
      "successful recovery preparation must leave no timer",
    ).toBe(0);
  },
  2_000,
);

it.each(["error", "messageerror", "post", "timeout"] as const)(
  "preserves primary failure and admits recovery after scene stop throws on %s",
  async (path) => {
    const primary = Error("scene fixture postMessage failed");
    if (path === "post") {
      class PostFailureWorker extends StopFailureWorker {
        constructor() {
          super();
          this.postMessage.mockImplementation(() => {
            throw primary;
          });
        }
      }
      vi.stubGlobal("Worker", PostFailureWorker);
    }
    const { prepareGlobalScene: prepare } =
      await import("../src/scan-global-scene-client");
    const run = prepare(input());
    pendingRuns.push(run);
    const observed = run.then(
      () => ({ error: undefined }),
      (error: unknown) => ({ error }),
    );
    const worker = StopFailureWorker.instances[0];
    if (path === "error")
      (worker.onerror as (event: { message: string }) => void)({
        message: "scene fixture worker failed",
      });
    else if (path === "messageerror") (worker.onmessageerror as () => void)();
    await vi.advanceTimersByTimeAsync(path === "timeout" ? 120_000 : 0);
    const { error } = await observed;
    if (path === "post") expect(error).toBe(primary);
    else
      expect(error).toMatchObject({
        message:
          path === "error"
            ? "scene fixture worker failed"
            : path === "messageerror"
              ? "Global scene preparation response could not be decoded."
              : "Global scene preparation timed out.",
      });
    expect(cleanup.ownedWorkerCleanupPending()).toHaveLength(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    worker.fails = false;
    cleanup.retryOwnedWorkerStops();
    expect(cleanup.ownedWorkerCleanupPending()).toEqual([]);
    vi.stubGlobal("Worker", StopFailureWorker);
    const fresh = prepare(input());
    pendingRuns.push(fresh);
    const recoveredWorker = StopFailureWorker.instances[1];
    recoveredWorker.fails = false;
    const result = {
      sources: [{ id: "a" }, { id: "b" }],
    } as unknown as GlobalSceneResult;
    recoveredWorker.onmessage?.({ data: { result } });
    await expect(fresh).resolves.toBe(result);
    expect(recoveredWorker.terminate).toHaveBeenCalledTimes(1);
    expect(cleanup.ownedWorkerCleanupPending()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  },
  2_000,
);

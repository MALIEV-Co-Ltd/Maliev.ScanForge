import { afterEach, expect, it, vi } from "vitest";
import { createPreparedGlobalQueryPool } from "../src/scan-global-scene-client";
import {
  ownedWorkerCleanupPending,
  requestOwnedWorkerStop,
  retryOwnedWorkerStops,
} from "../src/scan-global-worker-cleanup";
const old = {
  fails: true,
  attempts: 0,
  onmessage: null,
  onerror: null,
  onmessageerror: null,
  terminate() {
    this.attempts++;
    if (this.fails) throw Error("transient exact stop failure");
  },
};
class PreparationWorker {
  static instances: PreparationWorker[] = [];
  onmessage: null | ((event: { data: { error: string } }) => void) = null;
  onerror: unknown;
  onmessageerror: unknown;
  terminate = vi.fn();
  constructor() {
    PreparationWorker.instances.push(this);
  }
  postMessage() {
    queueMicrotask(() =>
      this.onmessage?.({ data: { error: "fixture reached scene worker" } }),
    );
  }
}
afterEach(() => {
  old.fails = false;
  retryOwnedWorkerStops();
  PreparationWorker.instances.length = 0;
  old.attempts = 0;
  vi.unstubAllGlobals();
});
it("direct prepared-pool entry guards exact cleanup before scene admission/allocation and can recover on rerun", async () => {
  vi.stubGlobal("Worker", PreparationWorker);
  old.fails = true;
  const now = Date.now();
  requestOwnedWorkerStop(old as unknown as Worker, {
    owner: "controller:9010",
    runId: 9010,
    target: "scan-global-controller-worker.ts",
    createdUnixMs: now,
    expiresUnixMs: now + 900000,
  });
  const input = {
    scans: ["a", "b"].map((id) => ({
      id,
      geometry: { points: new Float32Array(9), normals: new Float32Array(9) },
    })),
  };
  await expect(createPreparedGlobalQueryPool(input)).rejects.toThrow(
    "Unresolved exact worker cleanup",
  );
  expect(old.attempts).toBe(6);
  expect(PreparationWorker.instances).toHaveLength(0);
  expect(ownedWorkerCleanupPending()).toHaveLength(1);
  old.fails = false;
  await expect(createPreparedGlobalQueryPool(input)).rejects.toThrow(
    "fixture reached scene worker",
  );
  expect(old.attempts).toBe(7);
  expect(ownedWorkerCleanupPending()).toEqual([]);
  expect(PreparationWorker.instances).toHaveLength(1);
  expect(PreparationWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
});

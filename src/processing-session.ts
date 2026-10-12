import type { Positions } from "./types";

// One geometry-scoped worker, never a background pool. Its topology expires
// after one minute idle, on geometry replacement, cancellation or page exit.
let retained:
  | {
      worker: Worker;
      positions: Positions;
      key: number;
      active: boolean;
      timer?: ReturnType<typeof setTimeout>;
    }
  | undefined;
let nextKey = 0;
export function releaseProcessingSession() {
  if (!retained || retained.active) return;
  clearTimeout(retained.timer);
  retained.worker.terminate();
  retained = undefined;
}
export function acquireProcessingSession(
  positions: Positions,
  create: () => Worker,
) {
  if (retained?.active) return undefined; // Concurrent diagnostics stay isolated.
  if (retained && retained.positions !== positions) releaseProcessingSession();
  retained ??= { worker: create(), positions, key: ++nextKey, active: false };
  const entry = retained;
  clearTimeout(entry.timer);
  entry.active = true;
  return {
    worker: entry.worker,
    key: entry.key,
    release(usable: boolean) {
      entry.active = false;
      entry.worker.onmessage = null;
      entry.worker.onerror = null;
      entry.worker.onmessageerror = null;
      if (!usable) releaseProcessingSession();
      else entry.timer = setTimeout(releaseProcessingSession, 60_000);
    },
  };
}
globalThis.addEventListener?.("pagehide", releaseProcessingSession);

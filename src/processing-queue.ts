import type { Positions } from "./types";

interface Turn {
  start(): void;
  running: boolean;
}
let pendingTurns = 0;
export function hasProcessingWork(): boolean {
  return pendingTurns > 0;
}
const queues = new WeakMap<Positions, Turn[]>();
const watchers = new WeakMap<Positions, Set<() => void>>();
export function hasQueuedProcessing(positions: Positions): boolean {
  return (queues.get(positions)?.length ?? 0) > 1;
}
/** Stop a temporary analysis lease once no successor still needs its index. */
export function watchQueuedProcessing(
  positions: Positions,
  update: () => void,
) {
  const listeners = watchers.get(positions) ?? new Set();
  watchers.set(positions, listeners);
  listeners.add(update);
  return () => {
    listeners.delete(update);
    if (!listeners.size) watchers.delete(positions);
  };
}
function notify(positions: Positions) {
  for (const listener of watchers.get(positions) ?? []) listener();
}

/** Serialize one immutable source so its next tool can reuse the same worker index. */
export function queueProcessing<T>(
  positions: Positions,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (signal?.aborted)
    return Promise.reject(
      new DOMException("Processing cancelled.", "AbortError"),
    );
  return new Promise<T>((resolve, reject) => {
    const queue = queues.get(positions) ?? [];
    queues.set(positions, queue);
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      globalThis.removeEventListener?.("pagehide", abort);
      queue.shift();
      pendingTurns--;
      notify(positions);
      if (queue.length) queue[0].start();
      else queues.delete(positions);
    };
    const abort = () => {
      if (turn.running) return; // The active worker owns its cancellation.
      queue.splice(queue.indexOf(turn), 1);
      pendingTurns--;
      notify(positions);
      signal?.removeEventListener("abort", abort);
      globalThis.removeEventListener?.("pagehide", abort);
      reject(new DOMException("Processing cancelled.", "AbortError"));
    };
    const turn: Turn = {
      running: false,
      start() {
        turn.running = true;
        let pending: Promise<T>;
        try {
          pending = run();
        } catch (error) {
          finish();
          reject(error);
          return;
        }
        pending.then(
          (result) => {
            finish();
            resolve(result);
          },
          (error) => {
            finish();
            reject(error);
          },
        );
      },
    };
    queue.push(turn);
    pendingTurns++;
    signal?.addEventListener("abort", abort, { once: true });
    globalThis.addEventListener?.("pagehide", abort, { once: true });
    if (queue.length === 1) turn.start();
  });
}

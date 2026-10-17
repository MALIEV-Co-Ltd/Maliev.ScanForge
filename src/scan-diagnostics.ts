import type { Positions } from "./types";
import { hasQueuedProcessing, watchQueuedProcessing } from "./processing-queue";
import { SCAN_TOPOLOGY_TOLERANCE } from "./scan-topology-tolerance";
import { registerSpeculativePreparation } from "./speculative-mesh-preparation";
import {
  cachedTopologySummary,
  cacheTopologySummary,
} from "./scan-topology-summary";
import {
  processMesh,
  type ProcessingOptions,
  type ProcessingRequest,
  type ProcessingResult,
  type TopologySummary,
} from "./processing-client";

export type ScanDiagnostics =
  | { phase: "pending"; progress: string }
  | { phase: "ready"; topology: TopologySummary }
  | { phase: "error"; message: string };
const pending = new WeakMap<
  Positions,
  {
    controller: AbortController;
    listeners: Set<(state: ScanDiagnostics) => void>;
    state: ScanDiagnostics;
    stopWatching?: () => void;
    stopSpeculation?: () => void;
  }
>();

const watchers = new WeakMap<
  Positions,
  Set<(state: ScanDiagnostics | undefined) => void>
>();
function notifyWatchers(positions: Positions, state?: ScanDiagnostics) {
  for (const listener of watchers.get(positions) ?? []) listener(state);
}
/** Observe preparation without starting work or owning its cancellation. */
export function watchScanDiagnostics(
  positions: Positions,
  update: (state: ScanDiagnostics | undefined) => void,
) {
  const listeners = watchers.get(positions) ?? new Set();
  watchers.set(positions, listeners);
  listeners.add(update);
  const cached = cachedTopologySummary(positions, SCAN_TOPOLOGY_TOLERANCE);
  update(
    pending.get(positions)?.state ??
      (cached ? { phase: "ready", topology: cached } : undefined),
  );
  return () => {
    listeners.delete(update);
    if (!listeners.size) watchers.delete(positions);
  };
}

/** Geometry identity invalidates counts; cancellation releases the owned worker. */
export function observeScanDiagnostics(
  positions: Positions,
  update: (state: ScanDiagnostics) => void,
  run: (
    request: ProcessingRequest,
    options: ProcessingOptions,
  ) => Promise<ProcessingResult> = processMesh,
  options: {
    prepareTopology?: boolean;
    speculative?: boolean;
    onYield?: () => void;
  } = {},
): () => void {
  const listener = (state: ScanDiagnostics) => update(state);
  const cached = cachedTopologySummary(positions, SCAN_TOPOLOGY_TOLERANCE);
  const existing = pending.get(positions);
  if (cached && !existing && !options.prepareTopology) {
    update({ phase: "ready", topology: cached });
    return () => {};
  }
  if (existing) {
    if (!options.speculative) {
      existing.stopSpeculation?.();
      existing.stopSpeculation = undefined;
    }
    existing.stopWatching?.();
    existing.stopWatching = undefined;
    existing.listeners.add(listener);
    update(existing.state);
    return () => unsubscribe(existing);
  }
  function unsubscribe(entry: NonNullable<ReturnType<typeof pending.get>>) {
    entry.listeners.delete(listener);
    // React removes the old panel before mounting its replacement. Give that
    // same transition one microtask to queue a topology consumer, without
    // retaining an abandoned background analysis or restarting its worker.
    queueMicrotask(() => {
      if (entry.listeners.size || pending.get(positions) !== entry) return;
      const releaseIfUnused = () => {
        if (!hasQueuedProcessing(positions)) {
          entry.stopWatching?.();
          entry.stopSpeculation?.();
          entry.stopWatching = undefined;
          if (pending.get(positions) === entry) pending.delete(positions);
          entry.controller.abort();
          notifyWatchers(positions);
        }
      };
      entry.stopWatching ??= watchQueuedProcessing(positions, releaseIfUnused);
      releaseIfUnused();
    });
  }
  const controller = new AbortController();
  const entry: NonNullable<ReturnType<typeof pending.get>> = {
    controller,
    listeners: new Set([listener]),
    state: {
      phase: "pending",
      progress: "Calculating mesh topology…",
    } as ScanDiagnostics,
  };
  pending.set(positions, entry);
  if (options.speculative)
    entry.stopSpeculation = registerSpeculativePreparation(positions, () => {
      if (pending.get(positions) === entry) pending.delete(positions);
      entry.stopWatching?.();
      controller.abort();
      options.onYield?.();
      notifyWatchers(positions);
    });
  const publish = (state: ScanDiagnostics) => {
    entry.state = state;
    for (const listener of entry.listeners) listener(state);
    notifyWatchers(positions, state);
  };
  publish(entry.state);
  void run(
    { kind: "report", positions, tolerance: SCAN_TOPOLOGY_TOLERANCE },
    {
      signal: controller.signal,
      reuseTopology: true,
      onProgress: (fraction, stage) => {
        if (!controller.signal.aborted)
          publish({
            phase: "pending",
            progress: `${stage} · ${Math.round(fraction * 100)}%`,
          });
      },
    },
  )
    .then((result) => {
      if (controller.signal.aborted) return;
      if (!result.topology)
        throw new Error("Mesh diagnostics returned no topology.");
      cacheTopologySummary(positions, SCAN_TOPOLOGY_TOLERANCE, result.topology);
      entry.stopWatching?.();
      entry.stopSpeculation?.();
      pending.delete(positions);
      publish({ phase: "ready", topology: result.topology });
    })
    .catch((error) => {
      entry.stopWatching?.();
      entry.stopSpeculation?.();
      if (!controller.signal.aborted)
        publish({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      if (pending.get(positions) === entry) pending.delete(positions);
    });
  return () => unsubscribe(entry);
}

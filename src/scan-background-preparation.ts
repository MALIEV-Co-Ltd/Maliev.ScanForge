import type { Positions } from "./types";
import {
  observeScanDiagnostics,
  type ScanDiagnostics,
} from "./scan-diagnostics";
import { hasProcessingWork } from "./processing-queue";
import { yieldSpeculativePreparation } from "./speculative-mesh-preparation";
import { SCAN_DEFAULT_BUDGET_BYTES } from "./scan-geometry-source";
// Optional warmup reservation policy, not an engine/process memory upper bound.
const WARMUP_BYTES_PER_FACET = 512;
type State = ScanDiagnostics | { phase: "scheduled" } | { phase: "inactive" };
interface Entry {
  positions: Positions;
  state: State;
  stopped: boolean;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
  idle?: number;
  leave?: () => void;
}
let active: Entry | undefined;
let priorityPreparations = 0;
const priorityListeners = new Set<() => void>();
export function hasPriorityScanPreparation(): boolean {
  return priorityPreparations > 0;
}
export function watchPriorityScanPreparation(listener: () => void): () => void {
  priorityListeners.add(listener);
  return () => {
    priorityListeners.delete(listener);
  };
}

/** Imports and picking take priority over preparation without a foreground owner. */
export function beginPriorityScanPreparation(): () => void {
  priorityPreparations++;
  for (const listener of priorityListeners) listener();
  if (active) yieldSpeculativePreparation(active.positions);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    priorityPreparations--;
    for (const listener of priorityListeners) listener();
  };
}
export function priorityScanPreparationCount(): number {
  return priorityPreparations;
}
export function backgroundMeshPreparation(positions: Positions): State {
  return active?.positions === positions
    ? { ...active.state }
    : { phase: "inactive" };
}
function stop(entry: Entry) {
  if (entry.stopped) return;
  entry.stopped = true;
  clearTimeout(entry.timer);
  if (entry.idle !== undefined) globalThis.cancelIdleCallback?.(entry.idle);
  entry.leave?.();
  if (active === entry) active = undefined;
}
export function stopBackgroundMeshPreparation() {
  if (active) stop(active);
}
/** One selected source, after paint/idle, never a competing foreground job.
 * Compact cached counts do not prove the worker still owns its full index. */
export function prepareMeshInBackground(
  positions: Positions | undefined,
  options: {
    canStart?: () => boolean;
    observe?: typeof observeScanDiagnostics;
  } = {},
) {
  stopBackgroundMeshPreparation();
  if (!positions?.length || positions.length % 9) return () => {};
  if (
    (positions.length / 9) * WARMUP_BYTES_PER_FACET >
    SCAN_DEFAULT_BUDGET_BYTES
  )
    return () => {};
  const entry: Entry = {
    positions,
    state: { phase: "scheduled" },
    stopped: false,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  active = entry;
  const allowed = () =>
    !priorityPreparations &&
    !hasProcessingWork() &&
    (options.canStart?.() ?? true);
  const begin = () => {
    entry.idle = undefined;
    if (entry.stopped) return;
    if (!allowed()) {
      entry.timer = setTimeout(schedule, 250);
      return;
    }
    entry.leave = (options.observe ?? observeScanDiagnostics)(
      positions,
      (state) => {
        if (!entry.stopped) entry.state = state;
      },
      undefined,
      {
        prepareTopology: true,
        speculative: true,
        onYield: () => {
          if (!priorityPreparations) {
            stop(entry);
            return;
          }
          entry.leave?.();
          entry.leave = undefined;
          entry.state = { phase: "scheduled" };
          entry.timer = setTimeout(schedule, 250);
        },
      },
    );
  };
  const schedule = () => {
    if (entry.stopped) return;
    if (Date.now() >= entry.expiresAt) {
      entry.state = {
        phase: "error",
        message:
          "Background preparation was postponed. Calculate mesh information to retry.",
      };
      return;
    }
    if (!allowed()) {
      entry.timer = setTimeout(schedule, 250);
      return;
    }
    if (globalThis.requestIdleCallback)
      entry.idle = globalThis.requestIdleCallback(begin, { timeout: 1000 });
    else begin();
  };
  entry.timer = setTimeout(schedule, 250);
  return () => stop(entry);
}
globalThis.addEventListener?.("pagehide", stopBackgroundMeshPreparation);

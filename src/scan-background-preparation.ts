import type { Positions } from "./types";
import {
  observeScanDiagnostics,
  type ScanDiagnostics,
} from "./scan-diagnostics";
import { hasProcessingWork } from "./processing-queue";
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
  const entry: Entry = {
    positions,
    state: { phase: "scheduled" },
    stopped: false,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  active = entry;
  const allowed = () => !hasProcessingWork() && (options.canStart?.() ?? true);
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
        onYield: () => stop(entry),
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

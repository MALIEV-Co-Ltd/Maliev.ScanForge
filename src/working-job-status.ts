import type { HoleFillProgress } from "./hole-fill-progress";
const jobs = new Map<symbol, { message: string; details?: HoleFillProgress }>();
const listeners = new Set<() => void>();
let snapshot = "";
let progressDetails: HoleFillProgress | undefined;
export const getWorkingJobStatus = () => snapshot;
export const getWorkingJobProgress = () => progressDetails;
export function watchWorkingJobStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish() {
  const next = [...jobs.values()].at(-1);
  if ((next?.message ?? "") === snapshot && next?.details === progressDetails)
    return;
  snapshot = next?.message ?? "";
  progressDetails = next?.details;
  for (const listener of listeners) listener();
}
/** Presentation-only lease; completion/error/cancellation all remove its status. */
export function beginWorkingJob(label: string) {
  const id = Symbol();
  jobs.set(id, { message: `${label}…` });
  publish();
  return {
    progress(fraction: number, stage: string, details?: HoleFillProgress) {
      if (!jobs.has(id)) return;
      const percent = Number.isFinite(fraction)
        ? ` · ${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`
        : "";
      jobs.set(id, { message: `${stage}${percent}`, details });
      publish();
    },
    finish() {
      jobs.delete(id);
      publish();
    },
  };
}

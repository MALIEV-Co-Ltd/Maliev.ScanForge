const jobs = new Map<symbol, string>();
const listeners = new Set<() => void>();
let snapshot = "";
export const getWorkingJobStatus = () => snapshot;
export function watchWorkingJobStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish() {
  const next = [...jobs.values()].at(-1) ?? "";
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}
/** Presentation-only lease; completion/error/cancellation all remove its status. */
export function beginWorkingJob(label: string) {
  const id = Symbol();
  jobs.set(id, `${label}…`);
  publish();
  return {
    progress(fraction: number, stage: string) {
      if (!jobs.has(id)) return;
      const percent = Number.isFinite(fraction)
        ? ` · ${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`
        : "";
      jobs.set(id, `${stage}${percent}`);
      publish();
    },
    finish() {
      jobs.delete(id);
      publish();
    },
  };
}

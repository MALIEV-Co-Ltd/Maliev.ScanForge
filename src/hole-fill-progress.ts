/** Shared worker, GUI and MCP batch progress; counts include unchanged holes. */
export type HoleFillProgress = {
  kind: "holeFill";
  phase: "closing" | "finalizing" | "complete";
  processed: number;
  total: number;
  closed: number;
  skipped: number;
};

const count = (value: number) => value.toLocaleString("en-US");
export const holeFillCounts = (progress: HoleFillProgress) =>
  `${count(progress.processed)} / ${count(progress.total)} processed`;
export const holeFillOutcomes = (
  progress: Pick<HoleFillProgress, "closed" | "skipped">,
) => `${count(progress.closed)} closed · ${count(progress.skipped)} skipped`;
export const holeFillTitle = (progress: HoleFillProgress) =>
  progress.phase === "closing"
    ? "Closing holes"
    : progress.phase === "finalizing"
      ? "Finalizing mesh…"
      : "Hole filling complete";

/** Coalesce internal solver stages; phase transitions are always immediate. */
export function createHoleFillReporter(
  publish: (
    fraction: number,
    stage: string,
    details?: HoleFillProgress,
  ) => void,
  now: () => number = () => performance.now(),
) {
  let lastPublished = -Infinity;
  let lastPhase: HoleFillProgress["phase"] | undefined;
  return (_fraction: number, _stage: string, details?: HoleFillProgress) => {
    const time = now();
    if (time - lastPublished < 200 && details?.phase === lastPhase) return;
    lastPublished = time;
    lastPhase = details?.phase;
    if (details)
      publish(
        details.processed / Math.max(1, details.total),
        holeFillTitle(details),
        details,
      );
    else publish(0, "Preparing holes…");
  };
}

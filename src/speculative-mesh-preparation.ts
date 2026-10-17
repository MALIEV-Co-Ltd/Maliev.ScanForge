import type { Positions } from "./types";
import { hasQueuedProcessing } from "./processing-queue";

const speculative = new WeakMap<Positions, () => void>();

/** Register only preparation without a foreground diagnostics owner. */
export function registerSpeculativePreparation(
  positions: Positions,
  cancel: () => void,
) {
  speculative.set(positions, cancel);
  return () => {
    if (speculative.get(positions) === cancel) speculative.delete(positions);
  };
}

/** Preserve preparation already promised to a queued topology consumer. */
export function yieldSpeculativePreparation(positions: Positions) {
  if (hasQueuedProcessing(positions)) return;
  const cancel = speculative.get(positions);
  speculative.delete(positions);
  cancel?.();
}

export type SelectionProcessingMode = "boundary" | "smoothing";

/** Shared GUI/API ripple preset for every operation; the historical name is retained. */
export function selectionProcessingMode(
  _operation: unknown,
): SelectionProcessingMode {
  return "smoothing";
}

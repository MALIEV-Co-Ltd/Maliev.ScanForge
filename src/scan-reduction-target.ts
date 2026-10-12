/** Native percentage arithmetic truncates the positive result, not rounds up. */
export function reductionPercentageTarget(count: number, percentage: number) {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new RangeError("Triangle count must be a positive safe integer.");
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100)
    throw new RangeError(
      "Retained percentage must be positive and at most 100.",
    );
  // Preserve the application's nonempty-output policy for sub-triangle targets.
  // Fractional percentages are an existing API extension to the native integer input.
  return Math.max(1, Math.trunc((count * percentage) / 100));
}

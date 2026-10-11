/** Reapply the latest wand region against its pre-click selection.
 * Keeping that baseline allows a sensitivity decrease to undo only this region.
 */
export function applyWandRegion(
  baseline: Uint8Array,
  region: Uint8Array,
  subtract: boolean,
  hidden: readonly number[] = [],
): Uint8Array {
  if (baseline.length !== region.length)
    throw new Error("Wand region does not match the selection.");
  const hiddenSet = new Set(hidden);
  return Uint8Array.from(baseline, (value, index) =>
    hiddenSet.has(index) ? 0 : region[index] ? (subtract ? 0 : 1) : value,
  );
}

/** Original N-point initializer's scalar sampling stride. */
export function nativeAlignmentCandidateStride(count: number): number {
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffffffff)
    throw new Error(
      "Alignment point count must be an unsigned 32-bit integer.",
    );
  return Math.max(1, Math.floor(count / 1000));
}

/** Candidate order recovered from the initializer's control flow.
 * This enumerates triplets only; it does not score or refine candidates.
 */
export function nativeAlignmentCandidateTriplets(
  count: number,
): [number, number, number][] {
  const stride = nativeAlignmentCandidateStride(count);
  // Keep the native 32-bit loop counter away from overflow. This port boundary
  // is independently authored; it does not claim native overflow behavior.
  if (count > 0x7fffffff)
    throw new Error("Alignment point count exceeds the safe candidate range.");
  if (count < 3) return [];
  const midpoint = Math.floor(count / 2);
  const candidates: [number, number, number][] = [];
  for (let third = 0; third < count; third += stride)
    if (third !== 0 && third !== midpoint)
      candidates.push([0, midpoint, third]);
  return candidates;
}

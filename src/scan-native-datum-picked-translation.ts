/** Convert a resolved world-space pick into the original source-frame offsets.
 * With no valid source frame, the original callback retains world coordinates.
 */
export function nativeDatumTranslationFromPoint(
  frame: readonly number[] | undefined,
  point: readonly number[],
): number[] {
  if (
    point.length !== 3 ||
    !point.every(Number.isFinite) ||
    (frame && (frame.length !== 12 || !frame.every(Number.isFinite)))
  )
    throw new Error(
      "Picked translation requires a finite point and source frame.",
    );
  if (Math.fround(point[0]) === 3.4028234663852886e38)
    throw new Error("Picked point is the native unresolved-point sentinel.");
  if (!frame) return [...point];
  const x = point[0] - frame[3],
    y = point[1] - frame[7],
    z = point[2] - frame[11];
  const result = [
    frame[4] * y + frame[0] * x + frame[8] * z,
    frame[5] * y + frame[1] * x + frame[9] * z,
    frame[6] * y + frame[2] * x + frame[10] * z,
  ];
  if (!result.every(Number.isFinite))
    throw new Error("Picked translation overflowed.");
  return result;
}

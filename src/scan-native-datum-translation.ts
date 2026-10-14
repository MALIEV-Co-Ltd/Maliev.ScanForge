/** Original frame-basis translation callback, with numerical evaluation order retained. */
export function nativeDatumTranslation(
  input: readonly number[],
  offsets: readonly number[],
): number[] {
  if (
    input.length !== 12 ||
    offsets.length !== 3 ||
    !input.every(Number.isFinite) ||
    !offsets.every(Number.isFinite)
  )
    throw new Error(
      "Frame translation requires a finite 3x4 matrix and three offsets in mm.",
    );
  const frame = [...input];
  const [x, y, z] = offsets;
  frame[3] = y * input[1] + x * input[0] + z * input[2] + input[3];
  frame[7] = x * input[4] + y * input[5] + z * input[6] + input[7];
  frame[11] = x * input[8] + y * input[9] + z * input[10] + input[11];
  if (!frame.every(Number.isFinite))
    throw new Error("Frame translation overflowed.");
  return frame;
}

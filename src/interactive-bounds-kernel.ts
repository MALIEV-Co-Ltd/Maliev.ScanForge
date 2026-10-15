import { nativeDatumIsIdentity } from "./scan-native-datum-apply";
export const INTERACTIVE_BOUNDS_LIMIT = 3.4028234663852886e38;
export function interactiveBoundsRanges(count: number): [number, number][] {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("Bounds require a nonnegative point count.");
  const stride = count > 15 ? Math.floor(count / 8) : 1;
  return Array.from({ length: 8 }, (_, i) => [
    Math.min(i * stride, count),
    i === 7 ? count : Math.min((i + 1) * stride, count),
  ]);
}
export function emptyInteractiveBounds() {
  return Float32Array.from([
    INTERACTIVE_BOUNDS_LIMIT,
    INTERACTIVE_BOUNDS_LIMIT,
    INTERACTIVE_BOUNDS_LIMIT,
    -INTERACTIVE_BOUNDS_LIMIT,
    -INTERACTIVE_BOUNDS_LIMIT,
    -INTERACTIVE_BOUNDS_LIMIT,
  ]);
}
export function validInteractiveBounds(b: ArrayLike<number>) {
  return (
    b.length === 6 &&
    [0, 1, 2].every(
      (i) =>
        b[i] <= b[i + 3] &&
        b[i] > -INTERACTIVE_BOUNDS_LIMIT &&
        b[i + 3] < INTERACTIVE_BOUNDS_LIMIT,
    )
  );
}
/** Original B2D870/B2DBE0 lane arithmetic: first equal value wins within a lane. */
export function interactiveBoundsLane(
  points: Float32Array,
  matrix: readonly number[],
  start: number,
  end: number,
  flags?: Uint32Array,
): Float32Array {
  if (
    points.length % 3 ||
    matrix.length !== 12 ||
    !matrix.every(Number.isFinite) ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > end ||
    end > points.length / 3 ||
    (flags && flags.length !== points.length / 3)
  )
    throw new Error(
      "Bounds require finite frames, XYZ points, valid ranges and matching flags.",
    );
  const output = emptyInteractiveBounds(),
    identity = nativeDatumIsIdentity(matrix);
  for (let i = start; i < end; i++) {
    if (flags && flags[i] & 9) continue;
    const x = points[i * 3],
      y = points[i * 3 + 1],
      z = points[i * 3 + 2];
    const values = identity
      ? [x, y, z]
      : [
          Math.fround(
            y * matrix[1] + x * matrix[0] + z * matrix[2] + matrix[3],
          ),
          Math.fround(
            x * matrix[4] + y * matrix[5] + z * matrix[6] + matrix[7],
          ),
          Math.fround(
            x * matrix[8] + y * matrix[9] + z * matrix[10] + matrix[11],
          ),
        ];
    for (let a = 0; a < 3; a++) {
      if (values[a] < output[a]) output[a] = values[a];
      if (output[a + 3] < values[a]) output[a + 3] = values[a];
    }
  }
  return output;
}
/** Original B30100 reduction: the later equal lane wins, preserving signed zero. */
export function reduceInteractiveBounds(lanes: readonly Float32Array[]) {
  const values = emptyInteractiveBounds();
  for (const lane of lanes) {
    if (!validInteractiveBounds(lane)) continue;
    for (let a = 0; a < 3; a++) {
      if (lane[a] <= values[a]) values[a] = lane[a];
      if (values[a + 3] <= lane[a + 3]) values[a + 3] = lane[a + 3];
    }
  }
  return { values, valid: validInteractiveBounds(values) };
}
export function measureInteractiveBounds(
  points: Float32Array,
  matrix: readonly number[],
  flags?: Uint32Array,
) {
  return reduceInteractiveBounds(
    interactiveBoundsRanges(points.length / 3).map(([start, end]) =>
      interactiveBoundsLane(points, matrix, start, end, flags),
    ),
  );
}

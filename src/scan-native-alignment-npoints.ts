import type { Vec3 } from "./types";
import { nativeAlignmentCandidateTriplets } from "./scan-native-alignment-candidates";
import { nativeAlignmentTriplet } from "./scan-native-alignment-initializer";
import { nativeAlignmentRms } from "./scan-native-alignment";
import { nativeRefineAlignmentMatrix } from "./scan-native-alignment-refinement";

/** Original N-point initializer, before the outer registration's candidate comparison. */
export function nativeInitializeAlignmentPoints(
  source: readonly Vec3[],
  target: readonly Vec3[],
  options: { signal?: AbortSignal } = {},
): number[] {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Alignment cancelled.", "AbortError");
  };
  check();
  if (source.length !== target.length)
    throw new Error("Alignment initialization requires paired points.");
  const points = (input: readonly Vec3[]): Vec3[] =>
    input.map((point) => {
      check();
      if (point.length !== 3 || !point.every(Number.isFinite))
        throw new Error("Alignment points must be finite XYZ coordinates.");
      const rounded = point.map(Math.fround) as Vec3;
      if (!rounded.every(Number.isFinite))
        throw new Error("Alignment points exceed Float32 precision.");
      return rounded;
    });
  const moving = points(source),
    fixed = points(target);
  let best = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  if (moving.length < 3) return best;
  let bestError = Math.fround(3.4028234663852886e38);
  for (const ids of nativeAlignmentCandidateTriplets(moving.length)) {
    check();
    let matrix = nativeAlignmentTriplet(
      ids.map((id) => moving[id]),
      ids.map((id) => fixed[id]),
    );
    if (!matrix) continue;
    let error: number;
    if (moving.length < 100) {
      const refined = nativeRefineAlignmentMatrix(matrix, moving, fixed, {
        tolerance: 0.001,
        budget: 100,
        measureRms: true,
        signal: options.signal,
      });
      matrix = refined.matrix;
      error = refined.rms!;
    } else error = Math.fround(nativeAlignmentRms(matrix, moving, fixed));
    if (error < bestError) {
      best = matrix;
      bestError = error;
    }
  }
  check();
  return nativeRefineAlignmentMatrix(best, moving, fixed, {
    tolerance: 0.0001,
    budget: 1000,
    signal: options.signal,
  }).matrix;
}

import type { Vec3 } from "./types";
import { inverseMirrorFrame } from "./scan-mirror-frame";
import { nativeAlignmentSquaredError } from "./scan-native-alignment";
import { nativeInitializeAlignmentPoints } from "./scan-native-alignment-npoints";
import { nativeRefineAlignmentMatrix } from "./scan-native-alignment-refinement";
import {
  nativeAlignmentLineFit,
  nativeAlignmentLineGate,
  nativeAlignmentLineRms,
} from "./scan-native-alignment-line";

const nativeIndefinite = new DataView(new ArrayBuffer(8));
nativeIndefinite.setBigUint64(0, 0xfff8000000000000n, true);

/** Complete original paired-point wrapper. Its returned matrix maps target to
 * source, after inversion of the source-to-target refinement result.
 */
export function nativeRegisterAlignmentPoints(
  source: readonly Vec3[],
  target: readonly Vec3[],
  options: { signal?: AbortSignal } = {},
) {
  if (options.signal?.aborted)
    throw new DOMException("Alignment operation cancelled.", "AbortError");
  if (source.length !== target.length)
    throw new Error("Alignment registration requires paired points.");
  const round = (points: readonly Vec3[]): Vec3[] =>
    points.map((point) => {
      if (point.length !== 3 || !point.every(Number.isFinite))
        throw new Error("Alignment registration requires finite XYZ points.");
      const result = point.map(Math.fround) as Vec3;
      if (!result.every(Number.isFinite))
        throw new Error("Alignment coordinates exceed Float32 precision.");
      return result;
    });
  const moving = round(source),
    fixed = round(target);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const fit = nativeAlignmentLineFit(moving);
  if (
    !nativeAlignmentLineGate(
      fit.accepted,
      fit.accepted
        ? nativeAlignmentLineRms(moving, fit.center, fit.direction)
        : 0,
    )
  )
    return { accepted: false, matrix: identity, rms: undefined };

  const first = nativeRefineAlignmentMatrix(
    identity,
    moving,
    fixed,
    options,
  ).matrix;
  const firstError = nativeAlignmentSquaredError(first, moving, fixed);
  let initialized = identity;
  let initializedError = 3.4028234663852886e38;
  if (moving.length >= 3) {
    const seed = nativeInitializeAlignmentPoints(moving, fixed, options);
    initialized = nativeRefineAlignmentMatrix(
      seed,
      moving,
      fixed,
      options,
    ).matrix;
    initializedError = nativeAlignmentSquaredError(initialized, moving, fixed);
  }
  const useInitialized = initializedError <= firstError;
  const chosen = useInitialized ? initialized : first;
  const error = useInitialized ? initializedError : firstError;
  return {
    accepted: true,
    matrix: inverseMirrorFrame(chosen),
    // Preserve native SQRT(0/0)'s indefinite representation instead of a
    // JavaScript constant NaN that the compiler may canonicalize.
    rms: moving.length
      ? Math.sqrt(error / moving.length)
      : nativeIndefinite.getFloat64(0, true),
  };
}

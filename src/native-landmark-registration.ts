import type { Positions, Vec3 } from "./types";
import type {
  RegistrationOptions,
  RegistrationResult,
  RigidTransform,
} from "./registration";
import { transformPoint } from "./registration";
import { nativeRegisterAlignmentPoints } from "./scan-native-alignment-registration";
import { inverseMirrorFrame } from "./scan-mirror-frame";

/** Adapt the recovered target-to-source wrapper to the application's moving-to-fixed contract. */
export function registerNativeLandmarks(
  source: Positions,
  target: Positions,
  options: RegistrationOptions = {},
): RegistrationResult {
  if (source.length !== target.length)
    throw new Error("Landmark counts must match.");
  if (source.length < 9 || source.length % 3)
    throw new Error("Choose at least three corresponding XYZ landmarks.");
  if (options.signal?.aborted)
    throw new DOMException("Alignment cancelled.", "AbortError");
  const points = (values: Positions): Vec3[] =>
    Array.from({ length: values.length / 3 }, (_, id) => [
      values[id * 3],
      values[id * 3 + 1],
      values[id * 3 + 2],
    ]);
  const moving = points(source),
    fixed = points(target);
  options.onProgress?.(0, 0);
  const result = nativeRegisterAlignmentPoints(moving, fixed, options);
  if (!result.accepted)
    throw new Error(
      "Landmarks are collinear or clustered too closely. Choose points spread across the scan.",
    );
  if (!result.matrix.every(Number.isFinite) || !Number.isFinite(result.rms))
    throw new Error(
      "Landmark alignment did not produce a finite rigid transform.",
    );
  const matrix = inverseMirrorFrame(result.matrix);
  const transform: RigidTransform = {
    rotation: [
      matrix[0],
      matrix[1],
      matrix[2],
      matrix[4],
      matrix[5],
      matrix[6],
      matrix[8],
      matrix[9],
      matrix[10],
    ],
    translation: [matrix[3], matrix[7], matrix[11]],
  };
  let maxError = 0;
  for (let id = 0; id < moving.length; id++) {
    const mapped = transformPoint(
      moving[id].map(Math.fround) as Vec3,
      transform,
    );
    maxError = Math.max(
      maxError,
      Math.hypot(
        ...mapped.map((value, axis) => value - Math.fround(fixed[id][axis])),
      ),
    );
  }
  options.onProgress?.(1, result.rms!);
  return {
    transform,
    rms: result.rms!,
    maxError,
    pairs: moving.length,
    // One registration invocation; the recovered wrapper does not expose its internal simplex count.
    iterations: 1,
    converged: true,
  };
}

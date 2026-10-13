import type { Vec3 } from "./types";
import {
  nativeAlignmentObjective,
  nativeAlignmentRotation,
} from "./scan-native-alignment";
import { nativeAlignmentSimplex } from "./scan-native-simplex";

export interface NativeAlignmentRefinementOptions {
  tolerance?: number;
  budget?: number;
  signal?: AbortSignal;
  /** Optional numerical trace receives a copy so observers cannot mutate the search. */
  onEvaluation?: (parameters: readonly number[], error: number) => void;
}

/** Recovered matrix-to-quaternion branches, including negative-trace half turns. */
export function nativeAlignmentParameters(matrix: readonly number[]): number[] {
  if (matrix.length !== 12 || !matrix.every(Number.isFinite))
    throw new Error("Alignment refinement requires a finite 3x4 matrix.");
  const trace = matrix[0] + matrix[5] + matrix[10];
  const quaternion = [0, 0, 0, 0];
  if (trace < 0) {
    const axis =
      matrix[0] < matrix[5]
        ? matrix[5] < matrix[10]
          ? 2
          : 1
        : matrix[0] < matrix[10]
          ? 2
          : 0;
    const next = (axis + 1) % 3,
      last = (axis + 2) % 3;
    const root = Math.sqrt(
      matrix[axis * 5] + 1 - (matrix[next * 5] + matrix[last * 5]),
    );
    const reciprocal = 0.5 / root;
    quaternion[axis + 1] = root * 0.5;
    quaternion[next + 1] =
      (matrix[next + axis * 4] + matrix[axis + next * 4]) * reciprocal;
    quaternion[last + 1] =
      (matrix[axis + last * 4] + matrix[last + axis * 4]) * reciprocal;
    quaternion[0] =
      (matrix[next + last * 4] - matrix[last + next * 4]) * reciprocal;
  } else {
    const root = Math.sqrt(trace + 1),
      reciprocal = 0.5 / root;
    quaternion[0] = root * 0.5;
    quaternion[1] = (matrix[9] - matrix[6]) * reciprocal;
    quaternion[2] = (matrix[2] - matrix[8]) * reciprocal;
    quaternion[3] = (matrix[4] - matrix[1]) * reciprocal;
  }
  return [...quaternion, matrix[3], matrix[7], matrix[11]];
}

/** Original matrix refinement wrapper, with optional RMS output left separate. */
export function nativeRefineAlignmentMatrix(
  initial: readonly number[],
  source: readonly Vec3[],
  target: readonly Vec3[],
  options: NativeAlignmentRefinementOptions = {},
) {
  return nativeRefineAlignmentParameters(
    nativeAlignmentParameters(initial),
    source,
    target,
    options,
  );
}

/** Quaternion (w,x,y,z) and world translation (x,y,z) to the native 3x4 matrix. */
export function nativeAlignmentMatrix(parameters: readonly number[]): number[] {
  if (parameters.length !== 7 || !parameters.every(Number.isFinite))
    throw new Error("Alignment refinement requires seven finite parameters.");
  const rotation = nativeAlignmentRotation(
    parameters.slice(0, 4) as [number, number, number, number],
  );
  return [
    ...rotation.slice(0, 3),
    parameters[4],
    ...rotation.slice(3, 6),
    parameters[5],
    ...rotation.slice(6, 9),
    parameters[6],
  ];
}

/** Connected native paired-point callback and optimizer; before outer candidate ranking. */
export function nativeRefineAlignmentParameters(
  initial: readonly number[],
  source: readonly Vec3[],
  target: readonly Vec3[],
  options: NativeAlignmentRefinementOptions = {},
) {
  nativeAlignmentMatrix(initial);
  if (source.length < 3 || source.length !== target.length)
    throw new Error(
      "Alignment refinement requires at least three paired points.",
    );
  const points = (input: readonly Vec3[]): Vec3[] =>
    input.map((point) => {
      if (point.length !== 3 || !point.every(Number.isFinite))
        throw new Error(
          "Alignment point coordinates must be finite XYZ values.",
        );
      const rounded = point.map(Math.fround) as Vec3;
      if (!rounded.every(Number.isFinite))
        throw new Error(
          "Alignment point coordinates exceed Float32 precision.",
        );
      return rounded;
    });
  const moving = points(source);
  const fixed = points(target);
  const result = nativeAlignmentSimplex(
    initial,
    (parameters) => {
      const error = nativeAlignmentObjective(
        nativeAlignmentMatrix(parameters),
        moving,
        fixed,
      );
      options.onEvaluation?.(parameters.slice(), error);
      return error;
    },
    options.tolerance ?? 0.0001,
    options.budget ?? 1000,
    Math.fround(0.005),
    options.signal,
  );
  return { ...result, matrix: nativeAlignmentMatrix(result.parameters) };
}

import type { Vec3 } from "./types";
import { nativeRegisterAlignmentPoints } from "./scan-native-alignment-registration";

export interface NativeAlignmentLandmark {
  point: Vec3;
  fixed: boolean;
}

/** Original candidate builder passes fixed points first to the inverted wrapper,
 * yielding a moving-to-fixed transform. Full preview refinement is separate.
 */
export function nativeAlignmentLandmarkCandidate(
  landmarks: readonly NativeAlignmentLandmark[],
  options: { signal?: AbortSignal } = {},
): number[] | undefined {
  const fixed = landmarks
    .filter((landmark) => landmark.fixed)
    .map(({ point }) => point);
  const moving = landmarks
    .filter((landmark) => !landmark.fixed)
    .map(({ point }) => point);
  if (fixed.length !== moving.length)
    throw new Error(
      "Landmark candidate requires equal moving and fixed counts.",
    );
  if (options.signal?.aborted)
    throw new DOMException("Alignment operation cancelled.", "AbortError");
  if (fixed.length < 3) return undefined;
  const result = nativeRegisterAlignmentPoints(fixed, moving, options);
  return result.accepted ? result.matrix : undefined;
}

/** Original preview's landmark-to-original-vertex map. Fixed landmarks are
 * excluded; ties preserve the first vertex, and distances start at Float32 max.
 */
export function nativeAlignmentOriginalVertexIndices(
  vertices: Float32Array,
  landmarks: readonly NativeAlignmentLandmark[],
  options: { signal?: AbortSignal } = {},
): Uint32Array {
  if (vertices.length % 3 || !vertices.every(Number.isFinite))
    throw new Error(
      "Alignment vertex storage must contain finite XYZ triples.",
    );
  const moving = landmarks.filter((landmark) => !landmark.fixed);
  if (
    moving.some(
      ({ point }) => point.length !== 3 || !point.every(Number.isFinite),
    )
  )
    throw new Error("Alignment landmarks must contain finite XYZ triples.");
  const indices = new Uint32Array(moving.length).fill(0xffffffff);
  const distances = new Float64Array(moving.length).fill(3.4028234663852886e38);
  for (let id = 0; id < vertices.length / 3; id++) {
    if (id % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Alignment operation cancelled.", "AbortError");
    const x = vertices[id * 3],
      y = vertices[id * 3 + 1],
      z = vertices[id * 3 + 2];
    for (let landmark = 0; landmark < moving.length; landmark++) {
      const point = moving[landmark].point;
      const dx = x - point[0],
        dy = y - point[1],
        dz = z - point[2];
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < distances[landmark]) {
        distances[landmark] = distance;
        indices[landmark] = id;
      }
    }
  }
  if (options.signal?.aborted)
    throw new DOMException("Alignment operation cancelled.", "AbortError");
  return indices;
}

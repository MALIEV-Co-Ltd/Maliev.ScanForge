import { nativeCompactReductionMesh } from "./scan-reduction-compact";
import type { MeshProcessingOptions } from "./mesh-processing";
import { COMPACT_REDUCTION_BUDGET_BYTES } from "./scan-reduction-storage";

/** Recovered sequential reduction, with bounded compact records and original ordering. */
export function nativeReductionMesh(
  coordinates: ArrayLike<number>,
  triangles: ArrayLike<number>,
  target: number,
  options: MeshProcessingOptions = {},
  limitBytes = COMPACT_REDUCTION_BUDGET_BYTES,
) {
  return nativeCompactReductionMesh(
    coordinates,
    triangles,
    target,
    options,
    limitBytes,
  );
}

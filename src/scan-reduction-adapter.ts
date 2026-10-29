import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";
import { nativeReductionMesh } from "./scan-native-reduction";
import {
  compactReductionBytes,
  COMPACT_REDUCTION_BUDGET_BYTES,
  ReductionBudgetError,
} from "./scan-reduction-storage";
import { weldMeshPositions } from "./mesh-weld";
import { validateReductionSource } from "./scan-reduction-source";
import type { Positions } from "./types";

/** Working-record admission, including growing incidence references and output scratch. */
export function admitReductionRecords(vertices: number, faces: number) {
  if (!canAdmitReductionRecords(vertices, faces))
    throw new ReductionBudgetError();
}
export function canAdmitReductionRecords(vertices: number, faces: number) {
  return (
    Number.isSafeInteger(vertices) &&
    vertices >= 0 &&
    Number.isSafeInteger(faces) &&
    faces >= 0 &&
    vertices <= 0xffffffff &&
    faces <= Math.floor(0xffffffff / 3) &&
    compactReductionBytes(vertices, faces) <= COMPACT_REDUCTION_BUDGET_BYTES
  );
}

/** Bounded first-encounter samples; validation remains separate from preview-only indexing. */
export function prepareReductionSamples(
  positions: Positions,
  options: MeshProcessingOptions = {},
) {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  const residentBytes =
    positions.length * (positions instanceof Float32Array ? 4 : 8);
  const remaining = COMPACT_REDUCTION_BUDGET_BYTES - residentBytes;
  const admit = (bytes: number) => {
    check();
    if (!Number.isSafeInteger(bytes) || bytes > remaining)
      throw new ReductionBudgetError();
  };
  const cache = options.topologyCache;
  const indexed =
    cache?.positions === positions &&
    cache.tolerance === 1e-6 &&
    (cache.topology ?? cache.reductionSource)
      ? (cache.topology ?? cache.reductionSource)!
      : weldMeshPositions(
          positions,
          1e-6,
          (fraction) => {
            check();
            options.onProgress?.(fraction * 0.6, "Welding vertices");
            check();
          },
          admit,
        );
  const retainedBytes =
    indexed.vertices.byteLength + indexed.triangles.byteLength;
  admit(retainedBytes);
  check();
  return indexed;
}

/** Global reduction validates independently of preview-only sample acquisition. */
export function prepareReductionSource(
  positions: Positions,
  options: MeshProcessingOptions = {},
) {
  const indexed = prepareReductionSamples(positions, options);
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  const remaining =
    COMPACT_REDUCTION_BUDGET_BYTES -
    positions.length * (positions instanceof Float32Array ? 4 : 8);
  const retainedBytes =
    indexed.vertices.byteLength + indexed.triangles.byteLength;
  options.onProgress?.(0.6, "Checking reduction topology");
  validateReductionSource(
    indexed.vertices,
    indexed.triangles,
    check,
    remaining - retainedBytes,
  );
  options.onProgress?.(1, "Topology complete");
  check();
  return indexed;
}

/** Native caller widens source Float32 points and narrows compacted points before facet export. */
export function reduceIndexedScanMesh(
  topology: Pick<MeshTopology, "vertices" | "triangles">,
  target: number,
  options: MeshProcessingOptions = {},
  residentBytes = 0,
) {
  admitReductionRecords(
    topology.vertices.length / 3,
    topology.triangles.length / 3,
  );
  const limitBytes =
    COMPACT_REDUCTION_BUDGET_BYTES -
    residentBytes -
    topology.vertices.byteLength -
    topology.triangles.byteLength;
  if (
    compactReductionBytes(
      topology.vertices.length / 3,
      topology.triangles.length / 3,
    ) > limitBytes
  )
    throw new ReductionBudgetError();
  const result = nativeReductionMesh(
    Float64Array.from(topology.vertices, Math.fround),
    topology.triangles,
    target,
    {
      ...options,
      onProgress: (fraction, stage) =>
        options.onProgress?.(
          fraction * 0.95,
          fraction === 1 ? "Exporting reduced mesh" : stage,
        ),
    },
    limitBytes,
  );
  const positions = new Float32Array(result.triangles.length * 3);
  for (let corner = 0; corner < result.triangles.length; corner++) {
    if (corner % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const id = result.triangles[corner];
    for (let axis = 0; axis < 3; axis++) {
      const value = Math.fround(result.vertices[id * 3 + axis]);
      if (!Number.isFinite(value))
        throw new Error(
          "Reduced mesh exceeds coordinate precision; original mesh retained.",
        );
      positions[corner * 3 + axis] = value;
    }
  }
  options.onProgress?.(1, "Polygon reduction completed");
  if (options.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  return positions;
}

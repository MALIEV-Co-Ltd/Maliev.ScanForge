import type { Entity, IndexedMesh, Positions } from "./types";
import { indexedMeshMatches } from "./indexed-mesh";
import { nativeRefineAlignmentMeshes } from "./scan-native-alignment-surface-controller";
export interface NativeSurfaceRefinementRequest {
  kind: "nativeRefine";
  positions: Positions;
  target: Positions;
  sourceIndexed: IndexedMesh;
  targetIndexed: IndexedMesh;
  sourceTriangleMask?: Uint8Array;
  sampleBudget: number;
  initialRadius: number;
}
export function nativeSurfaceRefinementRequest(
  source: Entity,
  target: Entity,
  sampleBudget: number,
  initialRadius: number,
  sourceTriangleMask?: Uint8Array,
): NativeSurfaceRefinementRequest {
  if (source.id === target.id)
    throw new Error("Alignment requires two different objects.");
  if (
    source.meshSelection?.hidden?.length ||
    target.meshSelection?.hidden?.length
  )
    throw new Error("Reveal hidden triangles before surface refinement.");
  if (
    source.kind !== "mesh" ||
    target.kind !== "mesh" ||
    !source.indexedMesh ||
    !target.indexedMesh
  )
    throw new Error(
      "Surface refinement requires indexed PLY meshes for both moving and fixed objects.",
    );
  return {
    kind: "nativeRefine",
    positions: source.positions,
    target: target.positions,
    sourceIndexed: source.indexedMesh,
    targetIndexed: target.indexedMesh,
    sampleBudget,
    initialRadius,
    sourceTriangleMask,
  };
}
export function refineNativeSurface(
  request: NativeSurfaceRefinementRequest,
  progress: (fraction: number, stage: string) => void,
) {
  if (
    !indexedMeshMatches(request.sourceIndexed, request.positions) ||
    !indexedMeshMatches(request.targetIndexed, request.target)
  )
    throw new Error(
      "Alignment indexed topology does not match its render geometry.",
    );
  if (
    !Number.isSafeInteger(request.sampleBudget) ||
    request.sampleBudget < 1 ||
    request.sampleBudget > 100000 ||
    !Number.isFinite(request.initialRadius) ||
    request.initialRadius <= 0
  )
    throw new Error(
      "Invalid surface refinement sampling budget or initial radius.",
    );
  const mask = request.sourceTriangleMask;
  if (
    mask &&
    (mask.length !== request.sourceIndexed.triangles.length / 3 ||
      !mask.some(Boolean))
  )
    throw new Error(
      "Surface refinement requires a nonempty triangle selection of the correct size.",
    );
  const flags = mask
    ? new Uint32Array(request.sourceIndexed.vertices.length / 3)
    : undefined;
  if (flags && mask)
    for (let face = 0; face < mask.length; face++)
      if (mask[face])
        for (let corner = 0; corner < 3; corner++)
          flags[request.sourceIndexed.triangles[face * 3 + corner]] = 4;
  progress(0, "Preparing native surface refinement");
  const result = nativeRefineAlignmentMeshes(
    [{ ...request.sourceIndexed, flags }],
    request.targetIndexed,
    request.sampleBudget,
    {
      selectionOnly: !!mask,
      initialRadius: request.initialRadius,
      onProgress: (fraction, stage) => progress(fraction * 0.2, stage),
    },
  );
  const transform = (coordinates: Positions): Float32Array => {
    const output = new Float32Array(coordinates.length),
      m = result.matrix;
    for (let offset = 0; offset < coordinates.length; offset += 3) {
      const x = coordinates[offset],
        y = coordinates[offset + 1],
        z = coordinates[offset + 2];
      output[offset] = y * m[1] + x * m[0] + z * m[2] + m[3];
      output[offset + 1] = x * m[4] + y * m[5] + z * m[6] + m[7];
      output[offset + 2] = x * m[8] + y * m[9] + z * m[10] + m[11];
    }
    if (!output.every(Number.isFinite))
      throw new Error("Refined coordinates exceed Float32 output precision.");
    return output;
  };
  progress(
    1,
    result.accepted
      ? "Surface refinement accepted"
      : "Surface refinement did not converge",
  );
  return {
    refinement: {
      accepted: result.accepted,
      matrix: result.matrix,
      parameters: result.parameters,
      initialError: result.initialError,
      best: result.best,
      iterations: result.iterations,
    },
    ...(result.accepted
      ? {
          positions: transform(request.positions),
          indexedMesh: {
            vertices: transform(request.sourceIndexed.vertices),
            triangles: Uint32Array.from(request.sourceIndexed.triangles),
          },
        }
      : {}),
  };
}

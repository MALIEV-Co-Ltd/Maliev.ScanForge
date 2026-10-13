import type { Entity, IndexedMesh, Positions } from "./types";
import { indexedMeshMatches } from "./indexed-mesh";
import {
  nativeRefineAlignmentMeshes,
  nativeRefineAlignmentMeshesAsync,
} from "./scan-native-alignment-surface-controller";
export interface NativeSurfaceRefinementRequest {
  kind: "nativeRefine";
  positions: Positions;
  target: Positions;
  sourceIndexed: IndexedMesh;
  targetIndexed: IndexedMesh;
  additionalTargets?: { positions: Positions; indexedMesh: IndexedMesh }[];
  sourceTriangleMask?: Uint8Array;
  sampleBudget: number;
  initialRadius: number;
  workerCount?: number;
  parallel?: boolean;
}
export function nativeSurfaceRefinementRequest(
  source: Entity,
  target: Entity | readonly Entity[],
  sampleBudget: number,
  initialRadius: number,
  sourceTriangleMask?: Uint8Array,
  workerCount = 1,
  parallel = true,
): NativeSurfaceRefinementRequest {
  const targets: readonly Entity[] = Array.isArray(target)
    ? target
    : [target as Entity];
  if (
    !targets.length ||
    targets.length > 32 ||
    new Set(targets.map((entity) => entity.id)).size !== targets.length
  )
    throw new Error("Alignment requires distinct fixed targets.");
  const first = targets[0];
  for (const target of targets) {
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
        "Surface refinement requires indexed meshes for both moving and fixed objects.",
      );
  }
  return {
    kind: "nativeRefine",
    positions: source.positions,
    target: first.positions,
    sourceIndexed: source.indexedMesh!,
    targetIndexed: first.indexedMesh!,
    ...(targets.length > 1
      ? {
          additionalTargets: targets.slice(1).map((entity) => ({
            positions: entity.positions,
            indexedMesh: entity.indexedMesh!,
          })),
        }
      : {}),
    sampleBudget,
    initialRadius,
    workerCount,
    parallel,
    sourceTriangleMask,
  };
}
function prepareRequest(
  request: NativeSurfaceRefinementRequest,
  progress: (fraction: number, stage: string) => void,
) {
  if (
    !indexedMeshMatches(request.sourceIndexed, request.positions) ||
    !indexedMeshMatches(request.targetIndexed, request.target) ||
    request.additionalTargets?.some(
      (target) => !indexedMeshMatches(target.indexedMesh, target.positions),
    )
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
  if (
    !Number.isInteger(request.workerCount ?? 1) ||
    (request.workerCount ?? 1) < 1 ||
    (request.workerCount ?? 1) > 16 ||
    (request.parallel !== undefined && typeof request.parallel !== "boolean")
  )
    throw new Error(
      "Alignment workerCount must be 1 to 16 and parallel must be boolean.",
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
  return { flags, mask };
}
export function refineNativeSurface(
  request: NativeSurfaceRefinementRequest,
  progress: (fraction: number, stage: string) => void,
) {
  const { flags, mask } = prepareRequest(request, progress);
  const result = runRefinement(request, progress, flags, mask);
  return finishRefinement(request, progress, result);
}
function runRefinement(
  request: NativeSurfaceRefinementRequest,
  progress: (fraction: number, stage: string) => void,
  flags: Uint32Array | undefined,
  mask: Uint8Array | undefined,
) {
  return nativeRefineAlignmentMeshes(
    [{ ...request.sourceIndexed, flags }],
    request.additionalTargets?.length
      ? [
          request.targetIndexed,
          ...request.additionalTargets.map((target) => target.indexedMesh),
        ]
      : request.targetIndexed,
    request.sampleBudget,
    {
      selectionOnly: !!mask,
      workerCount: request.workerCount ?? 1,
      parallel: request.parallel ?? true,
      initialRadius: request.initialRadius,
      onProgress: (fraction, stage) => progress(fraction * 0.2, stage),
    },
  );
}
export async function refineNativeSurfaceAsync(
  request: NativeSurfaceRefinementRequest,
  progress: (fraction: number, stage: string) => void,
) {
  const { flags, mask } = prepareRequest(request, progress);
  const result = await nativeRefineAlignmentMeshesAsync(
    [{ ...request.sourceIndexed, flags }],
    request.additionalTargets?.length
      ? [
          request.targetIndexed,
          ...request.additionalTargets.map((target) => target.indexedMesh),
        ]
      : request.targetIndexed,
    request.sampleBudget,
    {
      selectionOnly: !!mask,
      workerCount: request.workerCount ?? 1,
      parallel: request.parallel ?? true,
      initialRadius: request.initialRadius,
      onProgress: (fraction, stage) => progress(fraction * 0.2, stage),
    },
  );
  return {
    ...finishRefinement(request, progress, result),
    execution: {
      physicalWorkers: result.physicalWorkers,
      logicalLanes: result.logicalLanes,
      fallbackReason: result.fallbackReason,
    },
  };
}
function finishRefinement(
  request: NativeSurfaceRefinementRequest,
  progress: (fraction: number, stage: string) => void,
  result: ReturnType<typeof nativeRefineAlignmentMeshes>,
) {
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

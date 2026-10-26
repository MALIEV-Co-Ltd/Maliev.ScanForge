import type { IndexedMesh } from "./types";
import { transformDatumCoordinates } from "./datum-transform-kernel";
import { nativeDatumIsIdentity } from "./scan-native-datum-apply";
import { prepareNativeLandmarkRegion } from "./native-landmark-region";
import { nativeRefineAlignmentMeshesAsync } from "./scan-native-alignment-surface-controller";
import { meshGeometryNormals, meshFacetNormals } from "./mesh-geometry-normals";
import { prepareNativeLandmarkTarget } from "./native-landmark-target";

/** Native indexed source stages. Coarse registration and scene target collection
 * are performed by the caller; coordinates must retain storage between stages.
 */
export async function refineNativeLandmarkAfterCoarse(
  source: IndexedMesh,
  targets: readonly IndexedMesh[],
  coarse: readonly number[],
  seeds: ArrayLike<number>,
  options: {
    workerCount?: number;
    parallel?: boolean;
    initialRadius?: number;
    signal?: AbortSignal;
    faceFlags?: Uint8Array;
    onProgress?: (fraction: number, stage: string) => void;
  } = {},
) {
  const originalVertices =
    source.vertices instanceof Float32Array
      ? source.vertices
      : Float32Array.from(source.vertices);
  // Connectivity is immutable; retain the published source index backing.
  const triangles =
    source.triangles instanceof Uint32Array
      ? source.triangles
      : Uint32Array.from(source.triangles);
  const region = prepareNativeLandmarkRegion(
    originalVertices.length / 3,
    triangles,
    seeds,
    undefined,
    options.faceFlags,
    options.signal,
  );
  // Computed geometry vectors precede coarse coordinate rounding; scanner
  // attributes are retained separately and never substitute for this state.
  const originalNormals = meshGeometryNormals(source, options.signal);
  const vertices = transformDatumCoordinates(originalVertices, coarse);
  const normals = transformDatumCoordinates(originalNormals, coarse, true);
  const result = await nativeRefineAlignmentMeshesAsync(
    [{ vertices, triangles, normals, flags: region.vertices }],
    targets.length ? [prepareNativeLandmarkTarget(targets, options)] : [],
    0x7fffffff,
    {
      ...options,
      selectionOnly: true,
      initialRadius: options.initialRadius ?? 3,
      minimumExtent: 0.5,
    },
  );
  const applied = !nativeDatumIsIdentity(result.matrix, Number.EPSILON);
  const scannerNormals = source.normals
    ? transformDatumCoordinates(source.normals, coarse, true)
    : undefined;
  return {
    selection: nativeLandmarkFaceSelection(region.faceFlags, applied),
    indexedMesh: {
      vertices: applied
        ? transformDatumCoordinates(vertices, result.matrix)
        : vertices,
      triangles,
      facetNormals: applied
        ? transformDatumCoordinates(
            transformDatumCoordinates(
              meshFacetNormals(source, options.signal),
              coarse,
              true,
            ),
            result.matrix,
            true,
          )
        : transformDatumCoordinates(
            meshFacetNormals(source, options.signal),
            coarse,
            true,
          ),
      geometryNormals: applied
        ? transformDatumCoordinates(normals, result.matrix, true)
        : normals,
      ...(scannerNormals
        ? {
            normals: applied
              ? transformDatumCoordinates(scannerNormals, result.matrix, true)
              : scannerNormals,
          }
        : {}),
    },
    refinement: {
      accepted: result.accepted,
      matrix: result.matrix,
      parameters: result.parameters,
      initialError: result.initialError,
      best: result.best,
      iterations: result.iterations,
    },
    diagnostics: {
      selectedTriangles: applied ? 0 : region.count,
      refinementApplied: applied,
      seededFaces: region.count,
      seedGrowthPasses: region.passes,
      seedFaceReferences: region.visitedFaceReferences,
      physicalWorkers: result.physicalWorkers,
      logicalLanes: result.logicalLanes,
      fallbackReason: result.fallbackReason,
    },
  };
}

/** Original identity tail retains the grown region; applied refinement clears it. */
export function nativeLandmarkFaceSelection(
  faceFlags: Uint8Array,
  applied: boolean,
) {
  const selection = new Uint8Array(faceFlags.length);
  if (!applied)
    for (let face = 0; face < faceFlags.length; face++)
      selection[face] = Number(!!(faceFlags[face] & 4));
  return selection;
}

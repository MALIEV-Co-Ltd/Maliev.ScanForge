import type { MeshProcessingOptions } from "./mesh-processing";
import type { NoiseBounds } from "./scan-noise-octree-query";
import { nativeBuildAlignmentAdjacency } from "./scan-native-alignment-adjacency";
import { nativeAlignmentFaceCache } from "./scan-native-alignment-face-cache";
import { prepareNativeAlignmentTarget } from "./scan-native-alignment-target";
import { createNativeAlignmentSurfaceQuery } from "./scan-native-alignment-mesh-query";

/** Prepare once per indexed target geometry; repeated correspondence queries reuse every cache. */
export function prepareNativeAlignmentSurface(
  vertices: ArrayLike<number>,
  triangles: ArrayLike<number>,
  options: MeshProcessingOptions & {
    minimumExtent?: number;
    filterExcluded?: boolean;
    triangleFlags?: ArrayLike<number>;
    cachedBounds?: NoiseBounds;
  } = {},
) {
  const adjacency = nativeBuildAlignmentAdjacency(vertices, triangles, options);
  const faces = nativeAlignmentFaceCache(vertices, triangles, options);
  const target = prepareNativeAlignmentTarget(
    { coordinates: vertices, indices: triangles },
    {
      ...options,
      cachedBounds: options.cachedBounds ?? adjacency.bounds,
    },
  );
  if (!target) return undefined;
  const surface = {
    ...target,
    normals: faces.normals,
    neighbors: Uint8Array.from(adjacency.neighbors, (face) => +(face >= 0)),
  };
  return {
    surface,
    adjacency,
    degenerate: faces.degenerate,
    query: createNativeAlignmentSurfaceQuery(surface),
  };
}

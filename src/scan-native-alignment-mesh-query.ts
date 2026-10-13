import type { AlignmentQueryHit } from "./scan-native-alignment-query";
import {
  createNoiseTriangleScratch,
  noiseTriangleDistance,
} from "./scan-noise-deviation";
import {
  queryNoiseOctree,
  type NoiseQueryNode,
} from "./scan-noise-octree-query";

export interface NativeAlignmentQuerySurface {
  root: NoiseQueryNode;
  points: Float32Array;
  triangleBounds: Float32Array;
  normals: Float32Array;
  /** Presence of neighbors for edges AB, BC, CA, in native mask order. */
  neighbors: Uint8Array;
  triangleFlags?: Uint8Array;
  filterHidden?: boolean;
}

/** Query an already prepared target. Construction and native vertex ordering remain separate gates. */
export function createNativeAlignmentSurfaceQuery(
  surface: NativeAlignmentQuerySurface,
) {
  const count = surface.points.length / 9;
  if (
    !Number.isInteger(count) ||
    surface.triangleBounds.length !== count * 6 ||
    surface.normals.length !== count * 3 ||
    surface.neighbors.length !== count * 3 ||
    (surface.triangleFlags && surface.triangleFlags.length !== count)
  )
    throw new Error(
      "Alignment target arrays must describe the same triangles.",
    );
  const a = [0, 0, 0],
    b = [0, 0, 0],
    c = [0, 0, 0];
  const closest: number[] = [],
    region = [0];
  const normal = [0, 0, 0];
  const scratch = createNoiseTriangleScratch();
  return (
    point: readonly number[],
    radius: number,
  ): AlignmentQueryHit | undefined => {
    let bestRegion = 0;
    const bestClosest = [0, 0, 0];
    const hit = queryNoiseOctree(
      surface.root,
      point,
      radius,
      surface.triangleBounds,
      (triangle, searchRadius) => {
        if (
          surface.filterHidden &&
          (surface.triangleFlags?.[triangle] ?? 0) & 1
        )
          return Infinity;
        for (let axis = 0; axis < 3; axis++) {
          a[axis] = surface.points[triangle * 9 + axis];
          b[axis] = surface.points[triangle * 9 + 3 + axis];
          c[axis] = surface.points[triangle * 9 + 6 + axis];
          normal[axis] = surface.normals[triangle * 3 + axis];
        }
        const distance = noiseTriangleDistance(
          point,
          a,
          b,
          c,
          searchRadius,
          closest,
          region,
          normal,
          scratch,
        );
        if (Math.abs(distance) < searchRadius) {
          bestRegion = region[0];
          for (let axis = 0; axis < 3; axis++)
            bestClosest[axis] = closest[axis];
        }
        return distance;
      },
    );
    if (!hit) return undefined;
    const offset = hit.triangle * 3;
    return {
      distance: hit.distance,
      closest: bestClosest,
      normal: [
        surface.normals[offset],
        surface.normals[offset + 1],
        surface.normals[offset + 2],
      ],
      openBoundary: [1, 2, 4].some(
        (bit, edge) =>
          (bestRegion & bit) !== 0 && surface.neighbors[offset + edge] === 0,
      ),
    };
  };
}

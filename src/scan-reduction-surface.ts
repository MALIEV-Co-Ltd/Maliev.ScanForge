import { BufferAttribute, BufferGeometry } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { MeshProcessingOptions } from "./mesh-processing";
import {
  packNoiseOctree,
  prepareNoiseOctree,
  type NoiseIndexedSurface,
  type PackedNoiseTree,
} from "./scan-noise-octree";
import {
  createNoiseTriangleScratch,
  noiseTriangleDistance,
} from "./scan-noise-deviation";
import type { NoiseQueryHit } from "./scan-noise-octree-query";

/** Large comparison surfaces need linear storage, not duplicated octant memberships. */
export class ReductionSurfaceBVH {
  readonly kind = "reduction-bvh";
  private readonly tree: MeshBVH;
  private readonly points: Float32Array;
  private readonly bounds: Float32Array;
  private readonly normals: Float32Array;
  constructor(
    surface: NoiseIndexedSurface,
    options: MeshProcessingOptions = {},
  ) {
    const packed = packNoiseOctree(surface, 0.5, 10, options);
    this.points = packed.points;
    this.bounds = packed.triangleBounds;
    const count = this.points.length / 9;
    this.normals = new Float32Array(count * 3);
    const check = () => {
      if (options.signal?.aborted)
        throw new DOMException("Mesh operation cancelled.", "AbortError");
    };
    for (let id = 0; id < count; id++) {
      if (id % 4096 === 0) check();
      const p = id * 9;
      const ux = this.points[p + 3] - this.points[p],
        uy = this.points[p + 4] - this.points[p + 1],
        uz = this.points[p + 5] - this.points[p + 2];
      const vx = this.points[p + 6] - this.points[p],
        vy = this.points[p + 7] - this.points[p + 1],
        vz = this.points[p + 8] - this.points[p + 2];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const length = Math.fround(Math.sqrt(nx * nx + ny * ny + nz * nz));
      this.normals[id * 3] = length > Number.EPSILON ? nx / length : NaN;
      this.normals[id * 3 + 1] = length > Number.EPSILON ? ny / length : NaN;
      this.normals[id * 3 + 2] = length > Number.EPSILON ? nz / length : NaN;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.points, 3));
    try {
      this.tree = new MeshBVH(geometry, {
        indirect: true,
        targetLeafSize: 12,
        onProgress: (fraction) => {
          check();
          options.onProgress?.(
            fraction,
            "Indexing reduced surface for comparison",
          );
          check();
        },
      });
      check();
    } finally {
      // CPU-only geometry; no renderer or GPU resource is retained by this index.
      geometry.dispose();
    }
  }
  createQuery() {
    const a = [0, 0, 0],
      b = [0, 0, 0],
      c = [0, 0, 0],
      normal = [0, 0, 0];
    const scratch = createNoiseTriangleScratch();
    return (point: number[], radius: number): NoiseQueryHit | undefined => {
      let best = Math.abs(radius);
      let hit: NoiseQueryHit | undefined;
      this.tree.shapecast({
        boundsTraverseOrder: (box) => {
          const x = Math.max(box.min.x - point[0], 0, point[0] - box.max.x);
          const y = Math.max(box.min.y - point[1], 0, point[1] - box.max.y);
          const z = Math.max(box.min.z - point[2], 0, point[2] - box.max.z);
          return x * x + y * y + z * z;
        },
        intersectsBounds: (box) =>
          point[0] >= box.min.x - best &&
          point[0] <= box.max.x + best &&
          point[1] >= box.min.y - best &&
          point[1] <= box.max.y + best &&
          point[2] >= box.min.z - best &&
          point[2] <= box.max.z + best,
        intersectsRange: (offset, count) => {
          for (let j = offset; j < offset + count; j++) {
            const id = this.tree.resolveTriangleIndex(j),
              bound = id * 6;
            if (
              !Number.isFinite(this.normals[id * 3]) ||
              point[0] < this.bounds[bound] - best ||
              point[0] > this.bounds[bound + 3] + best ||
              point[1] < this.bounds[bound + 1] - best ||
              point[1] > this.bounds[bound + 4] + best ||
              point[2] < this.bounds[bound + 2] - best ||
              point[2] > this.bounds[bound + 5] + best
            )
              continue;
            for (let axis = 0; axis < 3; axis++) {
              a[axis] = this.points[id * 9 + axis];
              b[axis] = this.points[id * 9 + 3 + axis];
              c[axis] = this.points[id * 9 + 6 + axis];
              normal[axis] = this.normals[id * 3 + axis];
            }
            const distance = noiseTriangleDistance(
              point,
              a,
              b,
              c,
              best,
              undefined,
              undefined,
              normal,
              scratch,
            );
            const absolute = Math.abs(distance);
            // Stable source-order ties; retain the strict search-radius boundary.
            if (
              absolute < best ||
              (hit && absolute === best && id < hit.triangle)
            ) {
              best = absolute;
              hit = { triangle: id, distance };
            }
          }
          return false;
        },
      });
      return hit;
    };
  }
}

export type ReductionComparisonSurface = PackedNoiseTree | ReductionSurfaceBVH;

export function prepareReductionSurface(
  surface: NoiseIndexedSurface,
  options: MeshProcessingOptions = {},
): ReductionComparisonSurface {
  // Keep the recovered index and query ordering for existing small-mesh comparisons.
  // Large surfaces bypass its known fixed limit instead of first building a failed tree.
  if (surface.indices.length / 3 > 100_000)
    return new ReductionSurfaceBVH(surface, options);
  try {
    return prepareNoiseOctree(surface, 0.5, 10, options);
  } catch (error) {
    if (
      !(error instanceof RangeError) ||
      error.message !== "Noise tree exceeds its node budget"
    )
      throw error;
    return new ReductionSurfaceBVH(surface, options);
  }
}

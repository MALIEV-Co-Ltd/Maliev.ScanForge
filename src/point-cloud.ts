import type { MeshStats, Positions, Vec3 } from "./types";

export function pointCloudStats(positions: Positions): MeshStats {
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  return {
    vertices: positions.length / 3,
    triangles: 0,
    area: 0,
    volume: 0,
    min,
    max,
    size: min.map((v, i) => max[i] - v) as Vec3,
    center: min.map((v, i) => (max[i] + v) / 2) as Vec3,
  };
}

/** Imported scanner normals are directions: rigid alignment never translates them. */
export function rotatePointNormals(
  normals: ArrayLike<number>,
  rotation: readonly number[],
): number[] {
  const result = new Array<number>(normals.length);
  for (let i = 0; i < normals.length; i += 3)
    for (let axis = 0; axis < 3; axis++)
      result[i + axis] =
        rotation[axis * 3] * normals[i] +
        rotation[axis * 3 + 1] * normals[i + 1] +
        rotation[axis * 3 + 2] * normals[i + 2];
  return result;
}

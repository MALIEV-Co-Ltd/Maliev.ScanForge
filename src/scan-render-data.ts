import { meshStats } from "./geometry";
import { indexedMeshMatches } from "./indexed-mesh";
import type { IndexedMesh, MeshStats, Positions } from "./types";
import { smoothDisplayNormals } from "./viewport-display";

/** Disposable display data stays outside authored entities and project files. */
export interface ScanRenderData {
  normals?: Float32Array;
  /** When present, display normals follow this topology's vertex order. */
  indexedMesh?: IndexedMesh;
  bounds: [number, number, number, number, number, number];
  /** Conservative radius about the bounds midpoint, avoiding another vertex scan. */
  radius: number;
  stats?: MeshStats;
}

const prepared = new WeakMap<Positions, ScanRenderData>();
const displayStats = new WeakMap<Positions, MeshStats>();

/** Scene geometry is immutable; selection changes must not rescan every facet. */
export function displayMeshStats(positions: Positions): MeshStats {
  const existing =
    prepared.get(positions)?.stats ?? displayStats.get(positions);
  if (existing) return existing;
  const stats = meshStats(positions);
  displayStats.set(positions, stats);
  return stats;
}

/** Buffers are immutable after import; a geometry edit receives a new identity. */
export function cacheScanRenderData(
  positions: Positions,
  data: ScanRenderData,
): void {
  prepared.set(positions, data);
}

export function scanRenderData(
  positions: Positions,
): ScanRenderData | undefined {
  return prepared.get(positions);
}

function indexedNormals(mesh: IndexedMesh): Float32Array {
  const sums = new Float32Array(mesh.vertices.length);
  const triangles = mesh.triangles;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i] * 3,
      b = triangles[i + 1] * 3,
      c = triangles[i + 2] * 3;
    const vertices = mesh.vertices;
    const abx = vertices[b] - vertices[a],
      aby = vertices[b + 1] - vertices[a + 1],
      abz = vertices[b + 2] - vertices[a + 2];
    const acx = vertices[c] - vertices[a],
      acy = vertices[c + 1] - vertices[a + 1],
      acz = vertices[c + 2] - vertices[a + 2];
    const x = aby * acz - abz * acy,
      y = abz * acx - abx * acz,
      z = abx * acy - aby * acx;
    for (let corner = 0; corner < 3; corner++) {
      const offset = triangles[i + corner] * 3;
      sums[offset] += x;
      sums[offset + 1] += y;
      sums[offset + 2] += z;
    }
  }
  for (let i = 0; i < sums.length; i += 3) {
    const length = Math.hypot(sums[i], sums[i + 1], sums[i + 2]);
    if (length) {
      sums[i] /= length;
      sums[i + 1] /= length;
      sums[i + 2] /= length;
    }
  }
  return sums;
}

/** Run in the import worker after unit conversion and placement, before transfer. */
export function prepareScanRenderData(
  positions: Float32Array,
  indexedMesh?: IndexedMesh,
  pointCloud = false,
): ScanRenderData {
  if (!positions.length || positions.length % (pointCloud ? 3 : 9))
    throw new Error("Render preparation requires complete scan coordinates.");
  const stats = pointCloud ? undefined : meshStats(positions);
  const bounds: ScanRenderData["bounds"] = stats
    ? [...stats.min, ...stats.max]
    : [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  if (pointCloud)
    for (let i = 0; i < positions.length; i += 3)
      for (let axis = 0; axis < 3; axis++) {
        const value = positions[i + axis];
        if (!Number.isFinite(value))
          throw new Error("Render coordinates must be finite.");
        bounds[axis] = Math.min(bounds[axis], value);
        bounds[axis + 3] = Math.max(bounds[axis + 3], value);
      }
  const radius = Math.hypot(
    (bounds[3] - bounds[0]) / 2,
    (bounds[4] - bounds[1]) / 2,
    (bounds[5] - bounds[2]) / 2,
  );
  const mesh =
    !pointCloud && indexedMeshMatches(indexedMesh, positions)
      ? indexedMesh
      : undefined;
  return {
    bounds,
    radius,
    stats,
    indexedMesh: mesh,
    normals: pointCloud
      ? undefined
      : mesh
        ? indexedNormals(mesh)
        : smoothDisplayNormals(positions),
  };
}

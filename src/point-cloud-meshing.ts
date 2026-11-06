import Delaunator from "delaunator";
import type { IndexedMesh, Positions } from "./types";

export const POINT_CLOUD_MESH_MAX_POINTS = 500_000;
export interface PointCloudMeshRequest {
  kind: "pointCloudMesh";
  positions: Positions;
  plane: "xy" | "xz" | "yz";
  maxEdgeLength?: number;
}

/** A projected single-valued surface; original XYZ samples supply mesh vertices. */
export function meshPointCloud(
  request: PointCloudMeshRequest,
  progress: (fraction: number, stage: string) => void = () => {},
): {
  positions: Float32Array;
  indexedMesh: IndexedMesh;
  diagnostics: Record<string, number | string | boolean>;
} {
  const { positions, plane, maxEdgeLength = 0 } = request;
  const count = positions.length / 3;
  if (
    !Number.isInteger(count) ||
    count < 3 ||
    count > POINT_CLOUD_MESH_MAX_POINTS
  )
    throw Error(
      `Projected meshing requires 3 to ${POINT_CLOUD_MESH_MAX_POINTS.toLocaleString("en-US")} points; reduce the cloud first.`,
    );
  if (!["xy", "xz", "yz"].includes(plane))
    throw Error("Choose an XY, XZ or YZ projection plane.");
  if (!Number.isFinite(maxEdgeLength) || maxEdgeLength < 0)
    throw Error("Maximum edge length must be finite and nonnegative (mm).");
  const axes = plane === "xy" ? [0, 1] : plane === "xz" ? [0, 2] : [1, 2];
  const depth = 3 - axes[0] - axes[1];
  const vertices = new Float32Array(positions.length);
  const seen = new Map<string, number>();
  const projected: number[] = [];
  const slots: number[] = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    if (i % 4096 === 0)
      progress((0.2 * i) / count, "Validating projected cloud");
    for (let a = 0; a < 3; a++) {
      const value = Math.fround(positions[i * 3 + a]);
      if (!Number.isFinite(value))
        throw Error("Point coordinates must be finite within Float32 range.");
      vertices[i * 3 + a] = value;
    }
    const x = vertices[i * 3 + axes[0]],
      y = vertices[i * 3 + axes[1]],
      z = vertices[i * 3 + depth];
    const key = `${x},${y}`,
      previous = seen.get(key);
    if (previous !== undefined) {
      if (vertices[previous * 3 + depth] !== z)
        throw Error(
          "Projection has multiple heights at the same location; choose another plane or segment a single surface.",
        );
      continue;
    }
    seen.set(key, i);
    slots.push(i);
    projected.push(x, y);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  if (slots.length < 3 || !(extent > 0))
    throw Error("Projected points are degenerate or collinear.");
  const coordinates = Float64Array.from(
    projected,
    (v, i) => (v - (i % 2 ? minY : minX)) / extent,
  );
  progress(0.25, "Triangulating projected surface");
  const candidate = new Delaunator(coordinates).triangles;
  if (!candidate.length)
    throw Error("Projected points are degenerate or collinear.");
  const output = new Uint32Array(candidate.length);
  let accepted = 0;
  for (let i = 0; i < candidate.length; i += 3) {
    if (i % 12288 === 0)
      progress(0.35 + (0.5 * i) / candidate.length, "Pruning long mesh edges");
    const ids = [
      slots[candidate[i]],
      slots[candidate[i + 1]],
      slots[candidate[i + 2]],
    ];
    if (
      maxEdgeLength > 0 &&
      ids.some((a, j) => {
        const b = ids[(j + 1) % 3];
        return (
          Math.hypot(
            vertices[a * 3] - vertices[b * 3],
            vertices[a * 3 + 1] - vertices[b * 3 + 1],
            vertices[a * 3 + 2] - vertices[b * 3 + 2],
          ) > maxEdgeLength
        );
      })
    )
      continue;
    // Normalize winding toward the positive omitted axis for all three projections.
    const [a, b, c] = ids;
    const signed =
      (vertices[b * 3 + axes[0]] - vertices[a * 3 + axes[0]]) *
        (vertices[c * 3 + axes[1]] - vertices[a * 3 + axes[1]]) -
      (vertices[b * 3 + axes[1]] - vertices[a * 3 + axes[1]]) *
        (vertices[c * 3 + axes[0]] - vertices[a * 3 + axes[0]]);
    if (signed === 0) continue;
    if (signed < 0 !== (plane === "xz")) [ids[1], ids[2]] = [ids[2], ids[1]];
    output.set(ids, accepted);
    accepted += 3;
  }
  if (!accepted)
    throw Error(
      "No triangle remains after maximum edge pruning; increase maximum edge length or choose another projection.",
    );
  const triangles = output.slice(0, accepted);
  const expanded = new Float32Array(triangles.length * 3);
  for (let i = 0; i < triangles.length; i++) {
    if (i % 12288 === 0)
      progress(
        0.85 + (0.14 * i) / triangles.length,
        "Preparing projected mesh",
      );
    expanded.set(
      vertices.subarray(triangles[i] * 3, triangles[i] * 3 + 3),
      i * 3,
    );
  }
  progress(1, "Projected point-cloud mesh complete");
  return {
    positions: expanded,
    indexedMesh: { vertices, triangles },
    diagnostics: {
      algorithm: "projected-delaunay-2.5d",
      projectionPlane: plane,
      sourcePoints: count,
      uniqueProjectedPoints: slots.length,
      duplicatePoints: count - slots.length,
      triangles: accepted / 3,
      prunedTriangles: (candidate.length - accepted) / 3,
      maxEdgeLength,
      normalsRequired: false,
      summary: `Created ${accepted / 3} projected triangles; source cloud preserved. Gaps are controlled by maximum 3D edge length.`,
    },
  };
}

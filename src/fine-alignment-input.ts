import type { Entity, IndexedMesh, Positions } from "./types";
import { indexedMeshMatches } from "./indexed-mesh";
import { alignmentTriangleMask } from "./registration-selection";

/** Bind trusted scene geometry once for both GUI and MCP fine alignment. */
export function fineAlignmentInput(
  source: Entity,
  target: Entity,
): {
  targetSurface?: IndexedMesh;
  sourceNormals?: Positions;
  targetNormals?: Positions;
} {
  if (source.id === target.id)
    throw new Error(
      "Choose a moving scan and a different fixed alignment target.",
    );
  const sourceNormals = alignedNormals(source);
  if (target.kind === "pointcloud")
    return { sourceNormals, targetNormals: alignedNormals(target) };
  if (target.positions.length % 9)
    throw new Error("Fine alignment target must contain complete triangles.");
  if (
    target.indexedMesh &&
    !indexedMeshMatches(target.indexedMesh, target.positions)
  )
    throw new Error(
      "Alignment indexed topology does not match its render geometry.",
    );
  const visible = alignmentTriangleMask(
    target.positions.length / 9,
    undefined,
    target.meshSelection?.hidden,
  );
  const mesh: IndexedMesh = target.indexedMesh ?? {
    vertices: target.positions,
    triangles: Uint32Array.from(
      { length: target.positions.length / 3 },
      (_, i) => i,
    ),
  };
  let triangles = mesh.triangles;
  if (visible) {
    const count = visible.reduce((sum, flag) => sum + (flag ? 3 : 0), 0);
    if (!count)
      throw new Error("No visible triangles in the fixed alignment target.");
    const filtered = new Uint32Array(count);
    let next = 0;
    for (let face = 0; face < visible.length; face++)
      if (visible[face])
        for (let corner = 0; corner < 3; corner++)
          filtered[next++] = triangles[face * 3 + corner];
    triangles = filtered;
  }
  return {
    sourceNormals,
    targetSurface: { vertices: mesh.vertices, triangles },
  };
}

function alignedNormals(entity: Entity): Positions | undefined {
  if (entity.normals?.length === entity.positions.length) return entity.normals;
  if (entity.kind === "pointcloud") return undefined;
  const positions = entity.positions;
  if (positions.length % 9)
    throw new Error("Fine alignment source must contain complete triangles.");
  const normals = new Float32Array(positions.length);
  for (let face = 0; face < positions.length; face += 9) {
    const ax = positions[face + 3] - positions[face],
      ay = positions[face + 4] - positions[face + 1],
      az = positions[face + 5] - positions[face + 2],
      bx = positions[face + 6] - positions[face],
      by = positions[face + 7] - positions[face + 1],
      bz = positions[face + 8] - positions[face + 2];
    const nx = ay * bz - az * by,
      ny = az * bx - ax * bz,
      nz = ax * by - ay * bx,
      length = Math.hypot(nx, ny, nz);
    if (length)
      for (let corner = 0; corner < 3; corner++) {
        normals[face + corner * 3] = nx / length;
        normals[face + corner * 3 + 1] = ny / length;
        normals[face + corner * 3 + 2] = nz / length;
      }
  }
  return normals;
}

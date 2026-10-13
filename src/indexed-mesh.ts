import type { Entity, IndexedMesh, Positions } from "./types";

export function indexedMeshMatches(
  value: unknown,
  positions: Positions,
): value is IndexedMesh {
  if (!value || typeof value !== "object") return false;
  const { vertices, triangles } = value as IndexedMesh;
  if (
    !(Array.isArray(vertices) || vertices instanceof Float32Array) ||
    !(Array.isArray(triangles) || triangles instanceof Uint32Array) ||
    !vertices.length ||
    vertices.length % 3 ||
    !triangles.length ||
    triangles.length % 3 ||
    triangles.length * 3 !== positions.length ||
    !vertices.every(Number.isFinite)
  )
    return false;
  for (let slot = 0; slot < triangles.length; slot++) {
    const id = triangles[slot];
    if (!Number.isSafeInteger(id) || id < 0 || id * 3 >= vertices.length)
      return false;
    for (let axis = 0; axis < 3; axis++)
      if (vertices[id * 3 + axis] !== positions[slot * 3 + axis]) return false;
  }
  return true;
}

/** Metadata changes retain topology; geometry edits invalidate it without touching undo snapshots. */
export function retainIndexedMesh(entity: Entity): Entity {
  return !entity.indexedMesh ||
    (entity.kind === "mesh" &&
      indexedMeshMatches(entity.indexedMesh, entity.positions))
    ? entity
    : { ...entity, indexedMesh: undefined };
}

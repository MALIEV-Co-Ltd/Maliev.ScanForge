import { indexedMeshMatches } from "./indexed-mesh";
import type { Entity, IndexedMesh } from "./types";

/** Bind only current workspace topology; callers cannot inject internal buffers. */
export function flipSourceTopology(entity: Entity): IndexedMesh | undefined {
  const mesh = entity.indexedMesh;
  if (mesh && mesh.vertices.length > 27_000_000)
    throw new Error(
      "Indexed vertices exceed the Flip Normals processing limit.",
    );
  return indexedMeshMatches(mesh, entity.positions)
    ? {
        vertices: mesh.vertices,
        triangles: mesh.triangles,
        ...(mesh.facetNormals ? { facetNormals: mesh.facetNormals } : {}),
      }
    : undefined;
}

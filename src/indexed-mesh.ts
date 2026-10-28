import type { Entity, IndexedMesh, Positions, Vec3 } from "./types";
import { transformPositions } from "./geometry";
import { allocateImportedReadonlyBuffer } from "./import-readonly-buffer";
import { meshGeometryNormals, meshFacetNormals } from "./mesh-geometry-normals";
import { isEncodingNumeric } from "./project-encoding-numeric";

/** Transform coordinates without changing source vertex IDs or face connectivity. */
export function transformIndexedMesh(
  entity: Entity,
  translation: Vec3,
  rotation: Vec3,
  scale: number,
): Pick<Entity, "positions" | "indexedMesh" | "normals"> {
  const positions = transformPositions(
    entity.positions,
    translation,
    rotation,
    scale,
  );
  const indexed = retainIndexedMesh(entity).indexedMesh;
  if (!indexed) return { positions, indexedMesh: undefined };
  // Match render rounding even when project JSON supplied a different buffer type.
  const source =
    positions instanceof Float32Array
      ? new Float32Array(indexed.vertices)
      : Array.from(indexed.vertices);
  const indexedMesh: IndexedMesh = {
    vertices: transformPositions(source, translation, rotation, scale),
    triangles: indexed.triangles,
    facetNormals: transformPositions(
      meshFacetNormals(indexed),
      [0, 0, 0],
      rotation,
      1,
    ),
    geometryNormals: transformPositions(
      meshGeometryNormals(indexed),
      [0, 0, 0],
      rotation,
      1,
    ),
    ...(indexed.normals
      ? {
          normals: transformPositions(indexed.normals, [0, 0, 0], rotation, 1),
        }
      : {}),
  };
  return { positions, indexedMesh, normals: indexedRenderNormals(indexedMesh) };
}

export function indexedMeshMatches(
  value: unknown,
  positions: Positions,
): value is IndexedMesh {
  if (!value || typeof value !== "object") return false;
  const { vertices, triangles, normals, geometryNormals, facetNormals } =
    value as IndexedMesh;
  if (
    !(
      Array.isArray(vertices) ||
      vertices instanceof Float32Array ||
      isEncodingNumeric(vertices)
    ) ||
    !(Array.isArray(triangles) || triangles instanceof Uint32Array) ||
    !vertices.length ||
    vertices.length % 3 ||
    !triangles.length ||
    triangles.length % 3 ||
    triangles.length * 3 !== positions.length ||
    !vertices.every(Number.isFinite) ||
    (normals !== undefined &&
      (!(Array.isArray(normals) || normals instanceof Float32Array) ||
        normals.length !== vertices.length ||
        !normals.every(Number.isFinite))) ||
    (geometryNormals !== undefined &&
      (!(
        Array.isArray(geometryNormals) ||
        geometryNormals instanceof Float32Array
      ) ||
        geometryNormals.length !== vertices.length)) ||
    (facetNormals !== undefined &&
      (!(Array.isArray(facetNormals) || facetNormals instanceof Float32Array) ||
        facetNormals.length !== triangles.length))
  )
    return false;
  // Indexed iteration also rejects sparse ordinary arrays: Array.every skips holes.
  if (geometryNormals)
    for (let i = 0; i < geometryNormals.length; i++)
      if (
        !Number.isFinite(geometryNormals[i]) ||
        !Number.isFinite(Math.fround(geometryNormals[i]))
      )
        return false;
  if (facetNormals)
    for (let i = 0; i < facetNormals.length; i++)
      if (
        !Number.isFinite(facetNormals[i]) ||
        !Number.isFinite(Math.fround(facetNormals[i]))
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

/** Native scan normal application rotates vectors without normalizing their magnitude. */
export function rotateIndexedNormals(
  normals: ArrayLike<number>,
  rotation: readonly number[],
): Float32Array {
  if (
    normals.length % 3 ||
    rotation.length !== 9 ||
    !rotation.every(Number.isFinite)
  )
    throw new Error(
      "Indexed normals require XYZ values and a finite rotation.",
    );
  const result = new Float32Array(normals.length);
  for (let offset = 0; offset < normals.length; offset += 3) {
    const x = normals[offset],
      y = normals[offset + 1],
      z = normals[offset + 2];
    for (let axis = 0; axis < 3; axis++)
      result[offset + axis] =
        y * rotation[axis * 3 + 1] +
        x * rotation[axis * 3] +
        z * rotation[axis * 3 + 2];
  }
  if (!result.every(Number.isFinite))
    throw new Error("Rotated indexed normals exceed Float32 precision.");
  return result;
}

/** Expand scanner vectors for display while retaining the original indexed records. */
export function indexedRenderNormals(
  mesh?: IndexedMesh,
): Positions | undefined {
  if (!mesh?.normals) return undefined;
  const output =
    mesh.normals instanceof Float32Array
      ? new Float32Array(
          allocateImportedReadonlyBuffer(mesh.triangles.length * 3 * 4, true),
        )
      : new Array<number>(mesh.triangles.length * 3);
  for (let slot = 0; slot < mesh.triangles.length; slot++)
    for (let axis = 0; axis < 3; axis++)
      output[slot * 3 + axis] = mesh.normals[mesh.triangles[slot] * 3 + axis];
  return output;
}

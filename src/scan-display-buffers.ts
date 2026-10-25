import type { ScanRenderData } from "./scan-render-data";
import type { IndexedMesh, Positions } from "./types";
import { indexedMeshMatches } from "./indexed-mesh";
import { meshGeometryNormals } from "./mesh-geometry-normals";

export interface ScanDisplayBuffers {
  positions: Positions;
  normals?: Float32Array;
  index?: Uint32Array;
  triangleSlots?: number[];
  indexed: boolean;
}

/** Corner values can share a display vertex only when every incident value agrees. */
export function indexedDisplayValues(
  values: Positions,
  mesh: IndexedMesh,
): Float64Array | undefined {
  if (values.length !== mesh.triangles.length) return;
  const output = new Float64Array(mesh.vertices.length / 3);
  const seen = new Uint8Array(output.length);
  for (let slot = 0; slot < values.length; slot++) {
    const vertex = mesh.triangles[slot];
    const value = Number.isFinite(values[slot]) ? values[slot] : NaN;
    if (
      seen[vertex] &&
      output[vertex] !== value &&
      !(Number.isNaN(output[vertex]) && Number.isNaN(value))
    )
      return;
    output[vertex] = value;
    seen[vertex] = 1;
  }
  return output;
}

/** Prepared topology owns validation; display buffers never replace authored data. */
export function scanDisplayBuffers(
  positions: Positions,
  indexedMesh: IndexedMesh | undefined,
  prepared: ScanRenderData | undefined,
  hidden: readonly number[] = [],
  forceExpanded = false,
): ScanDisplayBuffers {
  const faces = positions.length / 9;
  const hiddenFaces = new Set<number>();
  for (const face of hidden) {
    if (!Number.isInteger(face) || face < 0 || face >= faces)
      throw new RangeError("Hidden face index is outside the authored mesh.");
    hiddenFaces.add(face);
  }

  const indexedNormals =
    indexedMesh && prepared?.indexedMesh === indexedMesh
      ? prepared.normals
      : indexedMesh?.geometryNormals &&
          indexedMeshMatches(indexedMesh, positions)
        ? meshGeometryNormals(indexedMesh)
        : undefined;
  const compact =
    indexedMesh !== undefined &&
    (indexedMesh.triangles instanceof Uint32Array ||
      (Array.isArray(indexedMesh.triangles) &&
        indexedMeshMatches(indexedMesh, positions))) &&
    indexedMesh.triangles.length > 0 &&
    indexedMesh.triangles.length % 3 === 0 &&
    indexedMesh.triangles.length * 3 === positions.length &&
    indexedMesh.vertices.length > 0 &&
    indexedMesh.vertices.length % 3 === 0 &&
    indexedNormals instanceof Float32Array &&
    indexedNormals.length === indexedMesh.vertices.length;
  const indexed = compact && !forceExpanded;
  let normals: Float32Array | undefined;
  if (compact) {
    normals = indexedNormals!;
    if (forceExpanded) {
      const source = new Uint32Array(
        normals.buffer,
        normals.byteOffset,
        normals.length,
      );
      normals = new Float32Array(positions.length);
      const output = new Uint32Array(normals.buffer);
      for (let slot = 0; slot < indexedMesh.triangles.length; slot++) {
        const vertex = indexedMesh.triangles[slot] * 3;
        for (let axis = 0; axis < 3; axis++)
          output[slot * 3 + axis] = source[vertex + axis];
      }
    }
  } else if (
    !prepared?.indexedMesh &&
    prepared?.normals instanceof Float32Array &&
    prepared.normals.length === positions.length
  ) {
    normals = prepared.normals;
  }

  let index: Uint32Array | undefined;
  if (indexed)
    index =
      indexedMesh.triangles instanceof Uint32Array
        ? indexedMesh.triangles
        : Uint32Array.from(indexedMesh.triangles);
  let triangleSlots: number[] | undefined;
  if (hiddenFaces.size) {
    index = new Uint32Array((faces - hiddenFaces.size) * 3);
    triangleSlots = [];
    let offset = 0;
    for (let face = 0; face < faces; face++) {
      if (hiddenFaces.has(face)) continue;
      triangleSlots.push(face);
      for (let corner = 0; corner < 3; corner++)
        index[offset++] = indexed
          ? indexedMesh.triangles[face * 3 + corner]
          : face * 3 + corner;
    }
  }

  return {
    positions: indexed ? indexedMesh.vertices : positions,
    normals,
    index,
    triangleSlots,
    indexed,
  };
}

import * as THREE from "three";
import { weldDisplayPositions } from "./display-weld";
import type { IndexedMesh, Positions } from "./types";
import { indexedMeshMatches } from "./indexed-mesh";
/** Preserve display weld ordering and Float32 normal arithmetic with typed storage. */
export function smoothDisplayNormals(
  positions: ArrayLike<number>,
): Float32Array {
  if (!positions.length) return new Float32Array();
  const welded = weldDisplayPositions(positions);
  const geometry = new THREE.BufferGeometry();
  try {
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(welded.positions, 3),
    );
    geometry.setIndex(new THREE.BufferAttribute(welded.indices, 1));
    geometry.computeVertexNormals();
    const source = geometry.getAttribute("normal").array;
    const result = new Float32Array(positions.length);
    for (let i = 0; i < welded.indices.length; i++) {
      const v = welded.indices[i] * 3;
      result[i * 3] = source[v];
      result[i * 3 + 1] = source[v + 1];
      result[i * 3 + 2] = source[v + 2];
    }
    return result;
  } finally {
    geometry.dispose();
  }
}

/** Preserve the expanded display's weld and normals in the authored index order. */
export function smoothIndexedDisplayNormals(
  positions: Positions,
  mesh: IndexedMesh,
  verified = false,
): Float32Array {
  if (!verified && !indexedMeshMatches(mesh, positions))
    throw new Error("Display indices do not match mesh positions.");
  const welded = weldDisplayPositions(positions);
  const geometry = new THREE.BufferGeometry();
  try {
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(welded.positions, 3),
    );
    geometry.setIndex(new THREE.BufferAttribute(welded.indices, 1));
    geometry.computeVertexNormals();
    const source = geometry.getAttribute("normal").array;
    const result = new Float32Array(mesh.vertices.length);
    for (let slot = 0; slot < welded.indices.length; slot++) {
      const from = welded.indices[slot] * 3,
        to = mesh.triangles[slot] * 3;
      result[to] = source[from];
      result[to + 1] = source[from + 1];
      result[to + 2] = source[from + 2];
    }
    return result;
  } finally {
    geometry.dispose();
  }
}
export function snapSketchGrid(
  point: [number, number],
  enabled: boolean,
  spacing: number,
): [number, number] {
  return enabled && Number.isFinite(spacing) && spacing > 0
    ? (point.map((value) => Math.round(value / spacing) * spacing) as [
        number,
        number,
      ])
    : point;
}

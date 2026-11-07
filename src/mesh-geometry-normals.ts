import type { IndexedMesh } from "./types";
import { noiseNormals } from "./scan-native-noise";
import { allocateImportedReadonlyBuffer } from "./import-readonly-buffer";
import { nativeGlobalFacetNormal } from "./scan-native-global-facet-normal";

/** Read validated computed state, or initialize it on the original geometry.
 * The caller owns validation and publication; source descriptors are immutable. */
export function meshGeometryNormals(
  mesh: IndexedMesh,
  signal?: AbortSignal,
): Float32Array {
  signal?.throwIfAborted();
  if (mesh.geometryNormals instanceof Float32Array) return mesh.geometryNormals;
  if (mesh.geometryNormals) {
    const normals = new Float32Array(
      allocateImportedReadonlyBuffer(mesh.geometryNormals.length * 4, true),
    );
    normals.set(mesh.geometryNormals);
    return normals;
  }
  return noiseNormals(mesh, { signal, sharedReadonlyBuffers: true });
}

/** Reject corrupt stored state before an encoder can discard stale topology. */
export function validateMeshFacetNormals(
  mesh: IndexedMesh,
  signal?: AbortSignal,
): void {
  const stored = mesh.facetNormals;
  if (stored === undefined) return;
  if (
    !(Array.isArray(stored) || stored instanceof Float32Array) ||
    stored.length !== mesh.triangles.length
  )
    throw new Error("Computed facet normals must match the indexed triangles.");
  for (let i = 0; i < stored.length; i++) {
    if (i % 12288 === 0) signal?.throwIfAborted();
    if (!Number.isFinite(stored[i]) || !Number.isFinite(Math.fround(stored[i])))
      throw new Error("Computed facet normals require finite Float32 vectors.");
  }
}

/** Computed on original coordinates once, independently of scanner/vertex normals. */
export function meshFacetNormals(
  mesh: IndexedMesh,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Float32Array {
  signal?.throwIfAborted();
  validateMeshFacetNormals(mesh, signal);
  const stored = mesh.facetNormals;
  if (stored instanceof Float32Array) return stored;
  const output = new Float32Array(
    allocateImportedReadonlyBuffer(mesh.triangles.length * 4, true),
  );
  if (stored !== undefined) {
    output.set(stored);
    return output;
  }
  const vertices = mesh.vertices;
  const triangles =
    mesh.triangles instanceof Uint32Array
      ? mesh.triangles
      : Uint32Array.from(mesh.triangles);
  for (let face = 0; face < triangles.length / 3; face++) {
    if (face % 4096 === 0) {
      signal?.throwIfAborted();
      onProgress?.(face / (triangles.length / 3));
    }
    nativeGlobalFacetNormal(vertices, triangles, face, output, face * 3);
  }
  if (!output.every(Number.isFinite))
    throw new Error("Computed facet normals require finite Float32 vectors.");
  return output;
}

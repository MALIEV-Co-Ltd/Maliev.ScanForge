import type { IndexedMesh } from "./types";
import { noiseNormals } from "./scan-native-noise";
import { allocateImportedReadonlyBuffer } from "./import-readonly-buffer";

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

import type { ScanFile } from "./import-parser";
import { allocateImportedReadonlyBuffer } from "./import-readonly-buffer";
import {
  decodePackedPlyFaces,
  decodePackedPlyVertices,
  packedBinaryPlyLayout,
} from "./ply-binary-topology";

const MAX_CHUNK_BYTES = 1024 * 1024;
const VERTICES_PER_CHUNK = Math.floor(MAX_CHUNK_BYTES / 24);
const FACES_PER_CHUNK = Math.floor(MAX_CHUNK_BYTES / 13);

/** Only packed scanner triangles stream; other files keep the existing parser. */
export async function readPackedBinaryPly(
  file: ScanFile,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
  sharedReadonlyBuffers = false,
) {
  const check = () => {
    if (signal?.aborted)
      throw new DOMException("Import cancelled", "AbortError");
  };
  const read = async (start: number, end: number) => {
    check();
    const bytes = await file.slice(start, end).arrayBuffer();
    check();
    return bytes.byteLength === end - start ? bytes : undefined;
  };
  const progress = (fraction: number) => {
    onProgress?.(fraction);
    check();
  };
  const header = await read(0, Math.min(file.size, 65_536));
  if (!header) return;
  const layout = packedBinaryPlyLayout(header, file.size);
  if (!layout) return;
  const { headerEnd, vertexCount, faceCount } = layout;
  const faceStart = headerEnd + vertexCount * 24;

  // Preserve polygon fallback before allocating or validating any vertex values.
  for (let first = 0; first < faceCount; first += FACES_PER_CHUNK) {
    const count = Math.min(FACES_PER_CHUNK, faceCount - first);
    const bytes = await read(
      faceStart + first * 13,
      faceStart + (first + count) * 13,
    );
    if (!bytes) return;
    const view = new DataView(bytes);
    for (let face = 0; face < count; face++)
      if (view.getUint8(face * 13) !== 3) return;
    progress((0.1 * (first + count)) / faceCount);
  }

  progress(0.15);
  const vertices = new Float32Array(
    allocateImportedReadonlyBuffer(vertexCount * 12, sharedReadonlyBuffers),
  );
  const normals = new Float32Array(
    allocateImportedReadonlyBuffer(vertexCount * 12, sharedReadonlyBuffers),
  );
  const triangles = new Uint32Array(
    allocateImportedReadonlyBuffer(faceCount * 12, sharedReadonlyBuffers),
  );
  progress(0.2);
  for (let first = 0; first < vertexCount; first += VERTICES_PER_CHUNK) {
    const count = Math.min(VERTICES_PER_CHUNK, vertexCount - first);
    const bytes = await read(
      headerEnd + first * 24,
      headerEnd + (first + count) * 24,
    );
    if (!bytes) return;
    decodePackedPlyVertices(
      new DataView(bytes),
      vertices,
      normals,
      first,
      count,
    );
    progress(0.2 + (0.45 * (first + count)) / vertexCount);
  }
  for (let first = 0; first < faceCount; first += FACES_PER_CHUNK) {
    const count = Math.min(FACES_PER_CHUNK, faceCount - first);
    const bytes = await read(
      faceStart + first * 13,
      faceStart + (first + count) * 13,
    );
    if (!bytes) return;
    const view = new DataView(bytes);
    for (let face = 0; face < count; face++)
      if (view.getUint8(face * 13) !== 3) return;
    decodePackedPlyFaces(view, triangles, vertexCount, first, count);
    progress(0.65 + (0.3 * (first + count)) / faceCount);
  }
  if (!normals.every(Number.isFinite))
    throw new Error("PLY vertex normals must be finite.");
  progress(1);
  return { vertices, normals, triangles };
}

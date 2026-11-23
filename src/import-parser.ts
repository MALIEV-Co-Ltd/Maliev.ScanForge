import { parseMesh } from "./io";
import { parsePlyTopology, expandPlyTopology } from "./ply-topology";
import { nativeStlTopology } from "./scan-native-stl-topology";
import type { ScanSourceCounts } from "./scan-source";
import { readPackedBinaryPly } from "./ply-binary-file";
import type { AscAttributes } from "./asc-import";

export interface ScanFile {
  readonly size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
  arrayBuffer(): Promise<ArrayBuffer>;
}
/** Published imports may include computed state in addition to file-authored normals. */
export type ImportedIndexedMesh = ReturnType<typeof parsePlyTopology> & {
  geometryNormals?: Float32Array;
};
export interface ScanImportOptions {
  ascAttributes?: AscAttributes;
  onIndexedMesh?: (mesh: ImportedIndexedMesh) => void;
  onPointCloud?: (cloud: {
    normals?: Float32Array;
    pointColors?: Uint8Array;
  }) => void;
  onMeshNormals?: (normals: Float32Array) => void;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Optional display budget, never a file-size acceptance limit. All records are validated. */
  previewTriangles?: number;
  /** Internal worker opt-in: final indexed buffers are immutable after publication. */
  sharedReadonlyBuffers?: boolean;
  onSource?: (source: ScanSource) => void;
}
export type ScanSource = ScanSourceCounts;
const TRIANGLES_PER_CHUNK = 16_384;

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
}

/** Read binary STL in bounded chunks, retaining native connectivity at full resolution. */
export async function readScan(
  file: ScanFile,
  extension: string,
  options: ScanImportOptions = {},
): Promise<Float32Array> {
  checkAbort(options.signal);
  const sharedReadonlyBuffers =
    options.sharedReadonlyBuffers === true &&
    globalThis.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== "undefined";
  if (
    options.previewTriangles !== undefined &&
    (!Number.isSafeInteger(options.previewTriangles) ||
      options.previewTriangles < 1)
  )
    throw new Error("Preview triangle budget must be a positive integer.");
  if (extension === "stl" && file.size >= 84) {
    const header = await file.slice(0, 84).arrayBuffer();
    checkAbort(options.signal);
    if (header.byteLength !== 84) throw new Error("Truncated STL header.");
    const triangles = new DataView(header).getUint32(80, true);
    const expectedBytes = 84 + triangles * 50;
    if (expectedBytes === file.size) {
      if (!triangles) throw new Error("STL has no triangles.");
      const displayed = Math.min(
        triangles,
        options.previewTriangles ?? triangles,
      );
      let nextSample = 0;
      let positions: Float32Array;
      try {
        positions = new Float32Array(displayed * 9);
      } catch {
        throw new Error(
          "The browser could not allocate this scan's geometry. Available device memory determines import capacity.",
        );
      }
      for (let start = 0; start < triangles; start += TRIANGLES_PER_CHUNK) {
        checkAbort(options.signal);
        const count = Math.min(TRIANGLES_PER_CHUNK, triangles - start);
        const chunk = await file
          .slice(84 + start * 50, 84 + (start + count) * 50)
          .arrayBuffer();
        checkAbort(options.signal);
        if (chunk.byteLength !== count * 50)
          throw new Error("Truncated STL triangle data.");
        const view = new DataView(chunk);
        for (let triangle = 0; triangle < count; triangle++) {
          const keep =
            start + triangle ===
            Math.floor((nextSample * triangles) / displayed);
          for (let coordinate = 0; coordinate < 9; coordinate++) {
            const value = view.getFloat32(
              triangle * 50 + 12 + coordinate * 4,
              true,
            );
            if (!Number.isFinite(value))
              throw new Error("Invalid STL coordinate: values must be finite.");
            if (keep) positions[nextSample * 9 + coordinate] = value;
          }
          if (keep) nextSample++;
        }
        options.onProgress?.(
          ((start + count) / triangles) *
            (options.previewTriangles === undefined ? 0.5 : 1),
        );
      }
      checkAbort(options.signal);
      if (options.previewTriangles === undefined) {
        const indexed = nativeStlTopology(positions, {
          sharedReadonlyBuffers,
          signal: options.signal,
          onProgress: (fraction) => options.onProgress?.(0.5 + fraction * 0.45),
        });
        if (!indexed.triangles.length)
          throw new Error(
            "STL has no accepted triangles after vertex mapping.",
          );
        positions = expandPlyTopology(indexed, sharedReadonlyBuffers);
        checkAbort(options.signal);
        options.onIndexedMesh?.(indexed);
      }
      options.onSource?.({
        bytes: file.size,
        triangles,
        displayedTriangles: positions.length / 9,
        ...(options.previewTriangles === undefined
          ? { acceptedTriangles: positions.length / 9 }
          : {}),
      });
      options.onProgress?.(1);
      return positions;
    }
    // Binary headers can contain arbitrary text, including "solid". Only an
    // exact record count selects the binary path; textual STL uses the loader.
    if (
      !new TextDecoder()
        .decode(header.slice(0, 80))
        .trimStart()
        .startsWith("solid")
    )
      throw new Error(
        "Invalid binary STL length: triangle count does not match the file.",
      );
  }
  if (options.previewTriangles !== undefined)
    throw new Error(
      "Bounded preview currently supports binary STL only. Select full resolution for text STL, OBJ or PLY.",
    );
  const plyProgress = (fraction: number) => {
    if (extension === "ply") options.onProgress?.(fraction);
    checkAbort(options.signal);
  };
  const streamed =
    extension === "ply"
      ? await readPackedBinaryPly(
          file,
          options.signal,
          (fraction) => plyProgress(fraction * 0.4),
          sharedReadonlyBuffers,
        )
      : undefined;
  checkAbort(options.signal);
  const buffer = streamed ? undefined : await file.arrayBuffer();
  checkAbort(options.signal);
  let sourceNormals: Float32Array | undefined;
  const topology =
    streamed ??
    (extension === "ply"
      ? parsePlyTopology(buffer!, {
          sharedReadonlyBuffers,
          onNormals: (normals) => {
            sourceNormals = normals;
          },
        })
      : undefined);
  if (streamed) sourceNormals = streamed.normals;
  plyProgress(0.5);
  const positions = topology
    ? expandPlyTopology(topology, sharedReadonlyBuffers)
    : parseMesh(buffer!, extension);
  plyProgress(0.6);
  if (topology) options.onIndexedMesh?.(topology);
  if (topology && sourceNormals) {
    plyProgress(0.65);
    const normals = sharedReadonlyBuffers
      ? new Float32Array(new SharedArrayBuffer(positions.byteLength))
      : new Float32Array(positions.length);
    for (let slot = 0; slot < topology.triangles.length; slot++) {
      if (slot % 65536 === 0) checkAbort(options.signal);
      const vertex = topology.triangles[slot] * 3;
      normals[slot * 3] = sourceNormals[vertex];
      normals[slot * 3 + 1] = sourceNormals[vertex + 1];
      normals[slot * 3 + 2] = sourceNormals[vertex + 2];
    }
    options.onMeshNormals?.(normals);
    plyProgress(0.9);
  }
  options.onSource?.({
    bytes: file.size,
    triangles: positions.length / 9,
    displayedTriangles: positions.length / 9,
  });
  options.onProgress?.(1);
  return positions;
}

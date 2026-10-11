import { parseMesh } from "./io";

export interface ScanFile {
  readonly size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface ScanImportOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Optional display budget, never a file-size acceptance limit. All records are validated. */
  previewTriangles?: number;
  onSource?: (source: ScanSource) => void;
}
export interface ScanSource {
  bytes: number;
  triangles: number;
  displayedTriangles: number;
}
const TRIANGLES_PER_CHUNK = 16_384;

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
}

/** Read binary STL in bounded chunks directly into its final render buffer. */
export async function readScan(
  file: ScanFile,
  extension: string,
  options: ScanImportOptions = {},
): Promise<Float32Array> {
  checkAbort(options.signal);
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
        options.onProgress?.((start + count) / triangles);
      }
      options.onSource?.({
        bytes: file.size,
        triangles,
        displayedTriangles: displayed,
      });
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
  const buffer = await file.arrayBuffer();
  checkAbort(options.signal);
  const positions = parseMesh(buffer, extension);
  options.onSource?.({
    bytes: file.size,
    triangles: positions.length / 9,
    displayedTriangles: positions.length / 9,
  });
  options.onProgress?.(1);
  return positions;
}

import { parseMesh } from "./io";

export interface ScanFile {
  readonly size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface ScanImportOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
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
  if (extension === "stl" && file.size >= 84) {
    const header = await file.slice(0, 84).arrayBuffer();
    checkAbort(options.signal);
    if (header.byteLength !== 84) throw new Error("Truncated STL header.");
    const triangles = new DataView(header).getUint32(80, true);
    const expectedBytes = 84 + triangles * 50;
    if (expectedBytes === file.size) {
      if (!triangles) throw new Error("STL has no triangles.");
      let positions: Float32Array;
      try {
        positions = new Float32Array(triangles * 9);
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
          for (let coordinate = 0; coordinate < 9; coordinate++) {
            const value = view.getFloat32(
              triangle * 50 + 12 + coordinate * 4,
              true,
            );
            if (!Number.isFinite(value))
              throw new Error("Invalid STL coordinate: values must be finite.");
            positions[(start + triangle) * 9 + coordinate] = value;
          }
        }
        options.onProgress?.((start + count) / triangles);
      }
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
  const buffer = await file.arrayBuffer();
  checkAbort(options.signal);
  const positions = parseMesh(buffer, extension);
  options.onProgress?.(1);
  return positions;
}

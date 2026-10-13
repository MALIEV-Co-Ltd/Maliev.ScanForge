import type { ScanImportOptions, ScanSource } from "./import-parser";
import type { ScanUnit } from "./import-units";
/** Dedicated, cancellable import worker; its final geometry is transferred. */
export function importScan(
  file: File,
  options: ScanImportOptions & {
    unit?: ScanUnit;
    placeAtOrigin?: boolean;
  } = {},
): Promise<Float32Array> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (options.signal?.aborted)
    return Promise.reject(new DOMException("Import cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./import-worker.ts", import.meta.url), {
      type: "module",
    });
    let inactivity: ReturnType<typeof setTimeout>;
    const renewLease = () => {
      clearTimeout(inactivity);
      inactivity = setTimeout(
        () => {
          cleanup();
          reject(
            new Error(
              "Scan import stopped after ten minutes without progress. The worker was released; retry or cancel other memory-intensive work.",
            ),
          );
        },
        10 * 60 * 1000,
      );
    };
    const cleanup = () => {
      clearTimeout(inactivity);
      worker.terminate();
      options.signal?.removeEventListener("abort", abort);
      if (typeof window !== "undefined")
        window.removeEventListener("pagehide", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Import cancelled", "AbortError"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (typeof window !== "undefined")
      window.addEventListener("pagehide", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{
        progress?: number;
        positions?: Float32Array;
        source?: ScanSource;
        pointCloud?: { normals?: Float32Array };
        error?: string;
      }>,
    ) => {
      if (event.data.progress !== undefined) {
        renewLease();
        options.onProgress?.(event.data.progress);
        return;
      }
      cleanup();
      if (event.data.positions) {
        if (event.data.pointCloud)
          options.onPointCloud?.(event.data.pointCloud);
        else
          options.onSource?.(
            event.data.source ?? {
              bytes: file.size,
              triangles: event.data.positions.length / 9,
              displayedTriangles: event.data.positions.length / 9,
            },
          );
        resolve(event.data.positions);
      } else reject(new Error(event.data.error ?? "Scan import failed."));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Scan import worker failed."));
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(new Error("The browser could not transfer the imported scan."));
    };
    renewLease();
    if (options.signal?.aborted) {
      abort();
      return;
    }
    try {
      worker.postMessage({
        file,
        extension,
        previewTriangles: options.previewTriangles,
        unit: options.unit,
        placeAtOrigin: options.placeAtOrigin,
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

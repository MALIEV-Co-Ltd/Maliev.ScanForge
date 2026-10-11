import type { Positions } from "./types";
import {
  validatePatch,
  type SurfaceFitOptions,
  type SurfaceFitResult,
} from "./surfaces";

export const SURFACE_INACTIVITY_MS = 2 * 60 * 1000;
export const SURFACE_HARD_LEASE_MS = 10 * 60 * 1000;
export interface SurfaceWorkerOptions {
  signal?: AbortSignal;
  onProgress?: (status: "running") => void;
}

/** A separate per-fit worker owns its copied scan; source geometry remains attached. */
export function fitGridSurfaceAsync(
  scan: Positions,
  fitOptions: SurfaceFitOptions,
  options: SurfaceWorkerOptions = {},
): Promise<SurfaceFitResult> {
  if (options.signal?.aborted)
    return Promise.reject(
      new DOMException("Surface fit cancelled", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./surface-worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (error) {
      reject(error);
      return;
    }
    let finished = false;
    let inactivity: ReturnType<typeof setTimeout>;
    let hardLease: ReturnType<typeof setTimeout>;
    const page = typeof window !== "undefined" ? window : undefined;
    const cleanup = () => {
      clearTimeout(inactivity);
      clearTimeout(hardLease);
      options.signal?.removeEventListener("abort", abort);
      page?.removeEventListener("pagehide", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };
    const abort = () =>
      fail(new DOMException("Surface fit cancelled", "AbortError"));
    const renew = () => {
      clearTimeout(inactivity);
      inactivity = setTimeout(
        () =>
          fail(
            new Error(
              "Surface fit stopped after two minutes without progress; its worker was released.",
            ),
          ),
        SURFACE_INACTIVITY_MS,
      );
    };
    hardLease = setTimeout(
      () =>
        fail(
          new Error(
            "Surface fit exceeded its ten-minute resource lease; its worker was released.",
          ),
        ),
      SURFACE_HARD_LEASE_MS,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    page?.addEventListener("pagehide", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{
        status?: string;
        result?: SurfaceFitResult;
        error?: string;
      }>,
    ) => {
      if (finished) return;
      try {
        if (event.data.status === "running") {
          renew();
          options.onProgress?.("running");
          return;
        }
        if (!event.data.result)
          throw new Error(
            event.data.error ?? "Surface worker returned no fit.",
          );
        const result = event.data.result;
        validatePatch(result.patch);
        if (
          !Number.isFinite(result.rms) ||
          result.rms < 0 ||
          !Number.isFinite(result.maxError) ||
          result.maxError < 0 ||
          !Number.isInteger(result.samples) ||
          result.samples < 1 ||
          !Number.isFinite(result.solverBytes) ||
          result.solverBytes < 0
        )
          throw new Error("Surface worker returned invalid diagnostics.");
        finished = true;
        cleanup();
        resolve(result);
      } catch (error) {
        fail(error);
      }
    };
    worker.onerror = (event) =>
      fail(new Error(event.message || "Surface worker failed."));
    worker.onmessageerror = () =>
      fail(new Error("The browser could not transfer the fitted surface."));
    renew();
    if (options.signal?.aborted) {
      abort();
      return;
    }
    try {
      const positions =
        scan instanceof Float32Array ? scan.slice() : Float64Array.from(scan);
      if (options.signal?.aborted) {
        abort();
        return;
      }
      worker.postMessage({ positions, options: fitOptions }, [
        positions.buffer,
      ]);
    } catch (error) {
      fail(error);
    }
  });
}

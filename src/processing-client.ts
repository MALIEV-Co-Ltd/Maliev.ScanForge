import type { Positions } from "./types";
import type { ScanEditRequest, ScanEditResult } from "./scan-edit";
import type { RegistrationResult } from "./registration";
import type { RegionClassification } from "./mesh-processing";
import type { MeshSheetDiagnostics } from "./mesh-processing";
import type {
  SketchSectionOptions,
  SketchSectionResult,
} from "./sketch-section";

export type ProcessingRequest =
  | ScanEditRequest
  | {
      kind: "selectionMorphology";
      positions: Positions;
      selection: Uint8Array;
      operation: "grow" | "shrink" | "boundary";
      hidden?: number[];
    }
  | {
      kind: "sketchSection";
      positions: Positions;
      options: SketchSectionOptions;
      sourceId: string;
      hidden: number[];
      selection?: Uint8Array;
      sampled: boolean;
    }
  | {
      kind: "connectedSelection";
      allConnected?: boolean;
      positions: Positions;
      seeds: Uint8Array;
      tolerance: number;
      angleDegrees: number;
    }
  | { kind: "report"; positions: Positions; tolerance: number }
  | {
      kind: "repair";
      positions: Positions;
      tolerance: number;
      fillHoles: boolean;
      splitNonManifold?: boolean;
      planarityTolerance: number;
      maxPerimeter: number;
    }
  | {
      kind: "smooth";
      positions: Positions;
      tolerance: number;
      iterations: number;
      strength: number;
    }
  | { kind: "decimate"; positions: Positions; cellSize: number }
  | {
      kind: "segment";
      positions: Positions;
      tolerance: number;
      angleDegrees: number;
    }
  | {
      kind: "paired";
      positions: Positions;
      sourceLandmarks: number[];
      targetLandmarks: number[];
    }
  | {
      kind: "icp" | "global";
      sourceTriangleMask?: Uint8Array;
      positions: Positions;
      target: Positions;
      maxDistance: number;
      maxIterations: number;
      sampleSize: number;
      targetSampleSize: number;
      tolerance: number;
      trimFraction: number;
    };
export interface TopologySummary {
  vertices: number;
  triangles: number;
  components: number;
  boundaryLoops: number;
  boundaryChains: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  nonManifoldVertices: number;
  inconsistentEdges: number;
  degenerateTriangles: number;
  duplicateTriangles: number;
}
export interface ProcessingResult {
  scanEdit?: ScanEditResult;
  sketchSection?: SketchSectionResult;
  selection?: Uint8Array;
  kind: ProcessingRequest["kind"];
  positions?: Float32Array;
  segments?: Float32Array[];
  segmentClassifications?: RegionClassification[];
  repairSheets?: MeshSheetDiagnostics[];
  topology?: TopologySummary;
  registration?: RegistrationResult;
  diagnostics: Record<string, number | string | boolean>;
}
export type ProcessingResponse =
  | { progress: number; stage: string }
  | { result: ProcessingResult }
  | { error: string };
export interface ProcessingOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number, stage: string) => void;
}

/** Each operation owns one worker, a two-minute inactivity lease, and a fifteen-minute hard lease. */
export function processMesh(
  request: ProcessingRequest,
  options: ProcessingOptions = {},
): Promise<ProcessingResult> {
  if (options.signal?.aborted)
    return Promise.reject(
      new DOMException("Processing cancelled.", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./processing-worker.ts", import.meta.url),
      { type: "module" },
    );
    let settled = false,
      inactivity: ReturnType<typeof setTimeout>;
    const scope = globalThis as typeof globalThis & {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
    const cleanup = () => {
      clearTimeout(inactivity);
      clearTimeout(hardLease);
      options.signal?.removeEventListener("abort", abort);
      scope.removeEventListener?.("pagehide", abort);
      worker.terminate();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () =>
      fail(new DOMException("Processing cancelled.", "AbortError"));
    const renewLease = () => {
      clearTimeout(inactivity);
      inactivity = setTimeout(
        () =>
          fail(
            new Error(
              "Mesh processing stopped after two minutes without progress; its worker was released.",
            ),
          ),
        2 * 60 * 1000,
      );
    };
    const hardLease = setTimeout(
      () =>
        fail(
          new Error(
            "Mesh processing reached its fifteen-minute worker lease; retry with a smaller operation or more available memory.",
          ),
        ),
      15 * 60 * 1000,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    scope.addEventListener?.("pagehide", abort);
    worker.onmessage = (event: MessageEvent<ProcessingResponse>) => {
      if (settled) return;
      if (!event.data || typeof event.data !== "object") {
        fail(new Error("Unexpected mesh processing response."));
        return;
      }
      if ("progress" in event.data) {
        renewLease();
        try {
          options.onProgress?.(event.data.progress, event.data.stage);
        } catch (error) {
          fail(error);
        }
        return;
      }
      if ("error" in event.data) {
        fail(new Error(event.data.error));
        return;
      }
      if (!event.data.result || event.data.result.kind !== request.kind) {
        fail(new Error("Unexpected mesh processing response."));
        return;
      }
      settled = true;
      cleanup();
      resolve(event.data.result);
    };
    worker.onerror = (event) =>
      fail(new Error(event.message || "Mesh processing worker failed."));
    worker.onmessageerror = () =>
      fail(
        new Error("The browser could not decode the mesh processing result."),
      );
    renewLease();
    if (options.signal?.aborted) {
      abort();
      return;
    }
    try {
      // Transfer a dedicated copy. Scene geometry and undo history retain their original buffers.
      const transfers: Transferable[] = [];
      function clone(positions: Positions): Positions {
        const copy = positions.slice();
        if (copy instanceof Float32Array) transfers.push(copy.buffer);
        return copy;
      }
      const copied: ProcessingRequest =
        request.kind === "icp" || request.kind === "global"
          ? {
              ...request,
              positions: clone(request.positions),
              target: clone(request.target),
            }
          : { ...request, positions: clone(request.positions) };
      if (copied.kind === "scanEdit" && copied.target)
        copied.target = clone(copied.target);
      if (
        (copied.kind === "scanEdit" || copied.kind === "selectionMorphology") &&
        copied.selection
      ) {
        copied.selection = new Uint8Array(copied.selection);
        transfers.push(copied.selection.buffer);
      }
      if (copied.kind === "connectedSelection") {
        copied.seeds = new Uint8Array(copied.seeds);
        transfers.push(copied.seeds.buffer);
      }
      if (
        (copied.kind === "icp" || copied.kind === "global") &&
        copied.sourceTriangleMask
      ) {
        copied.sourceTriangleMask = new Uint8Array(copied.sourceTriangleMask);
        transfers.push(copied.sourceTriangleMask.buffer);
      }
      worker.postMessage(copied, transfers);
    } catch (error) {
      fail(error);
    }
  });
}

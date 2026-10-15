import type { Positions } from "./types";
import { cacheScanRenderData, type ScanRenderData } from "./scan-render-data";
import type { NativeSurfaceRefinementRequest } from "./native-surface-refinement";
import type {
  PointCloudEditRequest,
  PointCloudEditResult,
} from "./point-cloud-processing";
import type { ScanPreviewRequest } from "./scan-preview";
import { acquireProcessingSession } from "./processing-session";
import type { ScanToolsRequest } from "./scan-tools";
import type { ScanEditRequest, ScanEditResult } from "./scan-edit";
import type { RegistrationResult } from "./registration";
import type { RegionClassification } from "./mesh-processing";
import type { MeshSheetDiagnostics } from "./mesh-processing";
import type {
  SketchSectionOptions,
  SketchSectionResult,
} from "./sketch-section";

export type ProcessingRequest =
  | NativeSurfaceRefinementRequest
  | PointCloudEditRequest
  | ScanPreviewRequest
  | ScanToolsRequest
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
      /** Internal host route: native cloud placement is applied after solving. */
      deferCloudTransform?: true;
      sourceIndexed?: import("./types").IndexedMesh;
      refinementTargets?: {
        positions: Positions;
        indexedMesh: import("./types").IndexedMesh;
      }[];
      sourceTriangleMask?: Uint8Array;
      workerCount?: number;
      parallel?: boolean;
      positions: Positions;
      sourceLandmarks: number[];
      targetLandmarks: number[];
    }
  | {
      kind: "icp" | "global";
      deferCloudTransform?: true;
      sourceIndexed?: import("./types").IndexedMesh;
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
  /** Disposable viewport data prepared alongside mesh alignment, never authored. */
  renderData?: ScanRenderData;
  /** Host-owned native cloud pose; never serialized from the processing worker. */
  cloudPreview?: import("./types").Entity;
  indexedMesh?: import("./types").IndexedMesh;
  refinement?: ReturnType<
    typeof import("./native-surface-refinement").refineNativeSurface
  >["refinement"];
  pointCloudEdit?: PointCloudEditResult;
  scanEdit?: ScanEditResult;
  sketchSection?: SketchSectionResult;
  selection?: Uint8Array;
  kind: ProcessingRequest["kind"];
  positions?: Float32Array;
  noiseComparison?: {
    rgb: Uint8Array;
    threshold: number;
    statistics?: import("./reduction-report").ReductionStatistics;
    sampleDistances?: Float64Array;
    renderDistances?: Float32Array;
    displayRange?: number;
  };
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
  /** Geometry arrays must be immutable; replace the array after any edit. */
  reuseTopology?: boolean;
  signal?: AbortSignal;
  onProgress?: (fraction: number, stage: string) => void;
}

/** Operations have bounded execution leases; reusable topology belongs to the selected geometry. */
export function processMesh(
  request: ProcessingRequest,
  options: ProcessingOptions = {},
): Promise<ProcessingResult> {
  if (options.signal?.aborted)
    return Promise.reject(
      new DOMException("Processing cancelled.", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const createWorker = () =>
      new Worker(new URL("./processing-worker.ts", import.meta.url), {
        type: "module",
      });
    const session = options.reuseTopology
      ? acquireProcessingSession(request.positions, createWorker)
      : undefined;
    const worker = session?.worker ?? createWorker();
    let settled = false,
      inactivity: ReturnType<typeof setTimeout>;
    const scope = globalThis as typeof globalThis & {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
    const cleanup = (usable = false, successor?: Positions) => {
      clearTimeout(inactivity);
      clearTimeout(hardLease);
      options.signal?.removeEventListener("abort", abort);
      scope.removeEventListener?.("pagehide", abort);
      if (session) session.release(usable, successor);
      else worker.terminate();
    };
    const fail = (error: unknown, usable = false) => {
      if (settled) return;
      settled = true;
      cleanup(usable);
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
        fail(new Error(event.data.error), true);
        return;
      }
      if (!event.data.result || event.data.result.kind !== request.kind) {
        fail(new Error("Unexpected mesh processing response."));
        return;
      }
      settled = true;
      if (event.data.result.positions && event.data.result.renderData)
        cacheScanRenderData(
          event.data.result.positions,
          event.data.result.renderData,
        );
      cleanup(
        true,
        request.kind === "scanPreview"
          ? undefined
          : (event.data.result.pointCloudEdit?.positions ??
              event.data.result.scanEdit?.positions ??
              event.data.result.positions),
      );
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
      // A retained worker owns the canonical source and adopts edit successors.
      // Send it only on the first request; targets and masks still change per job.
      const source = session?.initialized
        ? new Float32Array(0)
        : clone(request.positions);
      const copied: ProcessingRequest =
        request.kind === "icp" ||
        request.kind === "global" ||
        request.kind === "nativeRefine"
          ? {
              ...request,
              positions: source,
              target: clone(request.target),
            }
          : { ...request, positions: source };
      if (copied.kind === "nativeRefine") {
        copied.additionalTargets = copied.additionalTargets?.map((target) => {
          const triangles = Uint32Array.from(target.indexedMesh.triangles);
          transfers.push(triangles.buffer);
          return {
            positions: clone(target.positions),
            indexedMesh: {
              vertices: clone(target.indexedMesh.vertices),
              triangles,
              ...(target.indexedMesh.normals
                ? { normals: clone(target.indexedMesh.normals) }
                : {}),
            },
          };
        });
        for (const key of ["sourceIndexed", "targetIndexed"] as const) {
          const mesh = copied[key];
          const triangles = Uint32Array.from(mesh.triangles);
          transfers.push(triangles.buffer);
          copied[key] = {
            vertices: clone(mesh.vertices),
            triangles,
            ...(mesh.normals ? { normals: clone(mesh.normals) } : {}),
          };
        }
      }
      if (copied.kind === "paired" && copied.refinementTargets) {
        copied.refinementTargets = copied.refinementTargets.map((target) => {
          const triangles = Uint32Array.from(target.indexedMesh.triangles);
          transfers.push(triangles.buffer);
          return {
            positions: clone(target.positions),
            indexedMesh: {
              vertices: clone(target.indexedMesh.vertices),
              triangles,
              ...(target.indexedMesh.normals
                ? { normals: clone(target.indexedMesh.normals) }
                : {}),
            },
          };
        });
      }
      if (
        (copied.kind === "paired" ||
          copied.kind === "icp" ||
          copied.kind === "global") &&
        copied.sourceIndexed
      ) {
        const mesh = copied.sourceIndexed;
        const triangles = Uint32Array.from(mesh.triangles);
        transfers.push(triangles.buffer);
        copied.sourceIndexed = {
          vertices: clone(mesh.vertices),
          triangles,
          ...(mesh.normals ? { normals: clone(mesh.normals) } : {}),
        };
      }
      if (copied.kind === "scanEdit" && copied.target)
        copied.target = clone(copied.target);
      if (copied.kind === "pointCloudEdit") {
        if (copied.normals) copied.normals = clone(copied.normals);
        if (copied.selection) {
          copied.selection = new Uint8Array(copied.selection);
          transfers.push(copied.selection.buffer);
        }
      }
      if (copied.kind === "scanTools") {
        copied.operation = { ...copied.operation };
        if (copied.operation.kind === "averageMesh")
          copied.operation.targets = copied.operation.targets.map(clone);
        if (
          copied.operation.kind === "reduceNoise" &&
          copied.operation.selection
        ) {
          copied.operation.selection = new Uint8Array(
            copied.operation.selection,
          );
          transfers.push(copied.operation.selection.buffer);
        }
      }
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
        (copied.kind === "paired" ||
          copied.kind === "icp" ||
          copied.kind === "global" ||
          copied.kind === "nativeRefine") &&
        copied.sourceTriangleMask
      ) {
        copied.sourceTriangleMask = new Uint8Array(copied.sourceTriangleMask);
        transfers.push(copied.sourceTriangleMask.buffer);
      }
      if (copied.kind === "nativeRefine" && copied.sourceSeedVertices) {
        copied.sourceSeedVertices = new Uint32Array(copied.sourceSeedVertices);
        transfers.push(copied.sourceSeedVertices.buffer);
      }
      worker.postMessage(
        session ? { ...copied, geometryKey: session.key } : copied,
        transfers,
      );
    } catch (error) {
      fail(error);
    }
  });
}

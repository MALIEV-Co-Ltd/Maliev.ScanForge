import type { Positions } from "./types";
import { admitAverageInputs } from "./scan-average-request";
import { reindexPointColors, validatePointColors } from "./point-cloud-colors";
import type { HoleFillProgress } from "./hole-fill-progress";
import { beginWorkingJob } from "./working-job-status";
import { cacheScanRenderData, type ScanRenderData } from "./scan-render-data";
import type { NativeSurfaceRefinementRequest } from "./native-surface-refinement";
import type {
  PointCloudEditRequest,
  PointCloudEditResult,
} from "./point-cloud-processing";
import type { ScanPreviewRequest } from "./scan-preview";
import { acquireProcessingSession } from "./processing-session";
import { queueProcessing } from "./processing-queue";
import {
  admitReconstructionRecords,
  admitReconstructionTransport,
  isBorrowableReconstructionInput,
  type ReconstructionInput,
} from "./scan-reconstruction-input";
import { yieldSpeculativePreparation } from "./speculative-mesh-preparation";
import { cacheTopologySummary } from "./scan-topology-summary";
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
      targetRms?: number;
      overlapPercent?: number;
      /** Internal native cloud output model used for final verification. */
      outputPlacement?: import("./fine-registration").FineAlignmentOptions["outputPlacement"];
      tolerance: number;
      trimFraction?: number;
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
  registration?:
    RegistrationResult | import("./fine-registration").FineAlignmentResult;
  diagnostics: Record<string, number | string | boolean>;
}
export type ProcessingResponse =
  | { progress: number; stage: string; details?: HoleFillProgress }
  | { result: ProcessingResult }
  | { error: string };
export interface ProcessingOptions {
  /** Geometry arrays must be immutable; replace the array after any edit. */
  reuseTopology?: boolean;
  /** Internal speculative diagnostics only; authored shared buffers stay immutable. */
  borrowReadonlyReportSource?: boolean;
  signal?: AbortSignal;
  onProgress?: (
    fraction: number,
    stage: string,
    details?: HoleFillProgress,
  ) => void;
}

/** Operations have bounded execution leases; reusable topology belongs to the selected geometry. */
export function processMesh(
  request: ProcessingRequest,
  options: ProcessingOptions = {},
): Promise<ProcessingResult> {
  if (
    request.kind === "scanTools" &&
    request.operation.kind === "averageMesh"
  ) {
    try {
      admitAverageInputs(
        request.positions,
        request.operation.targets,
        request.operation.sourceTopology,
        request.operation.targetTopology,
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }
  if (request.kind === "pointCloudEdit") {
    try {
      validatePointColors(request.pointColors, request.positions.length / 3);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  if (
    request.kind === "scanTools" &&
    request.operation.kind === "repolygonize"
  ) {
    try {
      if (
        request.operation.targets !== undefined &&
        request.operation.targetInputs !== undefined
      )
        throw Error("Use only one reconstruction target representation.");
      const records: ReconstructionInput[] = [
        {
          kind: request.operation.inputKind ?? "triangles",
          positions: request.positions,
        },
        ...(request.operation.targetInputs ??
          (request.operation.targets ?? []).map((positions) => ({
            kind: "triangles" as const,
            positions,
          }))),
      ];
      // Keep typed-kind validation before reducing native records to positions.
      admitReconstructionRecords(records);
      const topology = [
        request.operation.sourceTopology,
        ...(
          request.operation.targetInputs ??
          request.operation.targets ??
          []
        ).map((_, i) =>
          request.operation.kind === "repolygonize"
            ? request.operation.targetTopology?.[i]
            : undefined,
        ),
      ];
      if (
        request.operation.targetTopology &&
        request.operation.targetTopology.length !== records.length - 1
      )
        throw Error(
          "Reconstruction topology references must match its inputs.",
        );
      if (records.some((record) => record.kind === "points")) {
        if (request.operation.method === "native")
          throw Error(
            "Native reconstruction requires triangle meshes; use voxel for point inputs.",
          );
        if (topology.some(Boolean))
          throw Error(
            "Reconstruction indexed topology requires triangle inputs.",
          );
      } else if (topology.some(Boolean))
        admitReconstructionTransport(
          records.map((record) => record.positions),
          topology,
        );
    } catch (error) {
      return Promise.reject(error);
    }
    // Reconstruction reads immutable inputs once; retaining a canonical worker
    // would keep every source and target alive after the job finishes.
    options = { ...options, reuseTopology: false };
  }
  // These transforms do not consume source adjacency. Cancel only speculative
  // preparation, then keep the normal queue so its worker exits before ours starts.
  // Preview requests remain serialized on their stateful owning worker.
  if (
    !options.signal?.aborted &&
    request.kind === "scanTools" &&
    ["scaleMesh", "flipNormals", "mirrorMesh", "unroll"].includes(
      request.operation.kind,
    )
  )
    yieldSpeculativePreparation(request.positions);
  return options.reuseTopology
    ? queueProcessing(request.positions, options.signal, () =>
        runProcessingRequest(request, options),
      )
    : runProcessingRequest(request, options);
}

function processingJobLabel(request: ProcessingRequest) {
  const operation =
    request.kind === "scanEdit" || request.kind === "pointCloudEdit"
      ? request.action
      : request.kind === "scanTools"
        ? request.operation.kind
        : request.kind;
  const label =
    operation === "report"
      ? "Inspect mesh"
      : operation
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (c) => c.toUpperCase());
  return label;
}

function runProcessingRequest(
  request: ProcessingRequest,
  options: ProcessingOptions,
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
    const job = beginWorkingJob(processingJobLabel(request));
    let settled = false,
      inactivity: ReturnType<typeof setTimeout>;
    const scope = globalThis as typeof globalThis & {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
    const cleanup = (usable = false, successor?: Positions) => {
      job.finish();
      clearTimeout(inactivity);
      clearTimeout(hardLease);
      options.signal?.removeEventListener("abort", abort);
      scope.removeEventListener?.("pagehide", abort);
      if (session)
        session.release(
          usable,
          successor,
          request.kind === "scanEdit" ? request.sourceIndexed : undefined,
        );
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
          job.progress(
            event.data.progress,
            event.data.stage,
            event.data.details,
          );
          if (event.data.details)
            options.onProgress?.(
              event.data.progress,
              event.data.stage,
              event.data.details,
            );
          else options.onProgress?.(event.data.progress, event.data.stage);
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
      if (request.kind === "pointCloudEdit" && request.pointColors) {
        try {
          const edit = event.data.result.pointCloudEdit;
          if (edit?.positions) {
            if (request.action === "smooth") {
              if (edit.positions.length !== request.positions.length)
                throw new Error(
                  "Point color correspondence changed smoothing slots.",
                );
              edit.pointColors = request.pointColors;
            } else {
              if (
                !(edit.sourceIndices instanceof Uint32Array) ||
                edit.sourceIndices.length * 3 !== edit.positions.length
              )
                throw new Error(
                  "Point color correspondence requires matching source indices.",
                );
              edit.pointColors = reindexPointColors(
                request.pointColors,
                edit.sourceIndices,
                request.positions.length / 3,
              );
            }
          }
        } catch (error) {
          fail(error);
          return;
        }
      }
      settled = true;
      if (
        event.data.result.topology &&
        (request.kind === "report" ||
          (request.kind === "scanEdit" && request.action === "inventory"))
      )
        cacheTopologySummary(
          request.positions,
          request.tolerance ?? 1e-6,
          event.data.result.topology,
        );
      if (event.data.result.positions && event.data.result.renderData)
        cacheScanRenderData(
          event.data.result.positions,
          event.data.result.renderData,
        );
      cleanup(
        true,
        request.kind === "scanPreview" ||
          (request.kind === "scanEdit" && request.previewOnly)
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
      const borrowReconstruction =
        !session &&
        request.kind === "scanTools" &&
        request.operation.kind === "repolygonize";
      function clone(positions: Positions): Positions {
        if (borrowReconstruction && isBorrowableReconstructionInput(positions))
          return positions;
        const copy = positions.slice();
        if (copy instanceof Float32Array) transfers.push(copy.buffer);
        return copy;
      }
      // A retained worker owns the canonical source and adopts edit successors.
      // Send it only on the first request; targets and masks still change per job.
      const borrowedReportSource =
        !!session &&
        !session.initialized &&
        options.borrowReadonlyReportSource === true &&
        request.kind === "report" &&
        request.positions instanceof Float32Array &&
        typeof SharedArrayBuffer !== "undefined" &&
        request.positions.buffer instanceof SharedArrayBuffer;
      const source = session?.initialized
        ? new Float32Array(0)
        : borrowedReportSource
          ? request.positions
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
      if (copied.kind === "icp" && copied.outputPlacement) {
        copied.outputPlacement = {
          matrix: copied.outputPlacement.matrix.slice(),
          sourcePositions:
            copied.outputPlacement.sourcePositions === request.positions
              ? source
              : clone(copied.outputPlacement.sourcePositions),
        };
      }
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
              ...(target.indexedMesh.geometryNormals
                ? { geometryNormals: clone(target.indexedMesh.geometryNormals) }
                : {}),
              ...(target.indexedMesh.facetNormals
                ? { facetNormals: clone(target.indexedMesh.facetNormals) }
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
            ...(mesh.geometryNormals
              ? { geometryNormals: clone(mesh.geometryNormals) }
              : {}),
            ...(mesh.facetNormals
              ? { facetNormals: clone(mesh.facetNormals) }
              : {}),
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
              ...(target.indexedMesh.geometryNormals
                ? { geometryNormals: clone(target.indexedMesh.geometryNormals) }
                : {}),
              ...(target.indexedMesh.facetNormals
                ? { facetNormals: clone(target.indexedMesh.facetNormals) }
                : {}),
            },
          };
        });
      }
      if (
        (copied.kind === "paired" ||
          copied.kind === "icp" ||
          copied.kind === "global" ||
          copied.kind === "scanEdit") &&
        copied.sourceIndexed
      ) {
        const mesh = copied.sourceIndexed;
        if (copied.kind === "scanEdit" && session?.indexedSource === mesh)
          delete copied.sourceIndexed;
        else {
          const sharedConnectivity =
            copied.kind === "paired" &&
            mesh.triangles instanceof Uint32Array &&
            typeof SharedArrayBuffer !== "undefined" &&
            mesh.triangles.buffer instanceof SharedArrayBuffer;
          const triangles = sharedConnectivity
            ? (mesh.triangles as Uint32Array)
            : Uint32Array.from(mesh.triangles);
          if (triangles.buffer instanceof ArrayBuffer)
            transfers.push(triangles.buffer);
          copied.sourceIndexed = {
            vertices: clone(mesh.vertices),
            triangles,
            ...(mesh.normals ? { normals: clone(mesh.normals) } : {}),
            ...(mesh.geometryNormals
              ? { geometryNormals: clone(mesh.geometryNormals) }
              : {}),
            ...(mesh.facetNormals
              ? { facetNormals: clone(mesh.facetNormals) }
              : {}),
          };
        }
      }
      if (copied.kind === "scanEdit" && copied.target)
        copied.target = clone(copied.target);
      if (copied.kind === "pointCloudEdit") {
        // Colors stay with authored geometry; only returned slot indices need transport.
        delete copied.pointColors;
        if (copied.normals) copied.normals = clone(copied.normals);
        if (copied.selection) {
          copied.selection = new Uint8Array(copied.selection);
          transfers.push(copied.selection.buffer);
        }
      }
      if (copied.kind === "scanPreview" && copied.phase === "create") {
        copied.operation = { ...copied.operation };
        if (copied.operation.kind === "shrinkwrap") {
          copied.operation.targets = copied.operation.targets?.map(clone);
          if (copied.operation.selection) {
            copied.operation.selection = new Uint8Array(
              copied.operation.selection,
            );
            transfers.push(copied.operation.selection.buffer);
          }
        }
      }
      if (copied.kind === "scanTools") {
        copied.operation = { ...copied.operation };
        if (copied.operation.kind === "repolygonize") {
          const cloneTopology = (
            mesh: import("./types").IndexedMesh | undefined,
          ) => {
            if (!mesh) return undefined;
            const triangles = Uint32Array.from(mesh.triangles);
            transfers.push(triangles.buffer);
            return {
              ...mesh,
              vertices: clone(mesh.vertices),
              triangles,
              ...(mesh.normals ? { normals: clone(mesh.normals) } : {}),
              ...(mesh.geometryNormals
                ? { geometryNormals: clone(mesh.geometryNormals) }
                : {}),
              ...(mesh.facetNormals
                ? { facetNormals: clone(mesh.facetNormals) }
                : {}),
            };
          };
          copied.operation.sourceTopology = cloneTopology(
            copied.operation.sourceTopology,
          );
          copied.operation.targetTopology =
            copied.operation.targetTopology?.map(cloneTopology);
        }
        if (
          copied.operation.kind === "averageMesh" ||
          copied.operation.kind === "repolygonize"
        ) {
          if (copied.operation.sourceTopology) {
            const mesh = copied.operation.sourceTopology;
            const triangles = Uint32Array.from(mesh.triangles);
            transfers.push(triangles.buffer);
            copied.operation.sourceTopology = {
              vertices: clone(mesh.vertices),
              triangles,
            };
          }
          copied.operation.targetTopology =
            copied.operation.targetTopology?.map((mesh) => {
              if (!mesh) return undefined;
              const triangles = Uint32Array.from(mesh.triangles);
              transfers.push(triangles.buffer);
              return { vertices: clone(mesh.vertices), triangles };
            });
        }
        if (
          copied.operation.kind === "averageMesh" ||
          copied.operation.kind === "repolygonize" ||
          copied.operation.kind === "shrinkwrap"
        )
          copied.operation.targets = copied.operation.targets?.map(clone);
        if (copied.operation.kind === "repolygonize")
          copied.operation.targetInputs = copied.operation.targetInputs?.map(
            (r) => ({ ...r, positions: clone(r.positions) }),
          );
        if (
          (copied.operation.kind === "reduceNoise" ||
            copied.operation.kind === "shrinkwrap") &&
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
        session
          ? {
              ...copied,
              geometryKey: session.key,
              ...(borrowedReportSource ? { borrowedReportSource: true } : {}),
            }
          : copied,
        transfers,
      );
    } catch (error) {
      fail(error);
    }
  });
}

import { growConnectedSelection } from "./connected-selection";
import { preparePersistentTopology } from "./persistent-topology";
import { refineNativeSurfaceAsync } from "./native-surface-refinement";
import { indexedMeshMatches, rotateIndexedNormals } from "./indexed-mesh";
import { editPointCloud } from "./point-cloud-processing";
import { ScanPreviewSession } from "./scan-preview";
import { runScanTool } from "./scan-tools";
import {
  reduceScanNoiseAsync,
  type ScanToolResult,
} from "./scan-tools-reduction";
import { runScanEdit } from "./scan-edit";
import { SelectedSmoothingPool } from "./scan-smoothing-client";
import { SELECTED_SMOOTHING_DEFAULTS } from "./scan-selected-smooth";
import { morphTriangleSelection } from "./selection-morphology";
import { SCAN_TOPOLOGY_TOLERANCE } from "./scan-topology-tolerance";
import { extractSketchSection } from "./sketch-section";
import {
  analyzeMesh,
  classifyRegion,
  decimateMesh,
  repairMesh,
  segmentMesh,
  smoothMesh,
  type MeshTopology,
  type MeshProcessingOptions,
} from "./mesh-processing";
import {
  applyRigidTransform,
  transformPoint,
  registerIcp,
  registerGlobal,
} from "./registration";
import { registerNativeLandmarks } from "./native-landmark-registration";
import { refineNativeLandmarkAfterCoarse } from "./native-landmark-refinement";
import { nativeAlignmentOriginalVertexIndices } from "./scan-native-alignment-landmarks";
import { expandPlyTopology } from "./ply-topology";
import { prepareScanRenderData } from "./scan-render-data";
import type {
  ProcessingRequest,
  ProcessingResult,
  ProcessingResponse,
  TopologySummary,
} from "./processing-client";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ProcessingRequest>) => void) | null;
  postMessage(message: ProcessingResponse, transfers?: Transferable[]): void;
};
function summarize(topology: MeshTopology): TopologySummary {
  return {
    vertices: topology.vertices.length / 3,
    triangles: topology.triangles.length / 3,
    components: topology.components.length,
    boundaryLoops: topology.boundaryLoops.length,
    boundaryChains: topology.boundaryChains.length,
    boundaryEdges: topology.boundaryEdges,
    nonManifoldEdges: topology.nonManifoldEdges,
    nonManifoldVertices: topology.nonManifoldVertices,
    inconsistentEdges: topology.inconsistentEdges,
    degenerateTriangles: topology.degenerateTriangles,
    duplicateTriangles: topology.duplicateTriangles,
  };
}
let geometryKey: number | undefined;
let canonicalPositions: ProcessingRequest["positions"] | undefined;
let topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
const selectedSmoothing = new SelectedSmoothingPool();
let scanPreview: ScanPreviewSession | undefined;
let previewExpiry: ReturnType<typeof setTimeout> | undefined;
function preparationTolerance(request: ProcessingRequest): number | undefined {
  if (request.kind === "selectionMorphology") return SCAN_TOPOLOGY_TOLERANCE;
  if (
    request.kind === "report" ||
    request.kind === "scanEdit" ||
    request.kind === "repair" ||
    request.kind === "smooth" ||
    request.kind === "segment" ||
    request.kind === "connectedSelection"
  )
    return request.tolerance ?? 1e-6;
  // Keep transform-only and record-bounded reduction paths free of eager topology.
  if (
    request.positions.length / 9 <= 500_000 &&
    ((request.kind === "scanTools" &&
      request.operation.kind === "reduceNoise") ||
      (request.kind === "scanPreview" &&
        request.phase === "create" &&
        request.operation.kind === "reduceNoise"))
  )
    return 1e-6;
}
scope.onmessage = async ({ data: incoming }) => {
  let request = incoming;
  const key = (incoming as ProcessingRequest & { geometryKey?: number })
    .geometryKey;
  if (key === undefined || key !== geometryKey) {
    scanPreview = undefined;
    clearTimeout(previewExpiry);
    topologyCache = {};
    canonicalPositions = incoming.positions;
  } else if (canonicalPositions)
    request = { ...incoming, positions: canonicalPositions };
  geometryKey = key;
  const previousCache = { ...topologyCache };
  let lastProgress = -Infinity;
  let lastStage = "";
  function progress(fraction: number, stage: string) {
    const now = performance.now();
    if (now - lastProgress > 100 || fraction === 1 || stage !== lastStage) {
      lastProgress = now;
      lastStage = stage;
      scope.postMessage({ progress: fraction, stage });
    }
  }
  try {
    const tolerance = preparationTolerance(request);
    const persistent =
      tolerance !== undefined && typeof indexedDB !== "undefined"
        ? await preparePersistentTopology(request.positions, {
            tolerance,
            topologyCache,
            onProgress: progress,
          })
        : undefined;
    let result: ProcessingResult = { kind: request.kind, diagnostics: {} };
    if (request.kind === "nativeRefine") {
      const refined = await refineNativeSurfaceAsync(request, progress);
      Object.assign(result, refined);
      result.diagnostics = {
        algorithm: "native-surface-refinement",
        ...refined.execution,
        accepted: refined.refinement.accepted,
        initialSquaredError: refined.refinement.initialError,
        bestSquaredError: refined.refinement.best,
        iterations: refined.refinement.iterations,
        evaluationBudget: 1000,
        ...(refined.region
          ? {
              seedVertices: refined.region.seeds,
              seededFaces: refined.region.faces,
              seedGrowthPasses: refined.region.passes,
              seedFaceReferences: refined.region.faceReferences,
            }
          : {}),
      };
    } else if (request.kind === "pointCloudEdit") {
      result.pointCloudEdit = editPointCloud(request, progress);
      result.diagnostics = result.pointCloudEdit.diagnostics;
    } else if (request.kind === "scanPreview") {
      if (request.phase === "create") {
        scanPreview = undefined;
        scanPreview = await ScanPreviewSession.create(request, {
          onProgress: progress,
          topologyCache,
        });
        result.positions = scanPreview.output.slice();
        result.diagnostics.summary = scanPreview.summary;
      } else {
        if (!scanPreview || scanPreview.id !== request.previewId)
          throw new Error(
            "This mesh preview has expired. Create a new preview.",
          );
        const comparison = scanPreview.compare(
          request.deviation,
          request.paletteThreshold,
          { onProgress: progress },
          request.displayRange,
        );
        result.noiseComparison = comparison.noiseComparison;
        result.diagnostics.summary = comparison.summary;
      }
      clearTimeout(previewExpiry);
      previewExpiry = setTimeout(() => {
        scanPreview = undefined;
      }, 60_000);
    } else if (request.kind === "scanTools") {
      const options = { onProgress: progress, topologyCache };
      const outcome: ScanToolResult =
        request.operation.kind === "reduceNoise"
          ? await reduceScanNoiseAsync(request.positions, {
              ...request.operation,
              ...options,
            })
          : runScanTool(request, options);
      result.positions = outcome.positions;
      if ("noiseComparison" in outcome)
        result.noiseComparison = outcome.noiseComparison;
      result.diagnostics.summary = outcome.summary;
    } else if (request.kind === "scanEdit") {
      let selectedVertices: Float64Array<ArrayBuffer> | undefined;
      if (request.action === "smoothSelected") {
        const topology = analyzeMesh(request.positions, {
          tolerance: request.tolerance ?? 1e-6,
          onProgress: progress,
          topologyCache,
        });
        selectedVertices = await selectedSmoothing.smooth(
          topology,
          request.selection ?? new Uint8Array(),
          request.iterations ?? SELECTED_SMOOTHING_DEFAULTS.iterations,
          request.strength ?? SELECTED_SMOOTHING_DEFAULTS.strength,
          { onProgress: progress },
        );
      }
      result.scanEdit = runScanEdit(request, {
        onProgress: progress,
        topologyCache,
        selectedSmoothing: selectedVertices
          ? () => selectedVertices!
          : undefined,
      });
      result.diagnostics = result.scanEdit.diagnostics;
      if (request.action === "inventory" && topologyCache.topology)
        result.topology = summarize(topologyCache.topology);
    } else if (request.kind === "selectionMorphology") {
      result.selection = morphTriangleSelection(
        request.positions,
        request.selection,
        request.operation,
        request.hidden,
        {
          onProgress: progress,
          tolerance: SCAN_TOPOLOGY_TOLERANCE,
          topologyCache,
        },
      );
    } else if (request.kind === "sketchSection") {
      result.sketchSection = extractSketchSection(
        request.positions,
        request.options,
        request.sourceId,
        request.hidden,
        request.selection,
        request.sampled,
        progress,
      );
    } else if (request.kind === "connectedSelection") {
      result.selection = growConnectedSelection(
        request.positions,
        request.seeds,
        {
          tolerance: request.tolerance,
          angleDegrees: request.angleDegrees,
          allConnected: request.allConnected,
          onProgress: progress,
          topologyCache,
        },
      );
      result.diagnostics.selectedTriangles = result.selection.reduce(
        (count, value) => count + value,
        0,
      );
    } else if (request.kind === "report")
      result.topology = summarize(
        analyzeMesh(request.positions, {
          tolerance: request.tolerance,
          onProgress: progress,
          topologyCache,
        }),
      );
    else if (request.kind === "repair") {
      const repaired = repairMesh(request.positions, {
        ...request,
        onProgress: progress,
        topologyCache,
      });
      if (repaired.sheets) result.segments = repaired.sheets;
      else result.positions = repaired.positions;
      result.repairSheets = repaired.sheetDiagnostics;
      const total: TopologySummary = {
        vertices: 0,
        triangles: 0,
        components: 0,
        boundaryLoops: 0,
        boundaryChains: 0,
        boundaryEdges: 0,
        nonManifoldEdges: 0,
        nonManifoldVertices: 0,
        inconsistentEdges: 0,
        degenerateTriangles: 0,
        duplicateTriangles: 0,
      };
      for (const sheet of repaired.sheetDiagnostics)
        for (const key of Object.keys(total) as (keyof TopologySummary)[])
          total[key] += sheet[key];
      result.topology = total;
      result.diagnostics = {
        removedDegenerate: repaired.removedDegenerate,
        removedDuplicates: repaired.removedDuplicates,
        flippedTriangles: repaired.flippedTriangles,
        orientationConflicts: repaired.orientationConflicts,
        filledLoops: repaired.filledLoops,
        nonManifoldEdgesBefore: repaired.nonManifoldEdgesBefore,
        nonManifoldEdgesAfter: repaired.nonManifoldEdgesAfter,
        nonManifoldVerticesBefore: repaired.nonManifoldVerticesBefore,
        nonManifoldVerticesAfter: repaired.nonManifoldVerticesAfter,
        splitEdges: repaired.splitEdges,
        splitVertices: repaired.splitVertices,
        sheets: repaired.sheetDiagnostics.length,
        watertightSheets: repaired.sheetDiagnostics.filter(
          (sheet) => sheet.watertight,
        ).length,
        outwardComponents: repaired.outwardComponents,
        topologyScope:
          "Separate stored sheet objects; coincident coordinates remain distinct across objects",
        globalSelfIntersectionsChecked: false,
        skippedHoles: repaired.skippedHoles
          .map((item) => item.reason)
          .join("; "),
      };
    } else if (request.kind === "smooth") {
      result.positions = smoothMesh(request.positions, {
        ...request,
        onProgress: progress,
        topologyCache,
      });
      result.diagnostics = {
        iterations: request.iterations,
        boundaryPreserved: true,
      };
    } else if (request.kind === "decimate") {
      const reduced = decimateMesh(request.positions, {
        cellSize: request.cellSize,
        onProgress: progress,
      });
      if (!reduced.triangles)
        throw new Error(
          "Grid clustering removed every triangle; choose a smaller cell size.",
        );
      result.positions = reduced.positions;
      result.diagnostics = {
        triangles: reduced.triangles,
        removedTriangles: reduced.removedTriangles,
        maxVertexDisplacement: reduced.maxVertexDisplacement,
      };
    } else if (request.kind === "segment") {
      const segmented = segmentMesh(request.positions, {
        tolerance: request.tolerance,
        angleDegrees: request.angleDegrees,
        onProgress: progress,
        topologyCache,
      });
      const outputs = segmented.segments.map(
        (segment) => new Float32Array(segment.triangles * 9),
      );
      const cursors = new Uint32Array(outputs.length);
      for (let face = 0; face < segmented.labels.length; face++) {
        if (face % 4096 === 0)
          progress(face / segmented.labels.length, "Creating segment meshes");
        const id = segmented.labels[face],
          out = outputs[id],
          offset = cursors[id];
        for (let j = 0; j < 9; j++)
          out[offset + j] = request.positions[face * 9 + j];
        cursors[id] += 9;
      }
      result.segments = outputs;
      result.segmentClassifications = outputs.map((positions, id) => {
        progress(
          id / Math.max(1, outputs.length),
          "Classifying surface regions",
        );
        return classifyRegion(positions, {
          tolerance: request.tolerance,
          onProgress: (fraction, stage) => progress(fraction, stage),
        });
      });
      const types = result.segmentClassifications.reduce<
        Record<string, number>
      >((counts, classification) => {
        counts[classification.kind] = (counts[classification.kind] ?? 0) + 1;
        return counts;
      }, {});
      result.diagnostics = {
        segments: outputs.length,
        angleDegrees: request.angleDegrees,
        surfaceTypes: Object.entries(types)
          .map(
            ([kind, count]) =>
              `${count} ${kind === "freeform" ? "unclassified/freeform" : kind}`,
          )
          .join(", "),
      };
    } else {
      if (
        request.sourceIndexed &&
        !indexedMeshMatches(request.sourceIndexed, request.positions)
      )
        throw new Error(
          "Alignment indexed topology does not match its render geometry.",
        );
      const registration =
        request.kind === "paired"
          ? registerNativeLandmarks(
              request.sourceLandmarks,
              request.targetLandmarks,
              {
                onProgress: (fraction, rms) =>
                  progress(
                    fraction,
                    `Landmark residual ${rms.toPrecision(4)} mm`,
                  ),
              },
            )
          : (request.kind === "global" ? registerGlobal : registerIcp)(
              request.positions,
              request.target,
              {
                ...request,
                onProgress: (fraction, rms) =>
                  progress(fraction, `ICP residual ${rms.toPrecision(4)} mm`),
              },
            );
      if (
        !request.deferCloudTransform &&
        !(request.kind === "paired" && request.refinementTargets)
      )
        result.positions = applyRigidTransform(
          request.positions,
          registration.transform,
          {
            onProgress: (fraction) =>
              progress(fraction, "Applying rigid alignment"),
          },
        );
      result.registration = registration;
      if (
        request.sourceIndexed &&
        !(request.kind === "paired" && request.refinementTargets)
      ) {
        const source = request.sourceIndexed.vertices;
        const vertices = new Float32Array(source.length);
        for (let offset = 0; offset < source.length; offset += 3)
          vertices.set(
            transformPoint(
              [source[offset], source[offset + 1], source[offset + 2]],
              registration.transform,
            ),
            offset,
          );
        if (!vertices.every(Number.isFinite))
          throw new Error(
            "Transformed indexed coordinates exceed Float32 output precision.",
          );
        result.indexedMesh = {
          vertices,
          triangles: Uint32Array.from(request.sourceIndexed.triangles),
          ...(request.sourceIndexed.normals
            ? {
                normals: rotateIndexedNormals(
                  request.sourceIndexed.normals,
                  registration.transform.rotation,
                ),
              }
            : {}),
        };
      }
      result.diagnostics = {
        ...(request.kind === "paired"
          ? { algorithm: "native-landmark-registration" }
          : {}),
        rms: registration.rms,
        maxError: registration.maxError,
        converged: registration.converged,
        iterations: registration.iterations,
        pairs: registration.pairs,
      };
      if (request.kind === "paired" && request.refinementTargets) {
        if (
          !request.sourceIndexed ||
          request.refinementTargets.length > 32 ||
          request.refinementTargets.some(
            (target) =>
              !indexedMeshMatches(target.indexedMesh, target.positions),
          ) ||
          !Number.isInteger(request.workerCount ?? 2) ||
          (request.workerCount ?? 2) < 1 ||
          (request.workerCount ?? 2) > 16 ||
          (request.parallel !== undefined &&
            typeof request.parallel !== "boolean")
        )
          throw new Error(
            "Invalid indexed landmark refinement targets or workers.",
          );
        const mask = request.sourceTriangleMask;
        if (mask && mask.length !== request.sourceIndexed.triangles.length / 3)
          throw new Error(
            "Landmark selection does not match source triangles.",
          );
        const { rotation: r, translation: t } = registration.transform;
        const coarse = [
          r[0],
          r[1],
          r[2],
          t[0],
          r[3],
          r[4],
          r[5],
          t[1],
          r[6],
          r[7],
          r[8],
          t[2],
        ];
        const seeds = nativeAlignmentOriginalVertexIndices(
          Float32Array.from(request.sourceIndexed.vertices),
          Array.from(
            { length: request.sourceLandmarks.length / 3 },
            (_, id) => ({
              fixed: false,
              point: request.sourceLandmarks.slice(id * 3, id * 3 + 3) as [
                number,
                number,
                number,
              ],
            }),
          ),
        );
        const refined = await refineNativeLandmarkAfterCoarse(
          request.sourceIndexed,
          request.refinementTargets.map((target) => target.indexedMesh),
          coarse,
          seeds,
          {
            workerCount: request.workerCount ?? 2,
            parallel: request.parallel ?? true,
            faceFlags: mask
              ? Uint8Array.from(mask, (value) => (value ? 4 : 0))
              : undefined,
            onProgress: progress,
          },
        );
        result.indexedMesh = refined.indexedMesh;
        result.positions = expandPlyTopology(refined.indexedMesh);
        result.refinement = refined.refinement;
        result.selection = refined.selection;
        Object.assign(result.diagnostics, refined.diagnostics, {
          algorithm: "native-landmark-registration-and-refinement",
          seedVertices: seeds.length,
          initialRadius: 3,
          coarseRms: registration.rms,
        });
      }
      if (registration.globalCandidates !== undefined) {
        result.diagnostics.globalCandidates = registration.globalCandidates;
        result.diagnostics.coarseRms = registration.coarseRms ?? 0;
        result.diagnostics.principalAxesAmbiguous =
          registration.principalAxesAmbiguous ?? false;
      }
    }
    if (persistent) Object.assign(result.diagnostics, persistent);
    const transfers: Transferable[] = [];
    const successor =
      result.pointCloudEdit?.positions ??
      result.scanEdit?.positions ??
      result.positions;
    if (
      geometryKey !== undefined &&
      successor &&
      request.kind !== "scanPreview"
    ) {
      // Keep the worker's canonical geometry and any already-built adjacency.
      // Transferring that buffer would detach the successor cache; only the
      // dedicated scene/history copy crosses back to the main thread.
      if (topologyCache.positions !== successor) topologyCache = {};
      topologyCache.positions = successor;
      canonicalPositions = successor;
      if (result.pointCloudEdit?.positions)
        result.pointCloudEdit.positions = successor.slice();
      else if (result.scanEdit?.positions)
        result.scanEdit.positions = successor.slice();
      else result.positions = successor.slice();
    }
    if (result.pointCloudEdit?.positions)
      transfers.push(result.pointCloudEdit.positions.buffer);
    if (result.pointCloudEdit?.normals)
      transfers.push(result.pointCloudEdit.normals.buffer);
    if (result.pointCloudEdit?.selection)
      transfers.push(result.pointCloudEdit.selection.buffer);
    if (result.pointCloudEdit?.sourceIndices)
      transfers.push(result.pointCloudEdit.sourceIndices.buffer);
    if (result.scanEdit?.positions)
      transfers.push(result.scanEdit.positions.buffer);
    if (result.scanEdit?.selection)
      transfers.push(result.scanEdit.selection.buffer);
    for (const segment of result.scanEdit?.segments ?? [])
      transfers.push(segment.buffer);
    if (result.selection) transfers.push(result.selection.buffer);
    // Preserve the existing weld-based display normals, but never perform their
    // welding/statistics on the UI thread when the aligned mesh is displayed.
    if (
      request.kind === "paired" &&
      request.sourceIndexed &&
      result.positions
    ) {
      progress(0.99, "Preparing aligned mesh display");
      result.renderData = prepareScanRenderData(result.positions);
      if (result.renderData.normals)
        transfers.push(result.renderData.normals.buffer as ArrayBuffer);
    }
    if (result.positions) transfers.push(result.positions.buffer);
    if (result.indexedMesh?.vertices instanceof Float32Array)
      transfers.push(result.indexedMesh.vertices.buffer);
    if (result.indexedMesh?.normals instanceof Float32Array)
      transfers.push(result.indexedMesh.normals.buffer);
    if (result.indexedMesh?.triangles instanceof Uint32Array)
      transfers.push(result.indexedMesh.triangles.buffer);
    if (result.noiseComparison)
      transfers.push(result.noiseComparison.rgb.buffer);
    if (result.noiseComparison?.sampleDistances)
      transfers.push(result.noiseComparison.sampleDistances.buffer);
    if (result.noiseComparison?.renderDistances)
      transfers.push(result.noiseComparison.renderDistances.buffer);
    for (const segment of result.segments ?? []) transfers.push(segment.buffer);
    scope.postMessage({ result }, transfers);
  } catch (error) {
    // A rejected edit may have analyzed temporary geometry. Never reinterpret
    // that temporary mesh as the next request's original input.
    if (topologyCache.positions !== canonicalPositions)
      topologyCache = previousCache;
    scope.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

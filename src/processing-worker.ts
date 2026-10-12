import { growConnectedSelection } from "./connected-selection";
import { runScanTool } from "./scan-tools";
import { runScanEdit } from "./scan-edit";
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
  registerIcp,
  registerGlobal,
  registerPairedPoints,
} from "./registration";
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
scope.onmessage = ({ data: incoming }) => {
  let request = incoming;
  const key = (incoming as ProcessingRequest & { geometryKey?: number })
    .geometryKey;
  if (key === undefined || key !== geometryKey) {
    topologyCache = {};
    canonicalPositions = incoming.positions;
  } else if (canonicalPositions)
    request = { ...incoming, positions: canonicalPositions };
  geometryKey = key;
  const previousCache = { ...topologyCache };
  let lastProgress = -Infinity;
  function progress(fraction: number, stage: string) {
    const now = performance.now();
    if (now - lastProgress > 100 || fraction === 1) {
      lastProgress = now;
      scope.postMessage({ progress: fraction, stage });
    }
  }
  try {
    let result: ProcessingResult = { kind: request.kind, diagnostics: {} };
    if (request.kind === "scanTools") {
      const outcome = runScanTool(request, {
        onProgress: progress,
        topologyCache,
      });
      result.positions = outcome.positions;
      result.diagnostics.summary = outcome.summary;
    } else if (request.kind === "scanEdit") {
      result.scanEdit = runScanEdit(request, {
        onProgress: progress,
        topologyCache,
      });
      result.diagnostics = result.scanEdit.diagnostics;
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
      const registration =
        request.kind === "paired"
          ? registerPairedPoints(
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
      result.positions = applyRigidTransform(
        request.positions,
        registration.transform,
        {
          onProgress: (fraction) =>
            progress(fraction, "Applying rigid alignment"),
        },
      );
      result.registration = registration;
      result.diagnostics = {
        rms: registration.rms,
        maxError: registration.maxError,
        converged: registration.converged,
        iterations: registration.iterations,
        pairs: registration.pairs,
      };
      if (registration.globalCandidates !== undefined) {
        result.diagnostics.globalCandidates = registration.globalCandidates;
        result.diagnostics.coarseRms = registration.coarseRms ?? 0;
        result.diagnostics.principalAxesAmbiguous =
          registration.principalAxesAmbiguous ?? false;
      }
    }
    const transfers: Transferable[] = [];
    const successor = result.scanEdit?.positions ?? result.positions;
    if (geometryKey !== undefined && successor) {
      // Keep the worker's canonical geometry and any already-built adjacency.
      // Transferring that buffer would detach the successor cache; only the
      // dedicated scene/history copy crosses back to the main thread.
      if (topologyCache.positions !== successor) topologyCache = {};
      topologyCache.positions = successor;
      canonicalPositions = successor;
      if (result.scanEdit?.positions)
        result.scanEdit.positions = successor.slice();
      else result.positions = successor.slice();
    }
    if (result.scanEdit?.positions)
      transfers.push(result.scanEdit.positions.buffer);
    if (result.scanEdit?.selection)
      transfers.push(result.scanEdit.selection.buffer);
    for (const segment of result.scanEdit?.segments ?? [])
      transfers.push(segment.buffer);
    if (result.selection) transfers.push(result.selection.buffer);
    if (result.positions) transfers.push(result.positions.buffer);
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

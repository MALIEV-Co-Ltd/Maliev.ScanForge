import type { Positions, Vec3 } from "./types";
import type { MeshProcessingOptions } from "./mesh-processing";
import { analyzeMesh } from "./mesh-processing";
import { compareReductionSurface } from "./scan-reduction-comparison";
import { linearProgress } from "./reduction-report";
import {
  reduceScanMesh,
  reduceScanNoise,
  repolygonizeScanMesh,
  type ScanToolResult,
} from "./scan-tools-reduction";
import {
  scaleScanMesh,
  flipScanNormals,
  averageScanMesh,
  mirrorScanMesh,
  unrollScanMesh,
} from "./scan-tools-transforms";

export type ScanToolOperation =
  | {
      kind: "reducePolygons";
      mode: "triangles" | "percentage" | "deviation";
      targetTriangles?: number;
      percentage?: number;
      deviation?: number;
      measureDeviation?: boolean;
      paletteThreshold?: number;
    }
  | {
      kind: "reduceNoise";
      iterations?: number;
      deviation?: number;
      selectionOnly?: boolean;
      applyBoundaryEdges?: boolean;
      measureDeviation?: boolean;
      selection?: Uint8Array;
    }
  | { kind: "scaleMesh"; factor: number; center?: Vec3 }
  | { kind: "flipNormals" }
  | { kind: "repolygonize"; resolution?: number; targets?: Positions[] }
  | { kind: "averageMesh"; targets: Positions[]; tolerance?: number }
  | { kind: "mirrorMesh"; center: Vec3; normal: Vec3; tangent?: Vec3 }
  | {
      kind: "unroll";
      center: Vec3;
      axis: Vec3;
      radius: number;
      offsetDegrees?: number;
    };
export interface ScanToolsRequest {
  kind: "scanTools";
  positions: Positions;
  operation: ScanToolOperation;
}
export function runScanTool(
  request: ScanToolsRequest,
  options: MeshProcessingOptions = {},
): ScanToolResult {
  const { positions, operation } = request;
  switch (operation.kind) {
    case "reducePolygons":
      return reducePolygonsWithComparison(positions, operation, options);
    case "reduceNoise":
      return reduceScanNoise(positions, { ...operation, ...options });
    case "repolygonize":
      return repolygonizeScanMesh(positions, { ...operation, ...options });
    case "scaleMesh":
      return scaleScanMesh(positions, { ...operation, ...options });
    case "flipNormals":
      return flipScanNormals(positions, options);
    case "averageMesh":
      return averageScanMesh(positions, { ...operation, ...options });
    case "mirrorMesh":
      return mirrorScanMesh(positions, { ...operation, ...options });
    case "unroll":
      return unrollScanMesh(positions, { ...operation, ...options });
    default:
      throw new Error("Unsupported Scan Data tool.");
  }
}

function reducePolygonsWithComparison(
  positions: Positions,
  operation: Extract<ScanToolOperation, { kind: "reducePolygons" }>,
  options: MeshProcessingOptions,
) {
  const measure = operation.measureDeviation ?? false;
  const tolerance = operation.deviation ?? 0.05;
  const paletteThreshold = operation.paletteThreshold ?? 0.05;
  if (
    measure &&
    [tolerance, paletteThreshold].some(
      (value) =>
        !Number.isFinite(Math.fround(value)) || Math.fround(value) <= 0,
    )
  )
    throw new Error(
      "Comparison thresholds must be positive finite Float32 values.",
    );
  const progress = linearProgress(options.onProgress);
  const result = reduceScanMesh(positions, {
    ...operation,
    ...options,
    onProgress: progress(0, measure ? 0.8 : 1),
  });
  if (!measure) return result;
  const original = analyzeMesh(positions, {
    ...options,
    tolerance: 1e-6,
    onProgress: progress(0.8, 0.85),
  });
  // The comparison constructor needs facet coordinates, not another welded
  // topology. Preserve every published triangle and its order directly.
  const reducedIndices = new Uint32Array(result.positions.length / 3);
  for (let corner = 0; corner < reducedIndices.length; corner++) {
    if (corner % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    reducedIndices[corner] = corner;
  }
  const comparison = compareReductionSurface(
    original.vertices,
    { coordinates: result.positions, indices: reducedIndices },
    tolerance,
    paletteThreshold,
    {
      ...options,
      onProgress: progress(0.85, 0.98),
    },
  );
  const rgb = new Uint8Array(positions.length);
  for (let corner = 0; corner < original.triangles.length; corner++) {
    if (corner % 4096 === 0)
      progress(0.98, 1)(
        corner / original.triangles.length,
        "Preparing deviation display",
      );
    if (corner % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const vertex = original.triangles[corner];
    rgb.set(comparison.rgb.subarray(vertex * 3, vertex * 3 + 3), corner * 3);
  }
  if (options.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  const rangeLabel = Number((Math.fround(paletteThreshold) * 5).toPrecision(6));
  progress(1, 1)(1, "Reduction and comparison complete");
  return {
    ...result,
    noiseComparison: {
      rgb,
      threshold: Math.fround(paletteThreshold),
      statistics: {
        ...comparison.statistics,
        originalTriangles: positions.length / 9,
        reducedTriangles: result.positions.length / 9,
      },
    },
    summary:
      result.summary +
      ` Original-to-surface comparison: ${comparison.percentage.toFixed(2)}% (${comparison.within}/${comparison.total}) within ${tolerance} mm; ${comparison.total - comparison.matched} unmatched beyond the ${rangeLabel} mm search radius.`,
  };
}

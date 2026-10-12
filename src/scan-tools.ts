import type { Positions, Vec3 } from "./types";
import type { MeshProcessingOptions } from "./mesh-processing";
import {
  reduceScanMesh,
  reduceScanNoise,
  repolygonizeScanMesh,
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
  | { kind: "repolygonize"; resolution?: number }
  | { kind: "averageMesh"; targets: Positions[]; tolerance?: number }
  | { kind: "mirrorMesh"; center: Vec3; normal: Vec3 }
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
) {
  const { positions, operation } = request;
  switch (operation.kind) {
    case "reducePolygons":
      return reduceScanMesh(positions, { ...operation, ...options });
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

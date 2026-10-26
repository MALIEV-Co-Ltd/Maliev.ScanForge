import type { MeshProcessingOptions } from "./mesh-processing";

export type ReconstructionVector = number[] | Float32Array | Float64Array;
export interface ReconstructionTriangle {
  vertices: Float32Array[];
  normal: Float32Array;
  boundaryEdges: number;
}
export interface ReconstructionSource extends Iterable<ReconstructionTriangle> {
  length: number;
  vertexFlags?: Uint32Array;
}
export interface ReconstructionSample {
  distance: number;
  direction: Float32Array;
  boundary: boolean;
}
export interface ReconstructionCorner {
  point: number[];
  sampledPoint: Float32Array;
  samples: (ReconstructionSample | undefined)[];
  lastTriangleId: number;
  frontierId: number;
  distance: number;
  direction: Float64Array;
  contributionCount: number;
}
export interface ReconstructionNode {
  bounds: Float64Array;
  center: number[];
  depth: number;
  children: ReconstructionNode[] | null;
  corners: ReconstructionCorner[] | null;
  frontierId?: number;
}
export interface ReconstructionFrontier {
  id: number;
  root: ReconstructionNode;
  corners: Map<string, ReconstructionCorner>;
}
export interface ReconstructionLimits {
  nodes: number;
  corners: number;
  candidates: number;
  vertices: number;
  triangles: number;
}
export interface ReconstructionFieldOptions extends MeshProcessingOptions {
  bounds: Float32Array;
  spacing: number;
  sources: ReconstructionSource[];
  initialDirection: number[];
  origin: number[];
  limits: ReconstructionLimits;
  frontierMode?: "single" | "partitioned";
}
export interface ReconstructionIndexed {
  positions: Float32Array;
  indices: Uint32Array;
}
export interface ReconstructionFace {
  vertices: number[];
  normal: Float32Array;
  neighbors: (ReconstructionFace | null)[];
  neighborSlots: number[];
  flags: number;
}
export interface ReconstructionRecords {
  positions: Float32Array;
  triangles: ReconstructionFace[];
}
export interface ReconstructionBoundary {
  start: number;
  end: number;
  vertexId: number;
  triangle: ReconstructionFace;
}

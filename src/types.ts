export type Vec3 = [number, number, number];
import type { NurbsPatch } from "./surfaces";
import type { Sketch } from "./sketch";
import type { ParametricFeature } from "./parametric";
export type Positions = number[] | Float32Array;
/** Triangle slots refer to the current triangulation and must be sorted and unique. */
export interface MeshSelectionState {
  hidden: number[];
  saved: { id: string; name: string; triangles: number[] }[];
}
export type EntityKind =
  "mesh" | "cad" | "plane" | "sphere" | "cylinder" | "cone" | "box";
export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  positions: Positions;
  /** Display normals evaluated from exact CAD surfaces, aligned to triangle vertices. */
  normals?: number[];
  /** Paired world-space points sampled from exact CAD topological edges. */
  edgePositions?: number[];
  color: string;
  visible: boolean;
  opacity: number;
  meshSelection?: MeshSelectionState;
  // Geometry is stored in world coordinates in millimetres.
  source?: string;
  /** Source counts for sampled imports; project geometry contains only the display sample. */
  scanSource?: { bytes: number; triangles: number; displayedTriangles: number };
  kernelId?: string;
  brep?: string;
  fit?: FitResult;
  surfacePatch?: NurbsPatch;
  surfaceScanId?: string;
  /** Authoring recipe and output slot travel with entity history and project files. */
  parametric?: { feature: ParametricFeature; output: number };
}
export interface FitResult {
  kind: "plane" | "sphere" | "cylinder" | "cone";
  center: Vec3;
  axis: Vec3;
  radius?: number;
  topRadius?: number;
  height?: number;
  rms: number;
  maxError: number;
}
export interface MeshStats {
  vertices: number;
  triangles: number;
  area: number;
  volume: number;
  min: Vec3;
  max: Vec3;
  size: Vec3;
  center: Vec3;
}
export interface SectionResult {
  segments: number[];
  length: number;
}
export interface Project {
  format: "maliev-scanforge";
  version: 1;
  name: string;
  units: "mm";
  entities: Entity[];
  authoring?: {
    sketch?: Sketch;
    sketches?: SavedSketch[];
    activeSketchId?: string;
  };
}
export interface SavedSketch {
  id: string;
  name: string;
  sketch: Sketch;
}
export type KernelPrimitive =
  | { kind: "box"; center: Vec3; size: Vec3 }
  | { kind: "sphere"; center: Vec3; radius: number }
  | {
      kind: "cylinder";
      center: Vec3;
      axis: Vec3;
      radius: number;
      height: number;
    }
  | {
      kind: "cone";
      center: Vec3;
      axis: Vec3;
      radius: number;
      topRadius: number;
      height: number;
    };
export interface KernelMesh {
  kernelId: string;
  positions: number[];
  normals?: number[];
  edgePositions?: number[];
  brep?: string;
}

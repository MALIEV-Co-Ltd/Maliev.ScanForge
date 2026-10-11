export type Vec3 = [number, number, number];
export type Positions = number[] | Float32Array;
export type EntityKind =
  "mesh" | "cad" | "plane" | "sphere" | "cylinder" | "cone" | "box";
export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  positions: Positions;
  color: string;
  visible: boolean;
  opacity: number;
  // Geometry is stored in world coordinates in millimetres.
  source?: string;
  kernelId?: string;
  brep?: string;
  fit?: FitResult;
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
  brep?: string;
}

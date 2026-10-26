export type Vec3 = [number, number, number];
import type { NurbsPatch } from "./surfaces";
import type { Sketch } from "./sketch";
import type { SketchFrame } from "./sketch-frame";
import type { ParametricFeature } from "./parametric";
import type { ScanSourceCounts } from "./scan-source";
import type { ReferenceEntityData } from "./reference-entity";
export type Positions = number[] | Float32Array;
export interface IndexedMesh {
  vertices: Positions;
  triangles: number[] | Uint32Array;
  /** Scanner normals in original vertex order, including unused vertices. */
  normals?: Positions;
  /** Stored computed geometry normals, distinct from scanner-authored vectors. */
  geometryNormals?: Positions;
  /** Stored computed XYZ normal per triangle; rigid setters rotate this state. */
  facetNormals?: Positions;
}
/** Triangle slots refer to the current triangulation and must be sorted and unique. */
export interface MeshSelectionState {
  hidden: number[];
  saved: { id: string; name: string; triangles: number[] }[];
}
export type EntityKind =
  | "mesh"
  | "pointcloud"
  | "cad"
  | "plane"
  | "sphere"
  | "cylinder"
  | "cone"
  | "box"
  | "referencePoint"
  | "referenceLine"
  | "referenceFrame";
export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  positions: Positions;
  /** Stable raw ordering identity, assigned only in an accepted transaction. */
  constructionOrderKey?: string;
  /** Authoritative reference geometry and recipe; positions is empty for these kinds. */
  reference?: ReferenceEntityData;
  /** One authoritative rigid coordinate system; rendered axes are derived, positions empty. */
  coordinateFrame?: { version: 1; frame: SketchFrame; displaySize: number };
  /** Baked cylindrical mapping retained with Unroll's hidden tangent frame. */
  rollMapping?: import("./scan-unroll-auxiliary").RollMapping;
  /** Immutable local cloud buffers and native accumulated pose; positions remains a world-space view. */
  pointCloudPlacement?: {
    matrixBits: string;
    sourcePositions: Positions;
    sourceNormals?: Positions;
  };
  /** Original indexed import topology, valid only while it matches render positions. */
  indexedMesh?: IndexedMesh;
  /** CAD display normals or imported scanner normals, aligned to XYZ positions. */
  normals?: Positions;
  /** Opaque RGBA bytes in point order; colors do not change under cloud poses. */
  pointColors?: Uint8Array;
  /** Screen-space point diameter in pixels (1–10); unset uses 1 px. */
  pointSize?: number;
  /** Display-only adaptive sampling; unset enables automatic density. */
  pointAutoDensity?: boolean;
  /** Adaptive screen coverage, 10–100 percent; unset uses 100. */
  pointDensity?: number;
  /** Unset uses imported RGB when available, otherwise the object color. */
  pointColorMode?: "source" | "solid";
  /** Explicit interpretation selected when importing ASC records. */
  ascAttributes?: "xyz-normal" | "xyz-rgb";
  /** Paired world-space points sampled from exact CAD topological edges. */
  edgePositions?: number[];
  color: string;
  visible: boolean;
  /** Unset preserves selectable, unlocked behavior in older project files. */
  selectable?: boolean;
  locked?: boolean;
  opacity: number;
  meshSelection?: MeshSelectionState;
  // Geometry is stored in world coordinates in millimetres.
  source?: string;
  /** Source and accepted counts distinguish preview sampling from facet rejection. */
  scanSource?: ScanSourceCounts;
  kernelId?: string;
  brep?: string;
  fit?: FitResult;
  /** Persistent construction-plane orientation, including rotation about its normal. */
  planeFrame?: { center: Vec3; normal: Vec3; tangent: Vec3 };
  surfacePatch?: NurbsPatch;
  surfaceScanId?: string;
  /** Stable authoring identity and resolved links retained after a recipe is baked. */
  authoringLinks?: { featureId: string; output: number; references: string[] };
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
    inspections?: import("./inspection-definition").SavedInspection[];
    sketch?: Sketch;
    sketches?: SavedSketch[];
    activeSketchId?: string;
  };
}
export interface SavedSketch {
  id: string;
  name: string;
  sketch: Sketch;
  /** Saved display independent of the active sketch edit session; unset is hidden. */
  visible?: boolean;
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
  planeFrame?: Entity["planeFrame"];
}

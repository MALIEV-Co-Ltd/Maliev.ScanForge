import {
  fitSpatialBoundaries,
  type SpatialBoundaryCurve,
} from "./scan-boundary-spatial";
import { holeListOrder } from "./scan-hole-order";
import { holeBoundaryDiameters } from "./scan-hole-diameter";
import type { Positions, Vec3 } from "./types";
import {
  analyzeMesh,
  analyzeIndexedMesh,
  type MeshProcessingOptions,
  type MeshTopology,
} from "./mesh-processing";
import { runHoleFill, runHoleFillAsync } from "./scan-edit-holes";
import { runDefeature } from "./scan-defeature";
import { splitByPlane } from "./scan-edit-split";
import { runFiniteSplitCandidate } from "./scan-split-finite-candidate";
import { indexedMeshMatches } from "./indexed-mesh";
import { simplifyBoundaryCurve } from "./scan-boundary-simplify";
import {
  runBoundarySmooth,
  runBoundarySmoothAsync,
} from "./scan-boundary-smooth";
import {
  SELECTED_SMOOTHING_DEFAULTS,
  smoothSelectedVertices,
} from "./scan-selected-smooth";

export interface ScanEditOptions extends MeshProcessingOptions {
  /** Internal worker hook; never part of a serialized edit request. */
  selectedSmoothing?: typeof smoothSelectedVertices;
}

export interface ScanEditRequest {
  kind: "scanEdit";
  /** Internal read-only worker request; never adopts preview geometry. */
  previewOnly?: boolean;
  /** Trusted application binding, never caller-supplied MCP geometry. */
  sourceIndexed?: import("./types").IndexedMesh;
  positions: Positions;
  action:
    | "inventory"
    | "componentExtract"
    | "componentKeep"
    | "componentRemove"
    | "componentFlip"
    | "fillHoles"
    | "boundarySmooth"
    | "boundaryProject"
    | "boundarySpatialSketch"
    | "smoothSelected"
    | "defeature"
    | "split";
  selection?: Uint8Array;
  indices?: number[];
  algorithm?:
    "automatic" | "flat" | "tangent" | "curvature" | "surfaceRecovery";
  mode?: "entire" | "partial" | "bridge";
  start?: number;
  end?: number;
  /** Destination inventory boundary for a bridge; defaults to the start boundary. */
  endBoundary?: number;
  diameter?: number;
  /** Native multiple-hole Tangent path, separate from selected-hole algorithms. */
  batch?: boolean;
  strength?: number;
  /** Zero-based boundary and point indices from the current scan inventory. */
  anchors?: { boundary: number; point: number }[];
  iterations?: number;
  plane?: { origin: Vec3; normal: Vec3 };
  target?: Positions;
  /** Trusted binding for sampled non-mesh cutters; not an MCP parameter. */
  targetIsNonMesh?: boolean;
  tolerance?: number;
  fitTolerance?: number;
}
export interface ScanEditInventory {
  /** Closed boundary indices in descending displayed-size order. */
  holeOrder?: number[];
  components: { triangles: number[]; area: number }[];
  boundaries: {
    points: number[];
    triangles: number[];
    closed: boolean;
    diameter: number;
    length: number;
  }[];
}
export interface ScanEditResult {
  positions?: Positions;
  /** Internal indexed successor topology matching positions, when available. */
  indexedMesh?: import("./types").IndexedMesh;
  segments?: Positions[];
  /** Internal indexed topology corresponding to each segment, when available. */
  segmentIndexedMeshes?: (import("./types").IndexedMesh | undefined)[];
  selection?: Uint8Array;
  inventory?: ScanEditInventory;
  curves?: number[][];
  spatialCurves?: SpatialBoundaryCurve[];
  diagnostics: Record<string, number | string | boolean>;
}
export const pointAt = (p: ArrayLike<number>, i: number): Vec3 => [
  p[i * 3],
  p[i * 3 + 1],
  p[i * 3 + 2],
];
export const subtract = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const crossProduct = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dotProduct = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const edgeId = (a: number, b: number) =>
  a < b ? `${a}:${b}` : `${b}:${a}`;
export function checkProgress(
  o: MeshProcessingOptions,
  f: number,
  stage: string,
) {
  if (o.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  o.onProgress?.(f, stage);
}
export function finiteOutput(values: ArrayLike<number>): Float32Array {
  const output = new Float32Array(values);
  if (output.some((v) => !Number.isFinite(v)))
    throw new Error("Coordinates exceed Float32 output precision.");
  return output;
}

function componentOutput(values: number[]): Positions {
  if (values.some((value) => !Number.isFinite(value)))
    throw new Error("Component coordinates must be finite.");
  return values.some((value) => !Object.is(value, Math.fround(value)))
    ? values
    : finiteOutput(values);
}

/** Preserve source vertex identity when publishing a selected face subset. */
function componentIndex(
  source: { vertices: ArrayLike<number>; triangles: ArrayLike<number> },
  faces: readonly number[],
  flipped: ReadonlySet<number>,
  options: MeshProcessingOptions,
  float32: boolean,
): import("./types").IndexedMesh | undefined {
  if (!faces.length) return undefined;
  const ids = new Map<number, number>(),
    vertices: number[] = [];
  const triangles = new Uint32Array(faces.length * 3);
  let slot = 0;
  for (const face of faces) {
    if ((slot & 4095) === 0 && options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const order = flipped.has(face) ? [0, 2, 1] : [0, 1, 2];
    for (const corner of order) {
      const sourceId = source.triangles[face * 3 + corner];
      let id = ids.get(sourceId);
      if (id === undefined) {
        id = ids.size;
        ids.set(sourceId, id);
        vertices.push(
          source.vertices[sourceId * 3],
          source.vertices[sourceId * 3 + 1],
          source.vertices[sourceId * 3 + 2],
        );
      }
      triangles[slot++] = id;
    }
  }
  return {
    vertices: float32 ? new Float32Array(vertices) : vertices,
    triangles,
  };
}
export function inventoryOf(
  t: MeshTopology,
  signal?: AbortSignal,
): ScanEditInventory {
  const diameters = holeBoundaryDiameters(t, signal);
  return {
    components: t.components.map((triangles) => ({
      triangles,
      area: triangles.reduce((a, f) => {
        const [p, q, r] = [0, 1, 2].map((c) =>
          pointAt(t.vertices, t.triangles[f * 3 + c]),
        );
        return (
          a + Math.hypot(...crossProduct(subtract(q, p), subtract(r, p))) / 2
        );
      }, 0),
    })),
    boundaries: [
      ...t.boundaryLoops.map((ids) => ({ ids, closed: true })),
      ...t.boundaryChains.map((ids) => ({ ids, closed: false })),
    ].map(({ ids, closed }, index) => {
      const points = ids.flatMap((id) => pointAt(t.vertices, id));
      const faces = new Set<number>();
      let length = 0;
      ids.forEach((id, i) => {
        const p = pointAt(t.vertices, id);
        if (i < ids.length - 1 || closed) {
          const next = ids[(i + 1) % ids.length];
          length += Math.hypot(...subtract(pointAt(t.vertices, next), p));
          for (const use of t.edges.get(edgeId(id, next)) ?? [])
            faces.add(use.face);
        }
      });
      return {
        points,
        triangles: [...faces],
        closed,
        diameter: diameters[index],
        length,
      };
    }),
  };
}
function selectedIndices(
  indices: number[] | undefined,
  count: number,
): number[] {
  const result = indices ?? Array.from({ length: count }, (_, i) => i);
  if (result.some((i) => !Number.isInteger(i) || i < 0 || i >= count))
    throw new Error("Selection index is outside the mesh inventory.");
  return [...new Set(result)];
}
function smoothing(
  r: ScanEditRequest,
  t: MeshTopology,
  o: ScanEditOptions,
): Positions {
  const strength = r.strength ?? SELECTED_SMOOTHING_DEFAULTS.strength,
    iterations = r.iterations ?? SELECTED_SMOOTHING_DEFAULTS.iterations;
  if (
    !Number.isFinite(strength) ||
    strength <= 0 ||
    strength > 1 ||
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > 100
  )
    throw new Error("Smoothing needs strength in (0,1] and 1–100 iterations.");
  if (!r.selection?.some(Boolean))
    throw new Error("Select triangles to smooth.");
  const vertices = (o.selectedSmoothing ?? smoothSelectedVertices)(
    t,
    r.selection,
    iterations,
    strength,
    o,
  );
  return publishSmoothedVertices(r, t, vertices, o);
}

/** Shared raw-corner and topology publication for both smoothing operations. */
export function publishSmoothedVertices(
  r: ScanEditRequest,
  t: MeshTopology,
  vertices: Float64Array,
  o: MeshProcessingOptions,
  triangles: Uint32Array = t.triangles,
  sourceCorners?: Uint32Array,
): Positions {
  const precise =
    Array.isArray(r.positions) &&
    r.positions.some((value) => !Object.is(value, Math.fround(value)));
  const expanded: Positions = precise
    ? new Array<number>(triangles.length * 3)
    : new Float32Array(triangles.length * 3);
  for (let corner = 0; corner < triangles.length; corner++) {
    const vertex = triangles[corner] * 3;
    const moved =
      Math.fround(vertices[vertex]) !== Math.fround(t.vertices[vertex]) ||
      Math.fround(vertices[vertex + 1]) !==
        Math.fround(t.vertices[vertex + 1]) ||
      Math.fround(vertices[vertex + 2]) !== Math.fround(t.vertices[vertex + 2]);
    // Welded adjacency must not normalize raw corners on untouched vertices.
    for (let axis = 0; axis < 3; axis++)
      expanded[corner * 3 + axis] = moved
        ? vertices[vertex + axis]
        : r.positions[(sourceCorners?.[corner] ?? corner) * 3 + axis];
  }
  const positions = precise ? expanded : finiteOutput(expanded);
  if (positions.some((value) => !Number.isFinite(value)))
    throw new Error("Smoothed coordinates must be finite.");
  // Moving vertices preserves their indexed connectivity. Refresh geometric
  // diagnostics at output precision without rewelding the successor mesh.
  if (
    o.topologyCache &&
    (positions.length !== r.positions.length ||
      positions.some((value, index) => !Object.is(value, r.positions[index])))
  ) {
    const cachedVertices = Float64Array.from(vertices, Math.fround);
    if (precise)
      for (let i = 0; i < cachedVertices.length; i += 3) {
        const moved =
          cachedVertices[i] !== Math.fround(t.vertices[i]) ||
          cachedVertices[i + 1] !== Math.fround(t.vertices[i + 1]) ||
          cachedVertices[i + 2] !== Math.fround(t.vertices[i + 2]);
        if (!moved)
          for (let axis = 0; axis < 3; axis++)
            cachedVertices[i + axis] = t.vertices[i + axis];
      }
    const topology = analyzeIndexedMesh(
      cachedVertices,
      triangles,
      { ...o, onProgress: undefined },
      triangles === t.triangles ? t.edges : undefined,
    );
    o.topologyCache.positions = positions;
    o.topologyCache.tolerance = o.tolerance ?? 1e-6;
    o.topologyCache.topology = topology;
  }
  return positions;
}
function scanEdit(
  r: ScanEditRequest,
  options: ScanEditOptions,
  fill: typeof runHoleFill | typeof runHoleFillAsync,
  boundarySmooth: typeof runBoundarySmooth | typeof runBoundarySmoothAsync,
): ScanEditResult | Promise<ScanEditResult> {
  if (
    r.anchors !== undefined &&
    (r.action !== "boundarySmooth" || !Array.isArray(r.anchors))
  )
    throw new Error(
      "Anchors are supported only for boundary smoothing and must be an array.",
    );
  if (r.anchors && r.anchors.length > 2)
    throw new Error("At most two boundary anchors are currently supported.");
  if (
    r.anchors?.length === 2 &&
    r.anchors[0] &&
    r.anchors[1] &&
    (r.anchors[0].boundary !== r.anchors[1].boundary ||
      r.anchors[0].point === r.anchors[1].point)
  )
    throw new Error(
      "Two anchors must identify distinct points on the same boundary.",
    );
  if (
    r.batch !== undefined &&
    (typeof r.batch !== "boolean" || r.action !== "fillHoles")
  )
    throw new Error(
      "Batch is supported only for hole filling and must be boolean.",
    );
  if (
    ![
      "inventory",
      "componentExtract",
      "componentKeep",
      "componentRemove",
      "componentFlip",
      "fillHoles",
      "boundarySmooth",
      "boundaryProject",
      "boundarySpatialSketch",
      "smoothSelected",
      "defeature",
      "split",
    ].includes(r.action)
  )
    throw new Error("Unknown scan edit action.");
  let phaseStart = 0,
    phaseSpan = 0.35,
    lastFraction = 0;
  const o = {
    ...options,
    tolerance: r.tolerance ?? options.tolerance,
    onProgress:
      r.action === "defeature"
        ? (fraction: number, stage: string) => {
            lastFraction = Math.max(
              lastFraction,
              phaseStart + Math.min(fraction, 1) * phaseSpan,
            );
            options.onProgress?.(
              lastFraction,
              `Defeature: ${stage.replace(/Hole filling complete/i, "Seam triangulation ready").replace(/complete/gi, "ready")}`,
            );
          }
        : options.onProgress,
  };
  const count = r.positions.length / 9;
  if (
    r.selection &&
    (r.selection.length !== count ||
      r.selection.some((v) => v !== 0 && v !== 1))
  )
    throw new Error(
      "Triangle selection mask must contain one 0 or 1 per triangle.",
    );
  if (r.action === "split" && r.target && !r.plane && !r.targetIsNonMesh) {
    const cutterTopology = analyzeMesh(r.target, {
      ...o,
      topologyCache: undefined,
      onProgress: undefined,
    });
    if (cutterTopology.degenerateTriangles || cutterTopology.nonManifoldEdges)
      throw new Error(
        "Split cutter must contain nondegenerate manifold triangles.",
      );
    if (r.sourceIndexed && !indexedMeshMatches(r.sourceIndexed, r.positions))
      throw new Error("Scan edit indices do not match the source geometry.");
    const indexed = r.sourceIndexed
      ? {
          vertices: r.sourceIndexed.vertices,
          triangles:
            r.sourceIndexed.triangles instanceof Uint32Array
              ? r.sourceIndexed.triangles
              : Uint32Array.from(r.sourceIndexed.triangles),
        }
      : undefined;
    const result = runFiniteSplitCandidate(r.positions, r.target, indexed, {
      preciseCoordinates: true,
      outputMode: "single-mesh",
      selection: r.selection,
      tolerance: o.tolerance,
      signal: o.signal,
      onProgress: o.onProgress,
      maxTypedBytesPerStage: 1024 * 1024 * 1024,
    });
    return {
      ...(result.diagnostics.cutEdges ? result.mesh : {}),
      diagnostics: {
        ...result.diagnostics,
        changed: result.diagnostics.cutEdges > 0,
      },
    };
  }
  let t: MeshTopology;
  const cached = o.topologyCache?.topology;
  const cachedIndexMatches =
    r.sourceIndexed &&
    cached &&
    cached.triangles.length === r.sourceIndexed.triangles.length &&
    cached.vertices.length === r.sourceIndexed.vertices.length &&
    cached.triangles.every(
      (value, i) => value === r.sourceIndexed!.triangles[i],
    ) &&
    cached.vertices.every((value, i) => value === r.sourceIndexed!.vertices[i]);
  if (
    r.sourceIndexed &&
    (!o.topologyCache ||
      o.topologyCache.positions !== r.positions ||
      !cachedIndexMatches ||
      o.topologyCache.tolerance !== (o.tolerance ?? 1e-6))
  ) {
    if (!indexedMeshMatches(r.sourceIndexed, r.positions))
      throw new Error("Scan edit indices do not match the source geometry.");
    t = analyzeIndexedMesh(
      Float64Array.from(r.sourceIndexed.vertices),
      Uint32Array.from(r.sourceIndexed.triangles),
      o,
    );
    if (o.topologyCache) {
      o.topologyCache.positions = r.positions;
      o.topologyCache.tolerance = o.tolerance ?? 1e-6;
      o.topologyCache.topology = t;
    }
  } else t = analyzeMesh(r.positions, o);
  checkProgress(o, 0, "Preparing scan edit");
  if (r.action === "inventory") {
    const inventory = inventoryOf(t, o.signal);
    inventory.holeOrder = holeListOrder(inventory.boundaries);
    return {
      inventory,
      diagnostics: {
        components: inventory.components.length,
        boundaries: inventory.boundaries.length,
        holes: t.boundaryLoops.length,
      },
    };
  }
  if (r.action === "fillHoles") return fill(r, t, o);
  if (r.action === "split") return splitByPlane(r, o);
  if (r.action === "boundarySmooth") return boundarySmooth(r, t, o);
  if (r.action === "smoothSelected")
    return {
      positions: smoothing(r, t, o),
      diagnostics: {
        method: "Selected vertex averaging with concave boundary relaxation",
      },
    };
  if (r.action === "boundarySpatialSketch") {
    if (r.selection)
      throw new Error(
        "Spatial boundary sketches use boundary indices, not triangle selection.",
      );
    const spatialCurves = fitSpatialBoundaries(
      t,
      r.indices,
      r.fitTolerance ?? 0.05,
      o,
    );
    return {
      spatialCurves,
      diagnostics: { fittedBoundaries: spatialCurves.length },
    };
  }
  if (r.action === "boundaryProject") {
    const inventory = inventoryOf(t, o.signal);
    if (!r.plane) throw new Error("Choose a projection plane.");
    const { origin, normal } = r.plane,
      n2 = dotProduct(normal, normal);
    if (![...origin, ...normal].every(Number.isFinite) || n2 === 0)
      throw new Error("Projection plane must be finite with a nonzero normal.");
    const curves = selectedIndices(r.indices, inventory.boundaries.length).map(
      (i) => {
        const b = inventory.boundaries[i],
          out: number[] = [];
        for (let j = 0; j < b.points.length; j += 3) {
          const p = pointAt(b.points, j / 3),
            d = dotProduct(subtract(p, origin), normal) / n2;
          out.push(...p.map((v, a) => v - d * normal[a]));
        }
        if (b.closed) out.push(...out.slice(0, 3));
        return r.fitTolerance === undefined
          ? out
          : simplifyBoundaryCurve(out, r.fitTolerance);
      },
    );
    return { curves, diagnostics: { projectedBoundaries: curves.length } };
  }
  if (r.action === "defeature") {
    phaseStart = 0.35;
    phaseSpan = 0.6;
    const result = runDefeature(r, t, o);
    checkProgress(options, 1, "Defeature complete");
    return result;
  }
  const selected = new Set(
    selectedIndices(r.indices, t.components.length).flatMap(
      (i) => t.components[i],
    ),
  );
  let cachedMatches = t.triangles.length * 3 === r.positions.length;
  for (let slot = 0; cachedMatches && slot < t.triangles.length; slot++) {
    if ((slot & 4095) === 0 && o.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const vertex = t.triangles[slot] * 3,
      corner = slot * 3;
    cachedMatches =
      t.vertices[vertex] === r.positions[corner] &&
      t.vertices[vertex + 1] === r.positions[corner + 1] &&
      t.vertices[vertex + 2] === r.positions[corner + 2];
  }
  const indexed = indexedMeshMatches(r.sourceIndexed, r.positions)
    ? r.sourceIndexed
    : cachedMatches
      ? { vertices: t.vertices, triangles: t.triangles }
      : undefined;
  if (r.action === "componentExtract") {
    const groups = selectedIndices(r.indices, t.components.length).map((i) =>
      [...t.components[i]].sort((a, b) => a - b),
    );
    const segments = groups.map((faces) =>
      componentOutput(
        faces.flatMap((f) => Array.from(r.positions.slice(f * 9, f * 9 + 9))),
      ),
    );
    return {
      segments,
      ...(indexed
        ? {
            segmentIndexedMeshes: groups.map((faces, index) =>
              componentIndex(
                indexed,
                faces,
                new Set<number>(),
                o,
                segments[index] instanceof Float32Array,
              ),
            ),
          }
        : {}),
      diagnostics: {
        extractedComponents: groups.length,
      },
    };
  }
  const out: number[] = [],
    faces: number[] = [];
  for (let f = 0; f < count; f++) {
    if (
      (r.action === "componentKeep" && !selected.has(f)) ||
      (r.action === "componentRemove" && selected.has(f))
    )
      continue;
    const face = Array.from(r.positions.slice(f * 9, f * 9 + 9));
    if (r.action === "componentFlip" && selected.has(f))
      face.splice(3, 6, ...face.slice(6, 9), ...face.slice(3, 6));
    out.push(...face);
    faces.push(f);
  }
  checkProgress(o, 1, "Scan edit complete");
  const positions = componentOutput(out);
  return {
    positions,
    ...(indexed && faces.length
      ? {
          indexedMesh: componentIndex(
            indexed,
            faces,
            r.action === "componentFlip" ? selected : new Set<number>(),
            o,
            positions instanceof Float32Array,
          ),
        }
      : {}),
    diagnostics: { triangles: out.length / 9 },
  };
}

export function runScanEdit(
  r: ScanEditRequest & {
    action: Exclude<ScanEditRequest["action"], "split">;
    positions: Float32Array;
  },
  options?: ScanEditOptions,
): Omit<ScanEditResult, "positions"> & { positions?: Float32Array };
export function runScanEdit(
  r: ScanEditRequest,
  options?: ScanEditOptions,
): ScanEditResult;
export function runScanEdit(
  r: ScanEditRequest,
  options: ScanEditOptions = {},
): ScanEditResult {
  return scanEdit(r, options, runHoleFill, runBoundarySmooth) as ScanEditResult;
}

export async function runScanEditAsync(
  r: ScanEditRequest,
  options: ScanEditOptions = {},
): Promise<ScanEditResult> {
  return scanEdit(r, options, runHoleFillAsync, runBoundarySmoothAsync);
}

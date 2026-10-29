import { weldMeshPositions } from "./mesh-weld";
import type { HoleFillProgress } from "./hole-fill-progress";
import { MeshEdgeIndex } from "./mesh-edge-index";
import { MeshFaceIndex, vertexIncidence } from "./mesh-face-index";
import type { FitResult, Positions, Vec3 } from "./types";
import { fitPlane, fitSphere, fitCylinder, fitCone } from "./geometry";

/** Operations allocate an indexed topology proportional to mesh size. Run in a worker for large scans. */
export interface MeshProcessingOptions {
  topologyCache?: {
    positions?: Positions;
    tolerance?: number;
    topology?: MeshTopology;
    /** Immutable polygon-preview samples; no diagnostic adjacency is implied. */
    reductionSource?: Pick<MeshTopology, "vertices" | "triangles">;
  };
  tolerance?: number;
  signal?: AbortSignal;
  onProgress?: (
    fraction: number,
    stage: string,
    details?: HoleFillProgress,
  ) => void;
}
export interface EdgeUse {
  face: number;
  from: number;
  to: number;
}
export interface MeshTopology {
  vertices: Float64Array;
  triangles: Uint32Array;
  /** Immutable directory. Edits must retain earlier edge-use snapshots. */
  edges: ReadonlyMap<string, EdgeUse[]>;
  neighbors: number[][];
  components: number[][];
  boundaryLoops: number[][];
  boundaryChains: number[][];
  nonManifoldEdges: number;
  nonManifoldVertices: number;
  inconsistentEdges: number;
  degenerateTriangles: number;
  duplicateTriangles: number;
  boundaryEdges: number;
}
function checkpoint(
  options: MeshProcessingOptions,
  fraction: number,
  stage: string,
) {
  if (options.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  options.onProgress?.(fraction, stage);
}
function validate(positions: Positions, tolerance: number) {
  if (!positions.length || positions.length % 9)
    throw new Error("Expected complete triangle coordinates.");
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Weld tolerance must be positive and finite.");
  for (let i = 0; i < positions.length; i++)
    if (!Number.isFinite(positions[i]))
      throw new Error("Mesh coordinates must be finite.");
}
const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
function point(vertices: ArrayLike<number>, id: number): Vec3 {
  return [vertices[id * 3], vertices[id * 3 + 1], vertices[id * 3 + 2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function normal(topology: MeshTopology, face: number): Vec3 {
  const a = point(topology.vertices, topology.triangles[face * 3]);
  const b = point(topology.vertices, topology.triangles[face * 3 + 1]);
  const c = point(topology.vertices, topology.triangles[face * 3 + 2]);
  const n = cross(sub(b, a), sub(c, a));
  const length = Math.hypot(...n);
  return length ? [n[0] / length, n[1] / length, n[2] / length] : [0, 0, 0];
}

/** Weld by Euclidean distance to the first matching representative, searching all 27 neighboring cells. */
export function analyzeMesh(
  positions: Positions,
  options: MeshProcessingOptions = {},
): MeshTopology {
  const tolerance = options.tolerance ?? 1e-6;
  const cache = options.topologyCache;
  if (
    cache?.positions === positions &&
    cache.tolerance === tolerance &&
    cache.topology
  ) {
    checkpoint(options, 0, "Reusing mesh topology");
    return cache.topology;
  }
  validate(positions, tolerance);
  checkpoint(options, 0, "Welding vertices");
  const { vertices, triangles } = weldMeshPositions(
    positions,
    tolerance,
    (fraction) => checkpoint(options, 0.45 * fraction, "Welding vertices"),
  );
  const topology = analyzeIndexedMesh(vertices, triangles, options);
  if (cache && (!cache.positions || cache.positions === positions)) {
    cache.positions = positions;
    cache.tolerance = tolerance;
    cache.topology = topology;
  }
  return topology;
}

/** Preserve vertex identity across edits. Existing edge uses can be reused without welding or rebuilding adjacency. */
export function analyzeIndexedMesh(
  vertices: Float64Array,
  triangles: Uint32Array,
  options: MeshProcessingOptions = {},
  existingEdges?: ReadonlyMap<string, EdgeUse[]>,
): MeshTopology {
  const tolerance = options.tolerance ?? 1e-6;
  const index = existingEdges ? undefined : new MeshEdgeIndex(triangles);
  const edges = existingEdges ?? index!;
  const neighbors = Array.from(
    { length: triangles.length / 3 },
    () => [] as number[],
  );
  let degenerateTriangles = 0,
    duplicateTriangles = 0;
  const seen = new MeshFaceIndex(triangles);
  for (let face = 0; face < neighbors.length; face++) {
    if (face % 4096 === 0)
      checkpoint(
        options,
        0.45 + (0.3 * face) / neighbors.length,
        existingEdges ? "Refreshing mesh diagnostics" : "Building topology",
      );
    const ids = [
      triangles[face * 3],
      triangles[face * 3 + 1],
      triangles[face * 3 + 2],
    ];
    if (seen.add(face)) duplicateTriangles++;
    const a = ids[0] * 3,
      b = ids[1] * 3,
      c = ids[2] * 3;
    const abx = vertices[b] - vertices[a],
      aby = vertices[b + 1] - vertices[a + 1],
      abz = vertices[b + 2] - vertices[a + 2],
      acx = vertices[c] - vertices[a],
      acy = vertices[c + 1] - vertices[a + 1],
      acz = vertices[c + 2] - vertices[a + 2];
    if (
      ids[0] === ids[1] ||
      ids[1] === ids[2] ||
      ids[2] === ids[0] ||
      Math.hypot(
        aby * acz - abz * acy,
        abz * acx - abx * acz,
        abx * acy - aby * acx,
      ) <=
        tolerance * tolerance
    ) {
      degenerateTriangles++;
      continue;
    }
    for (let k = 0; !existingEdges && k < 3; k++) {
      index!.addCorner(face * 3 + k);
    }
  }
  let nonManifoldEdges = 0,
    inconsistentEdges = 0,
    boundaryEdges = 0;
  const boundary = new Map<number, number[]>();
  for (const uses of edges.values()) {
    if (uses.length > 2) nonManifoldEdges++;
    if (uses.length === 2 && uses[0].from === uses[1].from) inconsistentEdges++;
    // Nonmanifold edges connect components, but must not propagate segmentation or orientation.
    for (let j = 1; j < uses.length; j++) {
      neighbors[uses[0].face].push(uses[j].face);
      neighbors[uses[j].face].push(uses[0].face);
    }
    if (uses.length === 1) {
      boundaryEdges++;
      const { from, to } = uses[0];
      for (const [v, w] of [
        [from, to],
        [to, from],
      ]) {
        const list = boundary.get(v);
        if (list) list.push(w);
        else boundary.set(v, [w]);
      }
    }
  }
  const components: number[][] = [];
  const visited = new Uint8Array(neighbors.length);
  for (let start = 0; start < neighbors.length; start++)
    if (!visited[start]) {
      const component = [start];
      visited[start] = 1;
      for (let q = 0; q < component.length; q++) {
        if (q % 4096 === 0)
          checkpoint(
            options,
            0.75 + (0.2 * start) / neighbors.length,
            "Finding connected components",
          );
        for (const next of neighbors[component[q]])
          if (!visited[next]) {
            visited[next] = 1;
            component.push(next);
          }
      }
      components.push(component);
    }
  const boundaryLoops: number[][] = [],
    boundaryChains: number[][] = [];
  const used = new Set<string>();
  for (const [start, adjacent] of boundary)
    for (const initial of adjacent) {
      if (used.has(edgeKey(start, initial))) continue;
      const chain = [start];
      let previous = start,
        current = initial;
      let closed = false;
      for (;;) {
        used.add(edgeKey(previous, current));
        chain.push(current);
        if (current === start) {
          closed = true;
          break;
        }
        const nexts = boundary.get(current) ?? [];
        if (nexts.length !== 2 || (boundary.get(start)?.length ?? 0) !== 2)
          break;
        const next = nexts.find((id) => id !== previous);
        if (next === undefined || used.has(edgeKey(current, next))) break;
        previous = current;
        current = next;
      }
      if (closed) {
        chain.pop();
        boundaryLoops.push(chain);
      } else boundaryChains.push(chain);
    }
  const incident = vertexIncidence(triangles, vertices.length / 3);
  let nonManifoldVertices = 0;
  for (let vertex = 0; vertex < vertices.length / 3; vertex++) {
    if (vertex % 4096 === 0)
      checkpoint(options, 0.95, "Checking vertex surface fans");
    const link = new Map<number, Set<number>>();
    for (
      let entry = incident.offsets[vertex];
      entry < incident.offsets[vertex + 1];
      entry++
    ) {
      const face = incident.faces[entry];
      const ids = [
        triangles[face * 3],
        triangles[face * 3 + 1],
        triangles[face * 3 + 2],
      ].filter((id) => id !== vertex);
      if (ids.length !== 2 || ids[0] === ids[1]) continue;
      for (const [a, b] of [
        [ids[0], ids[1]],
        [ids[1], ids[0]],
      ]) {
        let neighbors = link.get(a);
        if (!neighbors) {
          neighbors = new Set();
          link.set(a, neighbors);
        }
        neighbors.add(b);
      }
    }
    if (!link.size) continue;
    const queue = [link.keys().next().value!],
      seen = new Set(queue);
    for (let q = 0; q < queue.length; q++)
      for (const next of link.get(queue[q]) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    const degrees = [...link.values()].map((neighbors) => neighbors.size),
      endpoints = degrees.filter((degree) => degree === 1).length;
    if (
      seen.size !== link.size ||
      degrees.some((degree) => degree > 2) ||
      (endpoints !== 0 && endpoints !== 2)
    )
      nonManifoldVertices++;
  }
  checkpoint(options, 1, "Topology complete");
  const topology = {
    vertices,
    triangles,
    edges,
    neighbors,
    components,
    boundaryLoops,
    boundaryChains,
    nonManifoldEdges,
    nonManifoldVertices,
    inconsistentEdges,
    degenerateTriangles,
    duplicateTriangles,
    boundaryEdges,
  };
  return topology;
}

export interface OrientationResult {
  positions: Float32Array;
  flippedTriangles: number;
  conflicts: number;
  topology: MeshTopology;
  outwardComponents: number;
}
/** Consistent winding per manifold component; global outward direction is not inferred for open shells. */
export function repairOrientation(
  positions: Positions,
  options: MeshProcessingOptions = {},
): OrientationResult {
  const topology = analyzeMesh(positions, options);
  const parity = new Int8Array(topology.neighbors.length);
  parity.fill(-1);
  const adjacency = Array.from(
    { length: parity.length },
    () => [] as { face: number; flip: boolean }[],
  );
  for (const uses of topology.edges.values())
    if (uses.length === 2) {
      const flip = uses[0].from === uses[1].from;
      adjacency[uses[0].face].push({ face: uses[1].face, flip });
      adjacency[uses[1].face].push({ face: uses[0].face, flip });
    }
  let conflicts = 0,
    flippedTriangles = 0,
    outwardComponents = 0;
  for (let start = 0; start < parity.length; start++)
    if (parity[start] < 0) {
      const queue = [start];
      const previousConflicts = conflicts;
      parity[start] = 0;
      for (let q = 0; q < queue.length; q++) {
        if (q % 4096 === 0)
          checkpoint(options, q / parity.length, "Repairing winding");
        const face = queue[q];
        for (const next of adjacency[face]) {
          const expected = parity[face] ^ Number(next.flip);
          if (parity[next.face] < 0) {
            parity[next.face] = expected;
            queue.push(next.face);
          } else if (parity[next.face] !== expected && face < next.face)
            conflicts++;
        }
      }
      const closed =
        previousConflicts === conflicts &&
        queue.every((face) => {
          const ids = [
            topology.triangles[face * 3],
            topology.triangles[face * 3 + 1],
            topology.triangles[face * 3 + 2],
          ];
          return ids.every(
            (from, corner) =>
              topology.edges.get(edgeKey(from, ids[(corner + 1) % 3]))
                ?.length === 2,
          );
        });
      if (closed) {
        const origin = point(
          topology.vertices,
          topology.triangles[queue[0] * 3],
        );
        let volume = 0;
        for (const face of queue) {
          const a = sub(
              point(topology.vertices, topology.triangles[face * 3]),
              origin,
            ),
            b = sub(
              point(topology.vertices, topology.triangles[face * 3 + 1]),
              origin,
            ),
            c = sub(
              point(topology.vertices, topology.triangles[face * 3 + 2]),
              origin,
            );
          volume += ((parity[face] ? -1 : 1) * dot(a, cross(b, c))) / 6;
        }
        if (volume < -((options.tolerance ?? 1e-6) ** 3)) {
          for (const face of queue) parity[face] ^= 1;
          outwardComponents++;
        }
      }
    }
  const result = new Float32Array(positions);
  for (let face = 0; face < parity.length; face++)
    if (parity[face]) {
      flippedTriangles++;
      const offset = face * 9;
      for (let axis = 0; axis < 3; axis++) {
        const temp = result[offset + 3 + axis];
        result[offset + 3 + axis] = result[offset + 6 + axis];
        result[offset + 6 + axis] = temp;
      }
    }
  ensureFloat32(result);
  checkpoint(options, 1, "Winding repaired");
  return {
    positions: result,
    flippedTriangles,
    conflicts,
    topology,
    outwardComponents,
  };
}
function ensureFloat32(positions: Float32Array) {
  for (const value of positions)
    if (!Number.isFinite(value))
      throw new Error("Coordinates exceed Float32 output precision.");
}

export interface HoleFillResult {
  positions: Float32Array;
  filledLoops: number;
  addedTriangles: number;
  skipped: { loop: number; reason: string }[];
}
/** Ear clips simple planar boundary loops. Refuses branching, non-planar or self-intersecting boundaries. */
export function fillPlanarHoles(
  positions: Positions,
  options: MeshProcessingOptions & {
    planarityTolerance?: number;
    maxPerimeter?: number;
  } = {},
): HoleFillResult {
  const oriented = repairOrientation(positions, options);
  if (oriented.conflicts)
    throw new Error(
      "Mesh orientation conflicts must be resolved before hole filling.",
    );
  const topology = analyzeMesh(oriented.positions, options);
  const planarity =
    options.planarityTolerance ?? Math.max(options.tolerance ?? 1e-6, 1e-5);
  const maxPerimeter = options.maxPerimeter ?? Infinity;
  if (!Number.isFinite(planarity) || planarity <= 0 || !(maxPerimeter > 0))
    throw new Error("Hole thresholds must be positive.");
  const output: number[] = [];
  const skipped: HoleFillResult["skipped"] = [];
  let filledLoops = 0;
  for (let loop = 0; loop < topology.boundaryLoops.length; loop++) {
    checkpoint(
      options,
      loop / Math.max(1, topology.boundaryLoops.length),
      "Filling planar boundaries",
    );
    let ids = [...topology.boundaryLoops[loop]];
    const firstUse = topology.edges.get(edgeKey(ids[0], ids[1]))![0];
    // New face boundary must oppose existing faces.
    if (firstUse.from === ids[0]) ids.reverse();
    const pts = ids.map((id) => point(topology.vertices, id));
    let perimeter = 0;
    const n: Vec3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i],
        q = pts[(i + 1) % pts.length];
      perimeter += Math.hypot(...sub(q, p));
      n[0] += (p[1] - q[1]) * (p[2] + q[2]);
      n[1] += (p[2] - q[2]) * (p[0] + q[0]);
      n[2] += (p[0] - q[0]) * (p[1] + q[1]);
    }
    if (perimeter > maxPerimeter) {
      skipped.push({ loop, reason: "Perimeter exceeds requested threshold" });
      continue;
    }
    const length = Math.hypot(...n);
    if (!length) {
      skipped.push({ loop, reason: "Degenerate boundary" });
      continue;
    }
    const unit: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
    if (pts.some((p) => Math.abs(dot(sub(p, pts[0]), unit)) > planarity)) {
      skipped.push({ loop, reason: "Boundary is not planar" });
      continue;
    }
    let drop = 0;
    if (Math.abs(n[1]) > Math.abs(n[drop])) drop = 1;
    if (Math.abs(n[2]) > Math.abs(n[drop])) drop = 2;
    const axes = [0, 1, 2].filter((axis) => axis !== drop);
    const xy = pts.map((p) => [p[axes[0]], p[axes[1]]] as [number, number]);
    const orient = (a: number, b: number, c: number) =>
      (xy[b][0] - xy[a][0]) * (xy[c][1] - xy[a][1]) -
      (xy[b][1] - xy[a][1]) * (xy[c][0] - xy[a][0]);
    const eps = (options.tolerance ?? 1e-6) ** 2;
    let selfIntersection = false;
    for (let i = 0; i < xy.length; i++)
      for (let j = i + 1; j < xy.length; j++) {
        const a = i,
          b = (i + 1) % xy.length,
          c = j,
          d = (j + 1) % xy.length;
        if (a === c || a === d || b === c || b === d) continue;
        const intersects =
          orient(a, b, c) * orient(a, b, d) <= eps &&
          orient(c, d, a) * orient(c, d, b) <= eps &&
          Math.max(
            Math.min(xy[a][0], xy[b][0]),
            Math.min(xy[c][0], xy[d][0]),
          ) <=
            Math.min(
              Math.max(xy[a][0], xy[b][0]),
              Math.max(xy[c][0], xy[d][0]),
            ) +
              Math.sqrt(eps) &&
          Math.max(
            Math.min(xy[a][1], xy[b][1]),
            Math.min(xy[c][1], xy[d][1]),
          ) <=
            Math.min(
              Math.max(xy[a][1], xy[b][1]),
              Math.max(xy[c][1], xy[d][1]),
            ) +
              Math.sqrt(eps);
        if (intersects) selfIntersection = true;
      }
    if (selfIntersection) {
      skipped.push({ loop, reason: "Boundary self-intersects" });
      continue;
    }
    let area = 0;
    for (let i = 0; i < xy.length; i++)
      area +=
        xy[i][0] * xy[(i + 1) % xy.length][1] -
        xy[(i + 1) % xy.length][0] * xy[i][1];
    const sign = Math.sign(area);
    const remaining = ids.map((_, i) => i);
    const faces: number[] = [];
    while (remaining.length > 3) {
      checkpoint(
        options,
        loop / Math.max(1, topology.boundaryLoops.length),
        "Triangulating planar boundary",
      );
      let clipped = false;
      for (let i = 0; i < remaining.length; i++) {
        const a = remaining[(i + remaining.length - 1) % remaining.length],
          b = remaining[i],
          c = remaining[(i + 1) % remaining.length];
        if (sign * orient(a, b, c) <= eps) continue;
        if (
          remaining.some(
            (p) =>
              p !== a &&
              p !== b &&
              p !== c &&
              sign * orient(a, b, p) >= -eps &&
              sign * orient(b, c, p) >= -eps &&
              sign * orient(c, a, p) >= -eps,
          )
        )
          continue;
        faces.push(ids[a], ids[b], ids[c]);
        remaining.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) break;
    }
    if (
      remaining.length !== 3 ||
      sign * orient(remaining[0], remaining[1], remaining[2]) <= eps
    ) {
      skipped.push({ loop, reason: "Boundary cannot be safely triangulated" });
      continue;
    }
    const adjacentFaces = new Set<number>();
    for (let i = 0; i < ids.length; i++)
      for (const use of topology.edges.get(
        edgeKey(ids[i], ids[(i + 1) % ids.length]),
      ) ?? [])
        adjacentFaces.add(use.face);
    const flatNeighbors = [...adjacentFaces].every((face) =>
      [0, 1, 2].every(
        (corner) =>
          Math.abs(
            dot(
              sub(
                point(topology.vertices, topology.triangles[face * 3 + corner]),
                pts[0],
              ),
              unit,
            ),
          ) <= planarity,
      ),
    );
    if (flatNeighbors) {
      skipped.push({
        loop,
        reason:
          "Capping would overlap a planar surface rather than close a supported volume",
      });
      continue;
    }
    faces.push(...remaining.map((i) => ids[i]));
    for (const id of faces) {
      const p = point(topology.vertices, id);
      output.push(p[0], p[1], p[2]);
    }
    filledLoops++;
  }
  const result = new Float32Array(oriented.positions.length + output.length);
  result.set(oriented.positions);
  result.set(output, oriented.positions.length);
  ensureFloat32(result);
  checkpoint(options, 1, "Hole filling complete");
  if (topology.boundaryChains.length)
    skipped.push({
      loop: -1,
      reason: `${topology.boundaryChains.length} branching/open boundary chains were not filled`,
    });
  return {
    positions: result,
    filledLoops,
    addedTriangles: output.length / 9,
    skipped,
  };
}

export interface SegmentationResult {
  labels: Uint32Array;
  segments: { id: number; triangles: number; area: number }[];
}

export interface RegionClassification {
  kind: "plane" | "sphere" | "cylinder" | "cone" | "freeform";
  samples: number;
  extent: Vec3;
  tolerance: number;
  rms?: number;
  maxError?: number;
  fit?: FitResult;
  reason: string;
}
export interface RegionClassificationOptions extends MeshProcessingOptions {
  absoluteTolerance?: number;
  relativeTolerance?: number;
  minimumSamples?: number;
  minimumTriangles?: number;
  maxSamples?: number;
  minimumExtent?: number;
}
/** Classify a connected region conservatively using bounded samples and verify residuals on every input vertex.
 * Defaults require 24 distinct sampled points and 16 triangles; RMS <= max(0.01 mm, 0.1% diagonal), max error <= 3x tolerance.
 * Curved fits require radius <= 4x diagonal; cylindrical/conical sides need >=60 degrees angular support and measurable axial span.
 */
export function classifyRegion(
  positions: Positions,
  options: RegionClassificationOptions = {},
): RegionClassification {
  const absolute = options.absoluteTolerance ?? 0.01,
    relative = options.relativeTolerance ?? 0.001,
    minimumSamples = options.minimumSamples ?? 24,
    minimumTriangles = options.minimumTriangles ?? 16,
    maximum = options.maxSamples ?? 512,
    minimumExtent = options.minimumExtent ?? 0.001;
  validate(positions, options.tolerance ?? 1e-6);
  if (
    !Number.isFinite(absolute) ||
    absolute <= 0 ||
    !Number.isFinite(relative) ||
    relative < 0 ||
    !Number.isFinite(minimumExtent) ||
    minimumExtent <= 0 ||
    ![minimumSamples, minimumTriangles, maximum].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    minimumSamples < 6 ||
    minimumTriangles < 2 ||
    maximum < minimumSamples
  )
    throw new Error(
      "Invalid region classification sampling or tolerance options.",
    );
  checkpoint(options, 0, "Sampling surface classification");
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    if (i % 12288 === 0) checkpoint(options, 0, "Measuring surface extent");
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  const extent = max.map((value, axis) => value - min[axis]) as Vec3,
    diagonal = Math.hypot(...extent);
  if (!Number.isFinite(diagonal))
    throw new Error("Surface extent exceeds finite fitting precision.");
  const threshold = Math.max(absolute, relative * diagonal);
  const sample: number[] = [],
    seen = new Set<string>(),
    total = positions.length / 3,
    picks = Math.min(total, maximum);
  for (let i = 0; i < picks; i++) {
    const index = Math.floor((i * total) / picks) * 3,
      key = `${positions[index]},${positions[index + 1]},${positions[index + 2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      sample.push(positions[index], positions[index + 1], positions[index + 2]);
    }
  }
  const base = { samples: sample.length / 3, extent, tolerance: threshold };
  const unclassified = (
    reason: string,
    best?: FitResult,
  ): RegionClassification => ({
    ...base,
    kind: "freeform",
    reason,
    ...(best ? { rms: best.rms, maxError: best.maxError } : {}),
  });
  if (
    positions.length / 9 < minimumTriangles ||
    sample.length / 3 < minimumSamples
  )
    return unclassified(
      "Insufficient triangle or distinct sampled-point support",
    );
  const sortedExtent = [...extent].sort((a, b) => b - a);
  if (
    !Number.isFinite(diagonal) ||
    sortedExtent[1] < Math.max(minimumExtent, 20 * threshold)
  )
    return unclassified(
      "Region is too small or narrow relative to fit tolerance",
    );
  function verify(fit: FitResult): FitResult {
    let sum = 0,
      maximumError = 0;
    const axis = fit.axis,
      center = fit.center,
      slope =
        fit.kind === "cone" ? (fit.topRadius! - fit.radius!) / fit.height! : 0;
    for (let i = 0; i < positions.length; i += 3) {
      if (i % 12288 === 0)
        checkpoint(options, 0.5, "Verifying full-region residuals");
      const x = positions[i] - center[0],
        y = positions[i + 1] - center[1],
        z = positions[i + 2] - center[2],
        axial = x * axis[0] + y * axis[1] + z * axis[2],
        radial = Math.hypot(
          x - axis[0] * axial,
          y - axis[1] * axial,
          z - axis[2] * axial,
        );
      const error =
        fit.kind === "plane"
          ? axial
          : fit.kind === "sphere"
            ? Math.hypot(x, y, z) - fit.radius!
            : (radial - fit.radius! - slope * axial) /
              Math.sqrt(1 + slope * slope);
      sum += error * error;
      maximumError = Math.max(maximumError, Math.abs(error));
    }
    return {
      ...fit,
      rms: Math.sqrt(sum / (positions.length / 3)),
      maxError: maximumError,
    };
  }
  function supported(fit: FitResult): boolean {
    if (
      ![fit.rms, fit.maxError, ...fit.center, ...fit.axis].every(
        Number.isFinite,
      ) ||
      fit.rms > threshold ||
      fit.maxError > 3 * threshold
    )
      return false;
    if (fit.kind === "plane") return true;
    if (!fit.radius || fit.radius < 10 * threshold || fit.radius > 4 * diagonal)
      return false;
    if (fit.kind === "sphere") return true;
    if (!fit.height || fit.height < Math.max(20 * threshold, 0.15 * diagonal))
      return false;
    if (
      fit.kind === "cone" &&
      Math.abs(fit.radius - (fit.topRadius ?? 0)) <
        Math.max(5 * threshold, 0.02 * fit.height)
    )
      return false;
    const helper: Vec3 = Math.abs(fit.axis[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0],
      raw = cross(fit.axis, helper),
      length = Math.hypot(...raw),
      u = raw.map((value) => value / length) as Vec3,
      v = cross(fit.axis, u),
      angles: number[] = [];
    for (let i = 0; i < sample.length; i += 3) {
      const p: Vec3 = [
        sample[i] - fit.center[0],
        sample[i + 1] - fit.center[1],
        sample[i + 2] - fit.center[2],
      ];
      angles.push(Math.atan2(dot(p, v), dot(p, u)));
    }
    angles.sort((a, b) => a - b);
    let gap = angles[0] + Math.PI * 2 - angles.at(-1)!;
    for (let i = 1; i < angles.length; i++)
      gap = Math.max(gap, angles[i] - angles[i - 1]);
    return Math.PI * 2 - gap >= Math.PI / 3;
  }
  const candidates: FitResult[] = [];
  for (const fitter of [fitPlane, fitSphere, fitCylinder, fitCone]) {
    checkpoint(options, 0.25, "Fitting analytic surface candidates");
    try {
      const fit = verify(fitter(sample));
      if (Number.isFinite(fit.rms) && Number.isFinite(fit.maxError))
        candidates.push(fit);
      if (supported(fit)) {
        checkpoint(options, 1, "Surface classified");
        return {
          ...base,
          kind: fit.kind,
          rms: fit.rms,
          maxError: fit.maxError,
          fit,
          reason:
            "Analytic candidate passed full-region residual and extent checks",
        };
      }
    } catch (error) {
      if (
        options.signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        throw error;
    }
  }
  checkpoint(options, 1, "Surface remains unclassified");
  const best = candidates.sort((a, b) => a.rms - b.rms)[0];
  return unclassified(
    "No supported analytic candidate passed full-region residual and coverage checks",
    best,
  );
}
/** Region growing across manifold shared edges using the local dihedral angle, not semantic CAD classification. */
export function segmentMesh(
  positions: Positions,
  options: MeshProcessingOptions & { angleDegrees?: number } = {},
): SegmentationResult {
  const angle = options.angleDegrees ?? 25;
  if (!Number.isFinite(angle) || angle < 0 || angle > 180)
    throw new Error("Segmentation angle must be between 0 and 180 degrees.");
  const topology = analyzeMesh(positions, options);
  const normals = new Float64Array(topology.neighbors.length * 3);
  for (let face = 0; face < topology.neighbors.length; face++)
    normals.set(normal(topology, face), face * 3);
  const adjacency = Array.from(
    { length: topology.neighbors.length },
    () => [] as number[],
  );
  const threshold = Math.cos((angle * Math.PI) / 180);
  for (const uses of topology.edges.values())
    if (uses.length === 2) {
      const a = uses[0].face,
        b = uses[1].face;
      if (dot(point(normals, a), point(normals, b)) >= threshold - 1e-12) {
        adjacency[a].push(b);
        adjacency[b].push(a);
      }
    }
  const labels = new Uint32Array(adjacency.length);
  labels.fill(0xffffffff);
  const segments: SegmentationResult["segments"] = [];
  for (let start = 0; start < labels.length; start++)
    if (labels[start] === 0xffffffff) {
      const id = segments.length;
      const queue = [start];
      labels[start] = id;
      let area = 0;
      for (let q = 0; q < queue.length; q++) {
        if (q % 4096 === 0)
          checkpoint(options, start / labels.length, "Growing surface region");
        const face = queue[q];
        const a = point(topology.vertices, topology.triangles[face * 3]),
          b = point(topology.vertices, topology.triangles[face * 3 + 1]),
          c = point(topology.vertices, topology.triangles[face * 3 + 2]);
        area += Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
        for (const next of adjacency[face])
          if (labels[next] === 0xffffffff) {
            labels[next] = id;
            queue.push(next);
          }
      }
      segments.push({ id, triangles: queue.length, area });
      checkpoint(
        options,
        start / labels.length,
        "Segmenting by normal continuity",
      );
    }
  checkpoint(options, 1, "Segmentation complete");
  return { labels, segments };
}

/** Uniform Laplacian smoothing, preserving boundary and nonmanifold vertices by default. May shrink curved surfaces. */
export function smoothMesh(
  positions: Positions,
  options: MeshProcessingOptions & {
    iterations?: number;
    strength?: number;
    preserveBoundary?: boolean;
  } = {},
): Float32Array {
  const iterations = options.iterations ?? 3,
    strength = options.strength ?? 0.3;
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    !Number.isFinite(strength) ||
    strength <= 0 ||
    strength > 1
  )
    throw new Error(
      "Smoothing requires positive iterations and strength in (0, 1].",
    );
  const topology = analyzeMesh(positions, options),
    count = topology.vertices.length / 3;
  let vertices = topology.vertices;
  const adjacent = Array.from({ length: count }, () => new Set<number>());
  const pinned = new Uint8Array(count);
  for (const uses of topology.edges.values()) {
    const { from, to } = uses[0];
    adjacent[from].add(to);
    adjacent[to].add(from);
    if (
      uses.length > 2 ||
      (options.preserveBoundary !== false && uses.length === 1)
    )
      pinned[from] = pinned[to] = 1;
  }
  for (let iteration = 0; iteration < iterations; iteration++) {
    checkpoint(options, iteration / iterations, "Smoothing mesh");
    const next = vertices.slice();
    for (let id = 0; id < count; id++) {
      if (id % 4096 === 0)
        checkpoint(options, iteration / iterations, "Smoothing mesh");
      if (!pinned[id] && adjacent[id].size) {
        for (let axis = 0; axis < 3; axis++) {
          let average = 0;
          for (const neighbor of adjacent[id])
            average += vertices[neighbor * 3 + axis] / adjacent[id].size;
          next[id * 3 + axis] += strength * (average - vertices[id * 3 + axis]);
        }
      }
    }
    vertices = next;
  }
  const output = new Float32Array(positions.length);
  for (let i = 0; i < topology.triangles.length; i++)
    for (let axis = 0; axis < 3; axis++)
      output[i * 3 + axis] = vertices[topology.triangles[i] * 3 + axis];
  ensureFloat32(output);
  checkpoint(options, 1, "Smoothing complete");
  return output;
}

export interface DecimationResult {
  positions: Float32Array;
  originalTriangles: number;
  triangles: number;
  removedTriangles: number;
  maxVertexDisplacement: number;
}
/** Grid vertex clustering. No target-count or topology preservation guarantee; inspect the result before accepting. */
export function decimateMesh(
  positions: Positions,
  options: MeshProcessingOptions & { cellSize: number },
): DecimationResult {
  const size = options.cellSize;
  validate(positions, size);
  checkpoint(options, 0, "Clustering vertices");
  const origin = [positions[0], positions[1], positions[2]],
    cells = new Map<string, { sum: Vec3; count: number; id: number }>();
  const ids = new Uint32Array(positions.length / 3);
  for (let i = 0; i < positions.length; i += 3) {
    if (i % 12288 === 0)
      checkpoint(options, (i / positions.length) * 0.5, "Clustering vertices");
    const cell = [0, 1, 2].map((axis) =>
      Math.floor((positions[i + axis] - origin[axis]) / size),
    );
    if (!cell.every(Number.isSafeInteger))
      throw new Error("Coordinate range exceeds clustering precision.");
    const key = cell.join(",");
    let cluster = cells.get(key);
    if (!cluster) {
      cluster = { sum: [0, 0, 0], count: 0, id: cells.size };
      cells.set(key, cluster);
    }
    for (let axis = 0; axis < 3; axis++)
      cluster.sum[axis] += positions[i + axis];
    cluster.count++;
    ids[i / 3] = cluster.id;
  }
  const centers = new Float64Array(cells.size * 3);
  for (const cluster of cells.values())
    for (let axis = 0; axis < 3; axis++)
      centers[cluster.id * 3 + axis] = cluster.sum[axis] / cluster.count;
  let maxVertexDisplacement = 0;
  for (let i = 0; i < ids.length; i++)
    maxVertexDisplacement = Math.max(
      maxVertexDisplacement,
      Math.hypot(
        positions[i * 3] - centers[ids[i] * 3],
        positions[i * 3 + 1] - centers[ids[i] * 3 + 1],
        positions[i * 3 + 2] - centers[ids[i] * 3 + 2],
      ),
    );
  const kept: number[] = [],
    seen = new Set<string>();
  for (let face = 0; face < ids.length / 3; face++) {
    if (face % 4096 === 0)
      checkpoint(
        options,
        0.5 + (face / (ids.length / 3)) * 0.5,
        "Removing collapsed triangles",
      );
    const a = ids[face * 3],
      b = ids[face * 3 + 1],
      c = ids[face * 3 + 2];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join(":");
    if (seen.has(key)) continue;
    if (
      Math.hypot(
        ...cross(
          sub(point(centers, b), point(centers, a)),
          sub(point(centers, c), point(centers, a)),
        ),
      ) === 0
    )
      continue;
    seen.add(key);
    kept.push(a, b, c);
  }
  const output = new Float32Array(kept.length * 3);
  for (let i = 0; i < kept.length; i++)
    output.set(point(centers, kept[i]), i * 3);
  ensureFloat32(output);
  checkpoint(options, 1, "Clustering complete");
  return {
    positions: output,
    originalTriangles: positions.length / 9,
    triangles: output.length / 9,
    removedTriangles: (positions.length - output.length) / 9,
    maxVertexDisplacement,
  };
}

export interface MeshRepairResult {
  positions: Float32Array;
  removedDegenerate: number;
  removedDuplicates: number;
  flippedTriangles: number;
  orientationConflicts: number;
  filledLoops: number;
  skippedHoles: HoleFillResult["skipped"];
  topology: MeshTopology;
  sheets?: Float32Array[];
  sheetDiagnostics: MeshSheetDiagnostics[];
  nonManifoldEdgesBefore: number;
  nonManifoldEdgesAfter: number;
  nonManifoldVerticesBefore: number;
  nonManifoldVerticesAfter: number;
  splitEdges: number;
  splitVertices: number;
  outwardComponents: number;
}
export interface MeshSheetDiagnostics {
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
  watertight: boolean;
}
export function sheetSummary(topology: MeshTopology): MeshSheetDiagnostics {
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
    watertight:
      topology.boundaryEdges === 0 &&
      topology.nonManifoldEdges === 0 &&
      topology.nonManifoldVertices === 0 &&
      topology.inconsistentEdges === 0 &&
      topology.degenerateTriangles === 0 &&
      topology.duplicateTriangles === 0,
  };
}
/** Cut ambiguous edge junctions rather than choosing an arbitrary pair; separate vertex fans into independently stored sheet objects. */
export function splitNonManifoldSheets(
  positions: Positions,
  options: MeshProcessingOptions = {},
): { sheets: Float32Array[]; splitEdges: number; splitVertices: number } {
  const topology = analyzeMesh(positions, options),
    count = topology.triangles.length / 3;
  if (topology.degenerateTriangles || topology.duplicateTriangles)
    throw new Error(
      "Clean degenerate and duplicate faces before splitting surface sheets.",
    );
  const adjacency = Array.from({ length: count }, () => [] as number[]);
  for (const uses of topology.edges.values())
    if (uses.length === 2) {
      adjacency[uses[0].face].push(uses[1].face);
      adjacency[uses[1].face].push(uses[0].face);
    }
  const assigned = new Uint8Array(count),
    sheets: Float32Array[] = [];
  for (let seed = 0; seed < count; seed++)
    if (!assigned[seed]) {
      checkpoint(options, seed / count, "Separating manifold surface sheets");
      const faces = [seed],
        edgeCounts = new Map<string, number>(),
        vertices = new Set<number>();
      function ids(face: number) {
        return [
          topology.triangles[face * 3],
          topology.triangles[face * 3 + 1],
          topology.triangles[face * 3 + 2],
        ];
      }
      function canAdd(face: number) {
        const v = ids(face);
        if (
          v.some(
            (from, corner) =>
              (edgeCounts.get(edgeKey(from, v[(corner + 1) % 3])) ?? 0) >= 2,
          )
        )
          return false;
        return v.every(
          (vertex, corner) =>
            !vertices.has(vertex) ||
            edgeCounts.has(edgeKey(vertex, v[(corner + 1) % 3])) ||
            edgeCounts.has(edgeKey(vertex, v[(corner + 2) % 3])),
        );
      }
      function add(face: number) {
        assigned[face] = 1;
        const v = ids(face);
        for (let corner = 0; corner < 3; corner++) {
          vertices.add(v[corner]);
          const key = edgeKey(v[corner], v[(corner + 1) % 3]);
          edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
        }
      }
      add(seed);
      for (let q = 0; q < faces.length; q++) {
        if (q % 4096 === 0)
          checkpoint(options, seed / count, "Separating vertex fans");
        for (const next of adjacency[faces[q]])
          if (!assigned[next] && canAdd(next)) {
            add(next);
            faces.push(next);
          }
      }
      const output = new Float32Array(faces.length * 9);
      for (let i = 0; i < faces.length; i++)
        for (let corner = 0; corner < 3; corner++)
          output.set(
            point(topology.vertices, topology.triangles[faces[i] * 3 + corner]),
            i * 9 + corner * 3,
          );
      ensureFloat32(output);
      sheets.push(output);
    }
  checkpoint(options, 1, "Surface sheets separated");
  return {
    sheets,
    splitEdges: topology.nonManifoldEdges,
    splitVertices: topology.nonManifoldVertices,
  };
}
/** Snap welded representatives, remove degenerate/duplicate faces, repair winding and optionally cap planar loops. */
export function repairMesh(
  positions: Positions,
  options: MeshProcessingOptions & {
    fillHoles?: boolean;
    planarityTolerance?: number;
    maxPerimeter?: number;
    splitNonManifold?: boolean;
  } = {},
): MeshRepairResult {
  const topology = analyzeMesh(positions, options);
  const tolerance = options.tolerance ?? 1e-6;
  const keep: number[] = [],
    seen = new Set<string>();
  let removedDegenerate = 0,
    removedDuplicates = 0;
  for (let face = 0; face < topology.triangles.length / 3; face++) {
    if (face % 4096 === 0)
      checkpoint(
        options,
        face / (topology.triangles.length / 3),
        "Removing invalid faces",
      );
    const ids = [
      topology.triangles[face * 3],
      topology.triangles[face * 3 + 1],
      topology.triangles[face * 3 + 2],
    ];
    const [a, b, c] = ids.map((id) => point(topology.vertices, id));
    if (
      new Set(ids).size < 3 ||
      Math.hypot(...cross(sub(b, a), sub(c, a))) <= tolerance * tolerance
    ) {
      removedDegenerate++;
      continue;
    }
    const key = [...ids].sort((a, b) => a - b).join(":");
    if (seen.has(key)) {
      removedDuplicates++;
      continue;
    }
    seen.add(key);
    keep.push(...ids);
  }
  if (!keep.length)
    throw new Error(
      "Repair would remove all triangles; no valid surface remains.",
    );
  const welded = new Float32Array(keep.length * 3);
  for (let i = 0; i < keep.length; i++)
    welded.set(point(topology.vertices, keep[i]), i * 3);
  ensureFloat32(welded);
  const split = options.splitNonManifold
    ? splitNonManifoldSheets(welded, options)
    : { sheets: [welded], splitEdges: 0, splitVertices: 0 };
  const repairedSheets: Float32Array[] = [],
    sheetDiagnostics: MeshSheetDiagnostics[] = [],
    skippedHoles: HoleFillResult["skipped"] = [];
  let flippedTriangles = 0,
    orientationConflicts = 0,
    filledLoops = 0,
    outwardComponents = 0;
  for (let sheet = 0; sheet < split.sheets.length; sheet++) {
    checkpoint(
      options,
      sheet / split.sheets.length,
      "Repairing separated sheets",
    );
    const oriented = repairOrientation(split.sheets[sheet], options);
    flippedTriangles += oriented.flippedTriangles;
    orientationConflicts += oriented.conflicts;
    outwardComponents += oriented.outwardComponents;
    const holes =
      options.fillHoles && !oriented.conflicts
        ? fillPlanarHoles(oriented.positions, options)
        : {
            positions: oriented.positions,
            filledLoops: 0,
            addedTriangles: 0,
            skipped: [],
          };
    filledLoops += holes.filledLoops;
    skippedHoles.push(
      ...holes.skipped.map((diagnostic) => ({
        ...diagnostic,
        reason: `Sheet ${sheet + 1}: ${diagnostic.reason}`,
      })),
    );
    const finalOrientation = holes.filledLoops
      ? repairOrientation(holes.positions, options)
      : oriented;
    if (holes.filledLoops) {
      flippedTriangles += finalOrientation.flippedTriangles;
      orientationConflicts += finalOrientation.conflicts;
      outwardComponents += finalOrientation.outwardComponents;
    }
    const finalTopology = analyzeMesh(finalOrientation.positions, options),
      summary = sheetSummary(finalTopology);
    if (
      options.splitNonManifold &&
      (summary.nonManifoldEdges || summary.nonManifoldVertices)
    )
      throw new Error(
        "Surface sheet separation could not resolve a nonmanifold junction safely.",
      );
    repairedSheets.push(finalOrientation.positions);
    sheetDiagnostics.push(summary);
  }
  const output = new Float32Array(
    repairedSheets.reduce((sum, sheet) => sum + sheet.length, 0),
  );
  let offset = 0;
  for (const sheet of repairedSheets) {
    output.set(sheet, offset);
    offset += sheet.length;
  }
  return {
    positions: output,
    removedDegenerate,
    removedDuplicates,
    flippedTriangles,
    orientationConflicts,
    filledLoops,
    skippedHoles,
    topology: analyzeMesh(output, options),
    sheets: repairedSheets.length > 1 ? repairedSheets : undefined,
    sheetDiagnostics,
    nonManifoldEdgesBefore: topology.nonManifoldEdges,
    nonManifoldEdgesAfter: sheetDiagnostics.reduce(
      (sum, sheet) => sum + sheet.nonManifoldEdges,
      0,
    ),
    nonManifoldVerticesBefore: topology.nonManifoldVertices,
    nonManifoldVerticesAfter: sheetDiagnostics.reduce(
      (sum, sheet) => sum + sheet.nonManifoldVertices,
      0,
    ),
    splitEdges: split.splitEdges,
    splitVertices: split.splitVertices,
    outwardComponents,
  };
}

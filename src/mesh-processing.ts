import type { Positions, Vec3 } from "./types";

/** Operations allocate an indexed topology proportional to mesh size. Run in a worker for large scans. */
export interface MeshProcessingOptions {
  tolerance?: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number, stage: string) => void;
}
interface EdgeUse {
  face: number;
  from: number;
  to: number;
}
export interface MeshTopology {
  vertices: Float64Array;
  triangles: Uint32Array;
  edges: Map<string, EdgeUse[]>;
  neighbors: number[][];
  components: number[][];
  boundaryLoops: number[][];
  boundaryChains: number[][];
  nonManifoldEdges: number;
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
  validate(positions, tolerance);
  checkpoint(options, 0, "Welding vertices");
  const vertices: number[] = [];
  const triangles = new Uint32Array(positions.length / 3);
  const cells = new Map<string, number[]>();
  const origin = [positions[0], positions[1], positions[2]];
  for (let i = 0; i < positions.length; i += 3) {
    if (i % 12288 === 0)
      checkpoint(options, (0.45 * i) / positions.length, "Welding vertices");
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    const cx = Math.floor((x - origin[0]) / tolerance),
      cy = Math.floor((y - origin[1]) / tolerance),
      cz = Math.floor((z - origin[2]) / tolerance);
    if (![cx, cy, cz].every(Number.isSafeInteger))
      throw new Error(
        "Coordinate range exceeds weld precision; increase tolerance.",
      );
    let id = -1;
    search: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const candidate of cells.get(
            `${cx + dx},${cy + dy},${cz + dz}`,
          ) ?? []) {
            if (
              Math.hypot(
                vertices[candidate * 3] - x,
                vertices[candidate * 3 + 1] - y,
                vertices[candidate * 3 + 2] - z,
              ) <= tolerance
            ) {
              id = candidate;
              break search;
            }
          }
        }
    if (id < 0) {
      id = vertices.length / 3;
      vertices.push(x, y, z);
      const key = `${cx},${cy},${cz}`;
      const cell = cells.get(key);
      if (cell) cell.push(id);
      else cells.set(key, [id]);
    }
    triangles[i / 3] = id;
  }
  const edges = new Map<string, EdgeUse[]>();
  const neighbors = Array.from(
    { length: triangles.length / 3 },
    () => [] as number[],
  );
  let degenerateTriangles = 0,
    duplicateTriangles = 0;
  const seen = new Set<string>();
  for (let face = 0; face < neighbors.length; face++) {
    if (face % 4096 === 0)
      checkpoint(
        options,
        0.45 + (0.3 * face) / neighbors.length,
        "Building topology",
      );
    const ids = [
      triangles[face * 3],
      triangles[face * 3 + 1],
      triangles[face * 3 + 2],
    ];
    const duplicateKey = [...ids].sort((a, b) => a - b).join(":");
    if (seen.has(duplicateKey)) duplicateTriangles++;
    else seen.add(duplicateKey);
    const a = point(vertices, ids[0]),
      b = point(vertices, ids[1]),
      c = point(vertices, ids[2]);
    if (
      new Set(ids).size < 3 ||
      Math.hypot(...cross(sub(b, a), sub(c, a))) <= tolerance * tolerance
    ) {
      degenerateTriangles++;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const from = ids[k],
        to = ids[(k + 1) % 3],
        key = edgeKey(from, to);
      const use = { face, from, to };
      const uses = edges.get(key);
      if (uses) uses.push(use);
      else edges.set(key, [use]);
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
  checkpoint(options, 1, "Topology complete");
  return {
    vertices: new Float64Array(vertices),
    triangles,
    edges,
    neighbors,
    components,
    boundaryLoops,
    boundaryChains,
    nonManifoldEdges,
    inconsistentEdges,
    degenerateTriangles,
    duplicateTriangles,
    boundaryEdges,
  };
}

export interface OrientationResult {
  positions: Float32Array;
  flippedTriangles: number;
  conflicts: number;
  topology: MeshTopology;
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
    flippedTriangles = 0;
  for (let start = 0; start < parity.length; start++)
    if (parity[start] < 0) {
      const queue = [start];
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
  return { positions: result, flippedTriangles, conflicts, topology };
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
}
/** Snap welded representatives, remove degenerate/duplicate faces, repair winding and optionally cap planar loops. */
export function repairMesh(
  positions: Positions,
  options: MeshProcessingOptions & {
    fillHoles?: boolean;
    planarityTolerance?: number;
    maxPerimeter?: number;
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
  const oriented = repairOrientation(welded, options);
  const holes =
    options.fillHoles && !oriented.conflicts
      ? fillPlanarHoles(oriented.positions, options)
      : {
          positions: oriented.positions,
          filledLoops: 0,
          addedTriangles: 0,
          skipped: [],
        };
  return {
    positions: holes.positions,
    removedDegenerate,
    removedDuplicates,
    flippedTriangles: oriented.flippedTriangles,
    orientationConflicts: oriented.conflicts,
    filledLoops: holes.filledLoops,
    skippedHoles: holes.skipped,
    topology: analyzeMesh(holes.positions, options),
  };
}

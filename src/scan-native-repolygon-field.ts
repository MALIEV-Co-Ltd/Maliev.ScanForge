import type { MeshProcessingOptions } from "./mesh-processing";
import type {
  ReconstructionTriangle,
  ReconstructionSource,
  ReconstructionSample,
  ReconstructionNode,
  ReconstructionFrontier,
  ReconstructionCorner,
  ReconstructionFieldOptions,
} from "./scan-native-repolygon-types";
import { nativeGlobalFacetNormals } from "./scan-native-global-surface";
import { nativeBuildAlignmentAdjacency } from "./scan-native-alignment-adjacency";
import {
  reconstructionGridFrame,
  reconstructionChildBounds,
  reconstructionChildIndex,
  reconstructionCornerKey,
  reconstructionTriangleCandidates,
  reconstructionTriangleCellIntersects,
  reconstructionTriangleSample,
  reconstructionCornerReduction,
  reconstructionEdgePosition,
  reconstructionVertexKey,
} from "./scan-native-repolygon-arithmetic";
import tables from "./scan-repolygon-cases.json";
export function reconstructionTriangleSource(mesh: {
  positions: Float32Array;
  indices: Uint32Array;
  faceNormals: Float32Array;
  neighbors: Int32Array;
  vertexFlags?: Uint32Array;
}): ReconstructionSource {
  const { positions, indices, faceNormals, neighbors } = mesh,
    count = positions.length / 3;
  // Reconstruction packed-input guards; source import and native cache preparation remain separate.
  if (
    !(positions instanceof Float32Array) ||
    !(indices instanceof Uint32Array) ||
    !(faceNormals instanceof Float32Array) ||
    !(neighbors instanceof Int32Array) ||
    positions.length % 3 ||
    indices.length % 3 ||
    faceNormals.length !== indices.length ||
    neighbors.length !== indices.length ||
    (mesh.vertexFlags && mesh.vertexFlags.length !== count)
  )
    throw new RangeError("Reconstruction packed source shape mismatch");
  for (const id of indices)
    if (id >= count)
      throw new RangeError(
        "Reconstruction source vertex index outside storage",
      );
  for (const neighbor of neighbors)
    if (neighbor < -1 || neighbor >= indices.length / 3)
      throw new RangeError(
        "Reconstruction source neighbor index outside storage",
      );
  const vertexFlags = mesh.vertexFlags
    ? new Uint32Array(mesh.vertexFlags)
    : new Uint32Array(count);
  for (let i = 0; i < count; i++) vertexFlags[i] &= ~4;
  for (let face = 0; face < indices.length; face += 3)
    for (let slot = 0; slot < 3; slot++)
      if (neighbors[face + slot] === -1) {
        vertexFlags[indices[face + slot]] |= 4;
        vertexFlags[indices[face + ((slot + 1) % 3)]] |= 4;
      }
  return {
    length: indices.length / 3,
    vertexFlags,
    *[Symbol.iterator]() {
      for (let face = 0; face < indices.length; face += 3) {
        const ids = [indices[face], indices[face + 1], indices[face + 2]];
        let boundaryEdges = 0;
        for (let slot = 0; slot < 3; slot++)
          if (
            (vertexFlags[ids[slot]] & 5) === 4 &&
            (vertexFlags[ids[(slot + 1) % 3]] & 5) === 4
          )
            boundaryEdges |= 1 << slot;
        yield {
          vertices: ids.map((id) => positions.subarray(id * 3, id * 3 + 3)),
          normal: faceNormals.subarray(face, face + 3),
          boundaryEdges,
        };
      }
    },
  };
}

export function reconstructionPrepareSharedSource(
  mesh: {
    positions: Float32Array;
    indices: Uint32Array;
    vertexFlags?: Uint32Array;
  },
  options: MeshProcessingOptions = {},
) {
  const { positions, indices } = mesh,
    facets = nativeGlobalFacetNormals(positions, indices, options),
    topology = nativeBuildAlignmentAdjacency(positions, indices, options);
  const source = reconstructionTriangleSource({
    positions,
    indices,
    faceNormals: facets.normals,
    neighbors: topology.neighbors,
    vertexFlags: mesh.vertexFlags,
  });
  return {
    source,
    topology,
    faceNormals: facets.normals,
    degenerate: facets.degenerate,
    providerBucketTolerance: 1.1920928955078125e-7,
    nativeGlobalValueResolved: false,
  };
}

const MAX = 3.4028234663852886e38;
export function reconstructionFrontierOverlap(
  triangle: ReconstructionTriangle,
  bounds: ArrayLike<number>,
  spacing: number,
) {
  const inverse = 1 / spacing;
  const start = [0, 1, 2].map((a) =>
    Math.fround(
      Math.floor(Math.min(...triangle.vertices.map((p) => p[a])) * inverse) *
        spacing,
    ),
  );
  const end = [0, 1, 2].map((a) =>
    Math.fround(
      Math.floor(Math.max(...triangle.vertices.map((p) => p[a])) * inverse) *
        spacing +
        spacing,
    ),
  );
  return (
    !start.some((v, a) => v > bounds[a + 3]) &&
    !end.some((v, a) => v < bounds[a])
  );
}
export function reconstructionSparseAdmission(
  options: ReconstructionFieldOptions,
) {
  // Sequential reference lanes. Limits belong to this private validator, not the native GUI.
  const { bounds, spacing, sources, initialDirection, origin, limits, signal } =
    options;
  const frontierMode = options.frontierMode ?? "single";
  if (!["single", "partitioned"].includes(frontierMode))
    throw new RangeError("Invalid private frontier mode");
  const checkpoint = () => {
    if (signal?.aborted)
      throw new DOMException(
        "Reconstruction reconstruction cancelled.",
        "AbortError",
      );
  };
  checkpoint();
  for (const kind of ["nodes", "corners", "candidates"] as const)
    if (!Number.isSafeInteger(limits[kind]) || limits[kind] < 1)
      throw new RangeError(
        "Invalid reconstruction validation " + kind + " budget",
      );
  if (!sources.length || !sources.some((source) => source.length))
    throw new RangeError(
      "Reconstruction reference requires prepared triangles",
    );
  for (const source of sources)
    for (const triangle of source)
      for (const point of triangle.vertices)
        for (let axis = 0; axis < 3; axis++)
          if (
            !Number.isFinite(point[axis]) ||
            point[axis] < bounds[axis] ||
            point[axis] > bounds[axis + 3]
          )
            throw new RangeError(
              "Supplied bounds do not cover source geometry",
            );
  const frame = reconstructionGridFrame(bounds, spacing),
    corners = new Map<string, ReconstructionCorner>();
  const diagnostics = {
    nodeCount: 0,
    candidateVisits: 0,
    admittedVisits: 0,
    triangleCornerUpdates: 0,
    repeatedTriangleCornerSkips: 0,
    outsideRootVisits: 0,
    clampedFrontierVisits: 0,
    frontierBoundsRejects: 0,
  };
  function node(box: ArrayLike<number>, depth: number): ReconstructionNode {
    if (
      diagnostics.nodeCount * 512 +
        corners.size * (1024 + sources.length * 256) >=
      512 * 1024 * 1024
    )
      throw new RangeError(
        "Reconstruction field exceeds its working-memory budget; increase point resolution.",
      );
    if (diagnostics.nodeCount >= limits.nodes)
      throw new RangeError("Reconstruction validation nodes budget exceeded");
    diagnostics.nodeCount++;
    return {
      bounds: new Float64Array(box),
      center: [0, 1, 2].map((a) => (box[a] + box[a + 3]) * 0.5),
      depth,
      children: null,
      corners: null,
    };
  }
  function expand(parent: ReconstructionNode) {
    parent.children = Array.from({ length: 8 }, (_, i) =>
      node(reconstructionChildBounds(parent.bounds, i), parent.depth + 1),
    );
  }
  const root = node(frame.bounds, 0);
  expand(root);
  if (
    root.children![0].bounds[3] - root.children![0].bounds[0] >
    spacing + 2 ** -23
  )
    for (const child of root.children!) expand(child);
  const roots =
    frontierMode === "single"
      ? [root]
      : root.children!.flatMap((child) => child.children ?? [child]);
  const frontiers = roots.map((workRoot, id) => ({
    id,
    root: workRoot,
    corners: frontierMode === "single" ? corners : new Map(),
  }));
  function findLeaf(point: number[], frontier: ReconstructionFrontier) {
    if (
      point.some(
        (v, a) =>
          v < frontier.root.bounds[a] || v > frontier.root.bounds[a + 3],
      )
    )
      diagnostics.clampedFrontierVisits++;
    if (point.some((v, a) => v < root.bounds[a] || v > root.bounds[a + 3]))
      diagnostics.outsideRootVisits++;
    let current = frontier.root;
    while (current.depth < frame.depth) {
      if (!current.children) expand(current);
      current =
        current.children![reconstructionChildIndex(point, current.center)];
    }
    return current;
  }
  function initializeCorners(
    leaf: ReconstructionNode,
    frontier: ReconstructionFrontier,
  ) {
    leaf.frontierId = frontier.id;
    leaf.corners = Array.from({ length: 8 }, (_, i) => {
      const p = [
        leaf.bounds[i & 4 ? 3 : 0],
        leaf.bounds[i & 2 ? 4 : 1],
        leaf.bounds[i & 1 ? 5 : 2],
      ];
      const key = reconstructionCornerKey(p, spacing, origin);
      if (!frontier.corners.has(key)) {
        if (
          diagnostics.nodeCount * 512 +
            corners.size * (1024 + sources.length * 256) >=
          512 * 1024 * 1024
        )
          throw new RangeError(
            "Reconstruction field exceeds its working-memory budget; increase point resolution.",
          );
        if (corners.size >= limits.corners)
          throw new RangeError(
            "Reconstruction validation corners budget exceeded",
          );
        const record: ReconstructionCorner = {
          distance: MAX,
          direction: new Float64Array(3),
          contributionCount: 0,
          point: p,
          sampledPoint: new Float32Array(p),
          samples: new Array(sources.length),
          lastTriangleId: -1,
          frontierId: frontier.id,
        };
        frontier.corners.set(key, record);
        if (frontier.corners !== corners)
          corners.set(frontier.id + ":" + key, record);
      }
      return frontier.corners.get(key)!;
    });
  }
  const absent = {
      distance: MAX,
      direction: new Float32Array(3),
      boundary: false,
    },
    half = Array(3).fill(Math.fround(spacing * 0.5));
  let serialTriangleId = 0;
  const totalTriangles =
    sources.reduce((sum, s) => sum + s.length, 0) * frontiers.length;
  let completedTriangles = 0;
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++)
    for (const frontier of frontiers) {
      let triangleId = 0;
      for (const triangle of sources[sourceIndex]) {
        checkpoint();
        if (completedTriangles++ % 1024 === 0)
          options.onProgress?.(
            completedTriangles / totalTriangles,
            "Encoding native signed field",
          );
        triangleId =
          frontierMode === "single" ? ++serialTriangleId : triangleId + 1;
        if (
          !reconstructionFrontierOverlap(
            triangle,
            frontier.root.bounds,
            spacing,
          )
        ) {
          diagnostics.frontierBoundsRejects++;
          continue;
        }
        for (const center of reconstructionTriangleCandidates(
          triangle.vertices,
          spacing,
        )) {
          checkpoint();
          if (diagnostics.candidateVisits >= limits.candidates)
            throw new RangeError(
              "Reconstruction validation candidates budget exceeded",
            );
          diagnostics.candidateVisits++;
          if (
            !reconstructionTriangleCellIntersects(
              center,
              half,
              triangle.vertices,
            )
          )
            continue;
          const leaf = findLeaf(center, frontier);
          diagnostics.admittedVisits++;
          if (!leaf.corners) initializeCorners(leaf, frontier);
          for (const corner of leaf.corners!) {
            if (corner.lastTriangleId === triangleId) {
              diagnostics.repeatedTriangleCornerSkips++;
              continue;
            }
            const previous = corner.samples[sourceIndex] ?? absent;
            const sample = reconstructionTriangleSample(
              corner.sampledPoint,
              triangle.normal,
              triangle.vertices,
              Math.abs(previous.distance),
            );
            // Native successful updates latch the source boundary flag until source initialization.
            if (Math.abs(sample.distance) < Math.abs(previous.distance))
              corner.samples[sourceIndex] = {
                distance: sample.distance,
                direction: sample.direction,
                boundary:
                  previous.boundary ||
                  !!(sample.flags & (triangle.boundaryEdges << 3)),
              };
            corner.lastTriangleId = triangleId;
            diagnostics.triangleCornerUpdates++;
          }
        }
      }
    }
  for (const corner of corners.values()) {
    checkpoint();
    const samples = Array.from(
      { length: sources.length },
      (_, i) => corner.samples[i] ?? absent,
    );
    Object.assign(
      corner,
      reconstructionCornerReduction(samples, initialDirection),
    );
  }
  const leaves: ReconstructionNode[] = [];
  function collect(current: ReconstructionNode) {
    if (current.children) for (const child of current.children) collect(child);
    else if (current.corners) leaves.push(current);
  }
  collect(root);
  return {
    mode:
      frontierMode === "single"
        ? "single-frontier-reference"
        : "partitioned-frontier-reference",
    root,
    leaves,
    corners,
    diagnostics,
    frame,
    frontiers,
  };
}

const maskCorners = [0, 2, 6, 4, 1, 3, 7, 5];
const edgeCorners = [
  [0, 2],
  [2, 6],
  [4, 6],
  [0, 4],
  [1, 3],
  [3, 7],
  [5, 7],
  [1, 5],
  [0, 1],
  [2, 3],
  [6, 7],
  [4, 5],
];
export function reconstructionFieldOutput(
  field: ReturnType<typeof reconstructionSparseAdmission>,
  options: {
    limits: { vertices: number; triangles: number };
    signal?: AbortSignal;
  },
) {
  const { limits, signal } = options;
  const checkpoint = () => {
    if (signal?.aborted)
      throw new DOMException(
        "Reconstruction extraction cancelled.",
        "AbortError",
      );
  };
  checkpoint();
  const positions: number[] = [],
    indices: number[] = [],
    vertices = new Map<string, number>();
  const diagnostics = {
    activeLeaves: 0,
    skippedRepeatedIndexFaces: 0,
    skippedAreaFaces: 0,
  };
  for (let leafIndex = 0; leafIndex < field.leaves.length; leafIndex++) {
    const leaf = field.leaves[leafIndex];
    checkpoint();
    let mask = 0;
    for (let bit = 0; bit < 8; bit++)
      if (leaf.corners![maskCorners[bit]].distance < 0) mask |= 1 << bit;
    const active = tables.edgeMasks[mask];
    if (!active) continue;
    diagnostics.activeLeaves++;
    const width = Math.max(
        leaf.bounds[3] - leaf.bounds[0],
        leaf.bounds[4] - leaf.bounds[1],
        leaf.bounds[5] - leaf.bounds[2],
      ),
      ids = new Array(12);
    for (let edge = 0; edge < 12; edge++)
      if (active & (1 << edge)) {
        const [a, b] = edgeCorners[edge],
          point = reconstructionEdgePosition(
            leaf.corners![a],
            leaf.corners![b],
            width,
          ),
          key = reconstructionVertexKey(point);
        const created = !vertices.has(key);
        if (created) {
          if (vertices.size >= limits.vertices)
            throw new RangeError(
              "Reconstruction output vertices budget exceeded",
            );
          vertices.set(key, vertices.size);
          positions.push(...point);
        }
        ids[edge] = vertices.get(key)!;
      }
    const row = tables.triangleRows[mask];
    for (let i = 1; row[i] !== -1; i += 3) {
      const face = [ids[row[i]], ids[row[i + 1]], ids[row[i + 2]]];
      if (new Set(face).size !== 3) {
        diagnostics.skippedRepeatedIndexFaces++;
        continue;
      }
      const points = face.map((id) => positions.slice(id * 3, id * 3 + 3));
      if (!reconstructionAdmitTriangle(points[0], points[1], points[2])) {
        diagnostics.skippedAreaFaces++;
        continue;
      }
      if (indices.length / 3 >= limits.triangles)
        throw new RangeError("Reconstruction output triangles budget exceeded");
      indices.push(...face);
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    diagnostics,
  };
}

export function reconstructionAdmitTriangle(
  a: number[],
  b: number[],
  c: number[],
) {
  const f = Math.fround,
    u = [0, 1, 2].map((i) => f(b[i] - a[i])),
    v = [0, 1, 2].map((i) => f(c[i] - a[i]));
  const x = f(f(v[2] * u[1]) - f(v[1] * u[2]));
  const y = f(f(v[0] * u[2]) - f(v[2] * u[0]));
  const z = f(f(v[1] * u[0]) - f(v[0] * u[1]));
  return x * x + y * y + z * z > 2 ** -23;
}

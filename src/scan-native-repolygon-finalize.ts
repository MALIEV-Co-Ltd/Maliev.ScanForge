import { NativeBoundaryTree } from "./scan-native-boundary-tree";
import type { MeshProcessingOptions } from "./mesh-processing";
import type {
  ReconstructionIndexed,
  ReconstructionFace,
  ReconstructionRecords,
  ReconstructionBoundary,
} from "./scan-native-repolygon-types";
import { nativeBuildAlignmentAdjacency as adjacency } from "./scan-native-alignment-adjacency";
export function reconstructionConnectTriangles(
  a: ReconstructionFace | null,
  b: ReconstructionFace | null,
  vertexId: number,
) {
  if (!a || !b) return false;
  const ai = a.vertices.lastIndexOf(vertexId),
    bi = b.vertices.lastIndexOf(vertexId);
  if (ai < 0 || bi < 0) return false;
  const target = (bi + 2) % 3;
  a.neighbors[ai] = b;
  b.neighbors[target] = a;
  a.neighborSlots[ai] = target;
  b.neighborSlots[target] = ai;
  return true;
}
export function reconstructionRemoveTriangle(
  triangles: ReconstructionFace[],
  index: number,
) {
  // Reconstruction guard: native callers supply a valid index.
  if (!Number.isInteger(index) || index < 0 || index >= triangles.length)
    throw new RangeError("Reconstruction triangle index outside storage");
  const removed = triangles[index];
  for (let slot = 0; slot < 3; slot++) {
    const neighbor = removed.neighbors[slot],
      back = removed.neighborSlots[slot];
    if (neighbor && neighbor.neighbors[back] === removed)
      neighbor.neighbors[back] = null;
  }
  if (index !== triangles.length - 1) {
    const last = triangles.at(-1)!;
    Object.assign(removed, last, {
      vertices: [...last.vertices],
      normal: new Float32Array(last.normal),
      neighbors: [...last.neighbors],
      neighborSlots: [...last.neighborSlots],
    });
    for (let slot = 0; slot < 3; slot++) {
      const neighbor = removed.neighbors[slot],
        back = removed.neighborSlots[slot];
      if (neighbor) {
        if (neighbor.neighbors[back] === last)
          neighbor.neighbors[back] = removed;
        else removed.neighbors[slot] = null;
      }
    }
  }
  triangles.pop();
}

export function reconstructionFaceNormal(vertices: number[][]) {
  const [a, b, c] = vertices.map((p) => Array.from(p, Math.fround));
  const u = b.map((v, axis) => v - a[axis]),
    v = c.map((v, axis) => v - a[axis]);
  const cross = [
    v[2] * u[1] - v[1] * u[2],
    v[0] * u[2] - v[2] * u[0],
    v[1] * u[0] - v[0] * u[1],
  ];
  const length = Math.sqrt(
    cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2],
  );
  const degenerate = length <= 2 ** -52;
  if (length > 2 ** -52) {
    const denominator = Math.fround(length);
    for (let axis = 0; axis < 3; axis++) cross[axis] /= denominator;
  }
  return { normal: new Float32Array(cross), degenerate };
}

const f = Math.fround,
  epsilon = 2 ** -52;
export function reconstructionVertexNormals(
  mesh: ReconstructionIndexed,
  options: {
    recomputeFaceNormals?: boolean;
    cachedFaceNormals?: Float32Array;
  } = {},
) {
  const { positions, indices } = mesh,
    normals = new Float32Array(positions.length);
  const recompute = options.recomputeFaceNormals ?? !options.cachedFaceNormals;
  const faceNormals = recompute
    ? new Float32Array(indices.length)
    : new Float32Array(options.cachedFaceNormals!);
  for (let face = 0; face < indices.length; face += 3) {
    const ids = [indices[face], indices[face + 1], indices[face + 2]];
    const points = ids.map((id) =>
      Array.from(positions.subarray(id * 3, id * 3 + 3)),
    );
    if (recompute)
      faceNormals.set(reconstructionFaceNormal(points).normal, face);
    for (let corner = 0; corner < 3; corner++) {
      const p = points[corner],
        q = points[(corner + 1) % 3],
        r = points[(corner + 2) % 3];
      const u = q.map((v, a) => f(v - p[a])),
        v = r.map((v, a) => f(v - p[a]));
      const uu = u[1] * u[1] + u[0] * u[0] + u[2] * u[2],
        vv = v[1] * v[1] + v[0] * v[0] + v[2] * v[2];
      const angle =
        uu < epsilon || vv < epsilon
          ? 0
          : Math.acos(
              (u[1] * v[1] + u[0] * v[0] + u[2] * v[2]) / Math.sqrt(uu * vv),
            );
      const start = ids[corner] * 3;
      for (let axis = 0; axis < 3; axis++)
        normals[start + axis] =
          f(faceNormals[face + axis] * angle) + normals[start + axis];
    }
  }
  for (let start = 0; start < normals.length; start += 3) {
    const x = normals[start],
      y = normals[start + 1],
      z = normals[start + 2];
    const length = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
    if (length >= epsilon) {
      const reciprocal = 1 / length;
      for (let axis = 0; axis < 3; axis++) normals[start + axis] *= reciprocal;
    }
  }
  return { normals, faceNormals };
}

export function reconstructionCompactFreshOutput(mesh: ReconstructionIndexed) {
  const { positions, indices } = mesh,
    count = positions.length / 3,
    used = new Uint8Array(count);
  for (const id of indices) {
    if (id >= count) throw new RangeError("Output index outside vertex buffer");
    used[id] = 1;
  }
  let retained = 0;
  const remap = new Uint32Array(count);
  for (let id = 0; id < count; id++) if (used[id]) remap[id] = retained++;
  const compactPositions = new Float32Array(retained * 3),
    compactIndices = new Uint32Array(indices.length);
  for (let id = 0; id < count; id++)
    if (used[id])
      compactPositions.set(
        positions.subarray(id * 3, id * 3 + 3),
        remap[id] * 3,
      );
  for (let i = 0; i < indices.length; i++)
    compactIndices[i] = remap[indices[i]];
  return { positions: compactPositions, indices: compactIndices };
}

export function reconstructionCollectBoundaries(mesh: ReconstructionRecords) {
  // Requires supplied adjacency; the recovered adjacency preserves native directed-edge matching.
  const tree = new NativeBoundaryTree<ReconstructionBoundary>();
  for (const triangle of mesh.triangles)
    for (let slot = 0; slot < 3; slot++)
      if (!triangle.neighbors[slot]) {
        const start = triangle.vertices[slot],
          end = triangle.vertices[(slot + 1) % 3];
        tree.insert({ start, end, vertexId: start, triangle });
      }
  const loops: ReconstructionBoundary[][] = [];
  while (tree.size) {
    const loop = tree.takeNextWalk();
    if (!loop.length) break;
    loops.push(loop);
  }
  return loops;
}

export function reconstructionRepairThreeEdgeLoop(
  mesh: ReconstructionRecords,
  loop: ReconstructionBoundary[],
  state: { rebuildAdjacency: boolean },
) {
  // Reconstruction guard: the native coordinator only calls this helper for three records.
  if (loop.length !== 3)
    throw new RangeError(
      "Reconstruction repair requires three boundary records",
    );
  loop.reverse();
  const [a, b, c] = loop.map((r) => r.triangle);
  if (a === b && b === c) {
    const index = mesh.triangles.indexOf(a);
    if (index >= 0) reconstructionRemoveTriangle(mesh.triangles, index);
    return true;
  }
  if (a === b || a === c || b === c) return false;
  const vertices = loop.map((r) => r.vertexId);
  if (new Set(vertices).size !== 3) return false;
  const [p, q, r] = vertices.map((id) =>
    Array.from(mesh.positions.subarray(id * 3, id * 3 + 3)),
  );
  const u = q.map((v, axis) => f(v - p[axis])),
    v = r.map((v, axis) => f(v - p[axis]));
  const normal = new Float32Array([
    f(f(u[1] * v[2]) - f(u[2] * v[1])),
    f(f(u[2] * v[0]) - f(u[0] * v[2])),
    f(f(u[0] * v[1]) - f(u[1] * v[0])),
  ]);
  const length = f(
    Math.sqrt(
      f(
        f(f(normal[0] * normal[0]) + f(normal[1] * normal[1])) +
          f(normal[2] * normal[2]),
      ),
    ),
  );
  if (length >= 2 ** -52) {
    const reciprocal = 1 / length;
    for (let axis = 0; axis < 3; axis++) normal[axis] *= reciprocal;
  }
  const cap: ReconstructionFace = {
    vertices,
    normal,
    neighbors: [null, null, null],
    neighborSlots: [-1, -1, -1],
    flags: 0,
  };
  mesh.triangles.push(cap);
  state.rebuildAdjacency = false;
  for (const [neighbor, vertexId] of [
    [b, vertices[0]],
    [c, vertices[1]],
    [a, vertices[2]],
  ] as [ReconstructionFace, number][])
    if (!reconstructionConnectTriangles(cap, neighbor, vertexId))
      state.rebuildAdjacency = true;
  return true;
}

export function reconstructionFinalizeOutput(
  input: ReconstructionIndexed,
  options: MeshProcessingOptions & { maxTriangles?: number } = {},
) {
  const checkpoint = () => {
    if (options.signal?.aborted)
      throw new DOMException(
        "Reconstruction finalization cancelled.",
        "AbortError",
      );
  };
  checkpoint();
  const diagnostics = {
    boundaryWalks: 0,
    handledThreeEdgeWalks: 0,
    appendedCaps: 0,
    removedTriangles: 0,
    normalsUpdatedAfterRepair: false,
    adjacencyRebuiltAfterRepair: false,
    retiredPointerReads: 0,
  };
  const mesh = reconstructionCompactFreshOutput(input),
    maxTriangles = options.maxTriangles ?? Infinity;
  if (mesh.indices.length / 3 > maxTriangles)
    throw new RangeError("Reconstruction output triangle budget exceeded");
  if (!mesh.indices.length)
    return { ...mesh, normals: new Float32Array(0), diagnostics };
  let generated = reconstructionVertexNormals(mesh);
  checkpoint();
  const records: ReconstructionRecords = {
    positions: mesh.positions,
    triangles: Array.from({ length: mesh.indices.length / 3 }, (_, i) => ({
      vertices: Array.from(mesh.indices.subarray(i * 3, i * 3 + 3)),
      normal: generated.faceNormals.slice(i * 3, i * 3 + 3),
      neighbors: [null, null, null],
      neighborSlots: [-1, -1, -1],
      flags: 0,
    })),
  };
  const packed = () => ({
    positions: records.positions,
    indices: Uint32Array.from(records.triangles.flatMap((t) => t.vertices)),
  });
  function link() {
    const geometry = packed(),
      topology = adjacency(geometry.positions, geometry.indices, options);
    for (let i = 0; i < records.triangles.length; i++)
      for (let slot = 0; slot < 3; slot++) {
        const at = i * 3 + slot,
          n = topology.neighbors[at];
        records.triangles[i].neighbors[slot] =
          n < 0 ? null : records.triangles[n];
        records.triangles[i].neighborSlots[slot] =
          n < 0 ? -1 : topology.neighborEdges[at];
      }
  }
  link();
  checkpoint();
  const walks = reconstructionCollectBoundaries(records),
    active = new Set(records.triangles),
    state = { rebuildAdjacency: false };
  diagnostics.boundaryWalks = walks.length;
  for (const walk of walks) {
    checkpoint();
    if (walk.length !== 3) continue;
    // Retired/reused native slots need a storage-lifetime trace before translation.
    if (walk.some((r) => !active.has(r.triangle))) {
      const error = Object.assign(
        new Error(
          "Reconstruction reached an unsupported retired triangle reference; original mesh retained.",
        ),
        {
          code: "UNRESOLVED_RETIRED_TRIANGLE_POINTER",
          diagnostics: { ...diagnostics, retiredPointerReads: 1 },
        },
      );
      throw error;
    }
    const oldCount = records.triangles.length,
      last = records.triangles.at(-1)!;
    if (reconstructionRepairThreeEdgeLoop(records, walk, state)) {
      diagnostics.handledThreeEdgeWalks++;
      if (records.triangles.length < oldCount) {
        diagnostics.removedTriangles++;
        active.delete(last);
      }
      if (records.triangles.length > oldCount) {
        diagnostics.appendedCaps++;
        active.add(records.triangles.at(-1)!);
      }
      if (records.triangles.length > maxTriangles)
        throw new RangeError("Reconstruction output triangle budget exceeded");
    }
  }
  if (diagnostics.handledThreeEdgeWalks) {
    if (state.rebuildAdjacency && records.triangles.length) {
      link();
      diagnostics.adjacencyRebuiltAfterRepair = true;
    }
    const geometry = packed(),
      cachedFaceNormals = Float32Array.from(
        records.triangles.flatMap((t) => Array.from(t.normal)),
      );
    generated = reconstructionVertexNormals(geometry, {
      cachedFaceNormals,
      recomputeFaceNormals: false,
    });
    diagnostics.normalsUpdatedAfterRepair = true;
  }
  checkpoint();
  const geometry = packed(),
    output = reconstructionCompactFreshOutput(geometry),
    used = new Uint8Array(geometry.positions.length / 3),
    normals = new Float32Array(output.positions.length);
  for (const id of geometry.indices) used[id] = 1;
  let target = 0;
  for (let id = 0; id < used.length; id++)
    if (used[id]) {
      normals.set(generated.normals.subarray(id * 3, id * 3 + 3), target);
      target += 3;
    }
  return { ...output, normals, diagnostics };
}

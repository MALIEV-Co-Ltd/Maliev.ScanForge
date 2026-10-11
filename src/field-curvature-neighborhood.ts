import type { CurvatureEdgeData } from "./field-edge-curvature";

export interface CurvatureNeighborhoodOptions {
  sharpVertices?: Uint8Array;
  excludedSeeds?: Uint8Array;
  previousTensors?: Float64Array;
  previousNeighborCounts?: Uint32Array;
}

/** Recovered radius-limited edge traversal; masks are bounded packed vertex bits. */
export function aggregateCurvatureNeighborhoods(
  positions: Float32Array,
  edges: CurvatureEdgeData,
  radius: number,
  options: CurvatureNeighborhoodOptions = {},
): { tensors: Float64Array; neighborCounts: Uint32Array } {
  const vertices = positions.length / 3;
  const endpoints = edges.adjacency.edgeVertices;
  const count = endpoints.length / 2;
  if (
    !Number.isInteger(vertices) ||
    !Number.isInteger(count) ||
    edges.lengths.length !== count ||
    edges.angles.length !== count ||
    edges.tensors.length !== count * 6 ||
    (options.previousTensors &&
      options.previousTensors.length !== vertices * 6) ||
    (options.previousNeighborCounts &&
      options.previousNeighborCounts.length !== vertices)
  )
    throw new Error("Curvature neighborhood dimensions are inconsistent.");
  for (const array of [
    positions,
    edges.lengths,
    edges.angles,
    edges.tensors,
    options.previousTensors ?? [],
  ])
    for (const value of array)
      if (!Number.isFinite(value))
        throw new Error("Curvature neighborhoods require finite data.");
  for (const vertex of endpoints)
    if (vertex >= vertices) throw new Error("Invalid curvature edge endpoint.");
  if (!Number.isFinite(radius))
    throw new Error("Curvature radius must be finite.");
  const tensors =
    options.previousTensors?.slice() ?? new Float64Array(vertices * 6);
  const neighborCounts =
    options.previousNeighborCounts?.slice() ?? new Uint32Array(vertices);
  const f = Math.fround;
  const r = f(radius);
  if (!Number.isFinite(r)) throw new Error("Curvature radius overflowed.");
  if (r <= 0) return { tensors, neighborCounts };
  const squaredRadius = f(r * r);
  const normalization = f(1 / f(squaredRadius * f(Math.PI)));
  if (!Number.isFinite(normalization) || normalization === 0)
    throw new Error("Curvature radius cannot be normalized safely.");
  // Native incidence inserts endpoint pairs in ascending edge ID order.
  const offsets = new Uint32Array(vertices + 1);
  for (const vertex of endpoints) offsets[vertex + 1]++;
  for (let vertex = 0; vertex < vertices; vertex++)
    offsets[vertex + 1] += offsets[vertex];
  const cursor = offsets.slice(0, vertices);
  const incidence = new Uint32Array(endpoints.length);
  for (let endpoint = 0; endpoint < endpoints.length; endpoint++)
    incidence[cursor[endpoints[endpoint]]++] = Math.floor(endpoint / 2);
  const marked = (mask: Uint8Array | undefined, vertex: number) =>
    !!(
      mask &&
      vertex < mask.length * 8 &&
      mask[vertex >> 3] & (1 << (vertex & 7))
    );
  const vertexStamp = new Float64Array(vertices);
  const edgeStamp = new Float64Array(count);
  const stack = new Uint32Array(vertices);
  const squaredDistance = (vertex: number, seed: number) => {
    const x = f(positions[vertex * 3] - positions[seed * 3]);
    const y = f(positions[vertex * 3 + 1] - positions[seed * 3 + 1]);
    const z = f(positions[vertex * 3 + 2] - positions[seed * 3 + 2]);
    return f(f(f(x * x) + f(y * y)) + f(z * z));
  };
  for (let seed = 0; seed < vertices; seed++) {
    if (
      marked(options.sharpVertices, seed) ||
      marked(options.excludedSeeds, seed)
    )
      continue;
    const generation = seed + 1;
    vertexStamp[seed] = generation;
    stack[0] = seed;
    let pending = 1;
    const sum = new Float64Array(6);
    while (pending) {
      const vertex = stack[--pending];
      for (let i = offsets[vertex]; i < offsets[vertex + 1]; i++) {
        const edge = incidence[i];
        if (edgeStamp[edge] === generation) continue;
        edgeStamp[edge] = generation;
        if (edges.lengths[edge] === 0) continue;
        const other =
          endpoints[edge * 2] === vertex
            ? endpoints[edge * 2 + 1]
            : endpoints[edge * 2];
        const squared = squaredDistance(other, seed);
        let weight = 1;
        if (squared < squaredRadius) {
          if (vertexStamp[other] !== generation) {
            vertexStamp[other] = generation;
            if (neighborCounts[seed] === 0xffffffff)
              throw new Error("Curvature neighbor count overflowed.");
            neighborCounts[seed]++;
            if (!marked(options.sharpVertices, other)) stack[pending++] = other;
          }
        } else {
          const outer = f(Math.sqrt(squared));
          const inner = f(Math.sqrt(squaredDistance(vertex, seed)));
          weight = f(f(r - inner) / f(outer - inner));
        }
        if (edges.angles[edge] !== 0)
          for (let lane = 0; lane < 6; lane++)
            sum[lane] += weight * edges.tensors[edge * 6 + lane];
      }
    }
    for (let lane = 0; lane < 6; lane++) {
      const value = sum[lane] * normalization;
      if (!Number.isFinite(value))
        throw new Error("Curvature neighborhood arithmetic overflowed.");
      tensors[seed * 6 + lane] = value;
    }
  }
  return { tensors, neighborCounts };
}

export interface CurvaturePathConstraint {
  enabled: boolean;
  mode: number;
  /** Already refreshed world-space path points. */
  points: Float32Array;
  /** Cached mapping records' vertex lane and consecutive segment edge results. */
  mappedVertices?: Int32Array;
  mappedEdges?: Int32Array;
}

const f = Math.fround;
function normalizedDifference(points: Float32Array, a: number, b: number) {
  const vector = new Float32Array(3);
  for (let axis = 0; axis < 3; axis++)
    vector[axis] = f(points[a * 3 + axis] - points[b * 3 + axis]);
  const length = f(
    Math.sqrt(
      f(
        f(f(vector[0] * vector[0]) + f(vector[1] * vector[1])) +
          f(vector[2] * vector[2]),
      ),
    ),
  );
  if (!(length > -1e-24 && length < 1e-24)) {
    const reciprocal = 1 / length;
    for (let axis = 0; axis < 3; axis++)
      vector[axis] = f(vector[axis] * reciprocal);
  }
  if (
    !Number.isFinite(length) ||
    vector.some((value) => !Number.isFinite(value))
  )
    throw new Error("Curvature path direction overflowed.");
  return vector;
}

/** Recovered refreshed-path tangent preparation with double reciprocal scaling. */
export function prepareCurvaturePathTangents(
  paths: readonly (CurvaturePathConstraint | null)[],
) {
  return paths.map((path) => {
    if (!path || !path.enabled || path.mode === 3) return new Float32Array();
    if (
      !Number.isInteger(path.mode) ||
      path.mode < -2147483648 ||
      path.mode > 2147483647 ||
      path.points.length % 3
    )
      throw new Error("Curvature path dimensions or mode are invalid.");
    if (path.points.some((value) => !Number.isFinite(value)))
      throw new Error("Curvature path points must be finite.");
    const count = path.points.length / 3;
    const tangents = new Float32Array(path.points.length);
    if (count > 1) {
      tangents.set(normalizedDifference(path.points, 1, 0));
      for (let point = 1; point < count - 1; point++)
        tangents.set(
          normalizedDifference(path.points, point + 1, point - 1),
          point * 3,
        );
      tangents.set(
        normalizedDifference(path.points, count - 1, count - 2),
        (count - 1) * 3,
      );
    }
    return tangents;
  });
}

/** Recovered triangle-path direction stage using supplied first-stage associations/caches. */
export function applyCurvaturePathDirections(
  paths: readonly (CurvaturePathConstraint | null)[],
  positions: Float32Array,
  triangles: Uint32Array,
  normals: Float32Array,
  associations: {
    vertexDistances: Float32Array;
    vertexSeeds: Int32Array;
    seedPaths: Int32Array;
    seedPoints: Int32Array;
    faceDistances: Float32Array;
  },
  incidence: { edgeOffsets: Uint32Array; halfedges: Uint32Array },
  previousDirections: Float32Array,
  previousFlags: Uint8Array,
) {
  const vertices = positions.length / 3;
  const faces = triangles.length / 3;
  const edges = incidence.edgeOffsets.length - 1;
  const { vertexDistances, vertexSeeds, seedPaths, seedPoints, faceDistances } =
    associations;
  if (
    positions.length % 3 ||
    triangles.length % 3 ||
    normals.length !== triangles.length ||
    previousDirections.length !== triangles.length ||
    previousFlags.length !== faces ||
    vertexDistances.length !== vertices ||
    vertexSeeds.length !== vertices ||
    seedPaths.length !== seedPoints.length ||
    faceDistances.length !== faces ||
    !incidence.edgeOffsets.length ||
    incidence.edgeOffsets[0] !== 0
  )
    throw new Error("Curvature path cache dimensions are inconsistent.");
  for (const values of [
    positions,
    normals,
    previousDirections,
    vertexDistances,
    faceDistances,
  ])
    if (values.some((value) => !Number.isFinite(value)))
      throw new Error("Curvature path cache data must be finite.");
  for (const vertex of triangles)
    if (vertex >= vertices)
      throw new Error("Curvature path triangle references an invalid vertex.");
  for (let edge = 0; edge < edges; edge++)
    if (
      incidence.edgeOffsets[edge] > incidence.edgeOffsets[edge + 1] ||
      incidence.edgeOffsets[edge + 1] > incidence.halfedges.length
    )
      throw new Error("Curvature path edge offsets are invalid.");
  for (let index = 0; index < incidence.edgeOffsets[edges]; index++)
    if (Math.floor(incidence.halfedges[index] / 3) >= faces)
      throw new Error(
        "Curvature path edge incidence references an invalid face.",
      );
  const tangents = prepareCurvaturePathTangents(paths);
  const directions = previousDirections.slice();
  const flags = previousFlags.slice();
  // The original scratch direction is initialized once, then reused across faces.
  const current = new Float32Array(3);
  for (let face = 0; face < faces; face++) {
    if (faceDistances[face] > 0.5) continue;
    const faceVertices = triangles.subarray(face * 3, face * 3 + 3);
    const seeds = Array.from(faceVertices, (vertex) => vertexSeeds[vertex]);
    for (const seed of seeds)
      if (
        seed < 0 ||
        seed >= seedPaths.length ||
        seedPaths[seed] < 0 ||
        seedPaths[seed] >= paths.length ||
        !paths[seedPaths[seed]]
      )
        throw new Error("Curvature path face references an invalid seed.");
    if (seeds.some((seed) => paths[seedPaths[seed]]!.mode !== 0)) continue;
    let minimum = f(3.4028235e38);
    for (let corner = 0; corner < 3; corner++) {
      const distance = vertexDistances[faceVertices[corner]];
      if (!(distance < minimum)) continue;
      const seed = seeds[corner];
      const tangent = tangents[seedPaths[seed]];
      const point = seedPoints[seed];
      if (point < 0 || point * 3 + 3 > tangent.length)
        throw new Error("Curvature path face references an invalid tangent.");
      current.set(tangent.subarray(point * 3, point * 3 + 3));
      minimum = distance;
    }
    const base = face * 3;
    const dot = f(
      f(f(current[0] * normals[base]) + f(current[1] * normals[base + 1])) +
        f(current[2] * normals[base + 2]),
    );
    for (let axis = 0; axis < 3; axis++)
      current[axis] = f(current[axis] - f(normals[base + axis] * dot));
    if (current.some((value) => !Number.isFinite(value)))
      throw new Error("Curvature path projection overflowed.");
    directions.set(current, base);
    flags[face] = 5;
  }
  for (const path of paths) {
    if (!path || !path.enabled || (path.mode !== 1 && path.mode !== 2))
      continue;
    const mappedVertices = path.mappedVertices ?? new Int32Array();
    const mappedEdges = path.mappedEdges ?? new Int32Array();
    if (mappedEdges.length !== Math.max(0, mappedVertices.length - 1))
      throw new Error("Curvature path segment mapping is inconsistent.");
    for (let segment = 0; segment < mappedEdges.length; segment++) {
      const edge = mappedEdges[segment];
      if (edge === -1) continue;
      const a = mappedVertices[segment];
      const b = mappedVertices[segment + 1];
      if (
        edge < 0 ||
        edge >= edges ||
        a < 0 ||
        a >= vertices ||
        b < 0 ||
        b >= vertices
      )
        throw new Error("Curvature path segment references invalid geometry.");
      const direction = normalizedDifference(positions, b, a);
      const start = incidence.edgeOffsets[edge];
      const end = incidence.edgeOffsets[edge + 1];
      if (end - start !== 1 && end - start !== 2) continue;
      for (let index = start; index < end; index++) {
        const face = Math.floor(incidence.halfedges[index] / 3);
        directions.set(direction, face * 3);
        flags[face] = 5;
      }
    }
  }
  return { directions, flags, tangents };
}

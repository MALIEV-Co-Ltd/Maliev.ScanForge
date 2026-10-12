import type { CurvaturePathConstraint } from "./field-curvature-paths";

export interface CurvatureAssociationSource extends CurvaturePathConstraint {
  radius: number;
  surfaceFaces?: Int32Array;
  mappedKinds?: Int32Array;
}

/** Recovered guide seeding and FIFO association over supplied triangle/vertex-edge caches. */
export function deriveCurvaturePathAssociations(
  paths: readonly (CurvatureAssociationSource | null)[],
  positions: Float32Array,
  triangles: Uint32Array,
  adjacency: {
    edgeVertices: Int32Array;
    vertexEdgeOffsets: Uint32Array;
    vertexEdges: Uint32Array;
  },
) {
  const f = Math.fround;
  const maximum = f(3.4028235e38);
  const vertices = positions.length / 3;
  const { edgeVertices, vertexEdgeOffsets, vertexEdges } = adjacency;
  const edges = edgeVertices.length / 2;
  if (
    positions.length % 3 ||
    triangles.length % 3 ||
    edgeVertices.length % 2 ||
    vertexEdgeOffsets.length !== vertices + 1 ||
    vertexEdgeOffsets[0] !== 0
  )
    throw new Error("Curvature association cache dimensions are inconsistent.");
  if (positions.some((value) => !Number.isFinite(value)))
    throw new Error("Curvature association positions must be finite.");
  for (const vertex of triangles)
    if (vertex >= vertices)
      throw new Error(
        "Curvature association triangle references an invalid vertex.",
      );
  for (let vertex = 0; vertex < vertices; vertex++) {
    if (
      vertexEdgeOffsets[vertex] > vertexEdgeOffsets[vertex + 1] ||
      vertexEdgeOffsets[vertex + 1] > vertexEdges.length
    )
      throw new Error("Curvature association vertex offsets are invalid.");
    for (
      let index = vertexEdgeOffsets[vertex];
      index < vertexEdgeOffsets[vertex + 1];
      index++
    ) {
      const edge = vertexEdges[index];
      if (
        edge >= edges ||
        (edgeVertices[edge * 2] !== vertex &&
          edgeVertices[edge * 2 + 1] !== vertex)
      )
        throw new Error(
          "Curvature association vertex-edge cache is inconsistent.",
        );
    }
  }
  for (const vertex of edgeVertices)
    if (vertex < -1 || vertex >= vertices)
      throw new Error(
        "Curvature association edge references an invalid vertex.",
      );
  for (const path of paths) {
    if (!path || !path.enabled || path.mode === 3) continue;
    if (
      !Number.isInteger(path.mode) ||
      path.mode < -2147483648 ||
      path.mode > 2147483647 ||
      path.points.length % 3 ||
      path.points.some((value) => !Number.isFinite(value)) ||
      !Number.isFinite(f(path.radius)) ||
      f(path.radius) <= 0
    )
      throw new Error("Curvature association guide data are invalid.");
    if ((path.mappedKinds?.length ?? 0) !== (path.mappedVertices?.length ?? 0))
      throw new Error(
        "Curvature association mapped record dimensions are inconsistent.",
      );
  }
  const vertexDistances = new Float32Array(vertices).fill(maximum);
  const vertexSeeds = new Int32Array(vertices).fill(-1);
  const seedPaths: number[] = [];
  const seedPoints: number[] = [];
  const links = new Int32Array(vertices).fill(-1);
  let head = -1;
  let tail = -1;
  const enqueue = (vertex: number) => {
    if (links[vertex] !== -1) return;
    links[vertex] = -2;
    if (tail < 0) head = vertex;
    else links[tail] = vertex;
    tail = vertex;
  };
  const seed = (vertex: number, path: number, point: number) => {
    if (vertex < 0 || vertex >= vertices)
      throw new Error(
        "Curvature association seed references an invalid vertex.",
      );
    if (vertexDistances[vertex] === 0) return;
    enqueue(vertex);
    vertexDistances[vertex] = 0;
    vertexSeeds[vertex] = seedPaths.length;
    seedPaths.push(path);
    seedPoints.push(point);
  };
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    const path = paths[pathIndex];
    if (!path || !path.enabled || path.mode === 3) continue;
    if (path.mode === 0) {
      const mappedFaces = path.surfaceFaces ?? new Int32Array();
      for (let point = 0; point < mappedFaces.length; point++) {
        const face = mappedFaces[point];
        if (face === -1) continue;
        if (face < 0 || face * 3 + 3 > triangles.length)
          throw new Error(
            "Curvature association guide references an invalid face.",
          );
        for (let corner = 0; corner < 3; corner++)
          seed(triangles[face * 3 + corner], pathIndex, point);
      }
    } else {
      const kinds = path.mappedKinds ?? new Int32Array();
      const mapped = path.mappedVertices ?? new Int32Array();
      for (let point = 0; point < kinds.length; point++)
        if (kinds[point] === 1 && mapped[point] !== -1)
          seed(mapped[point], pathIndex, point);
    }
  }
  while (head !== -1) {
    const current = head;
    head = links[current];
    links[current] = -1;
    if (head === -2) head = tail = -1;
    const seedIndex = vertexSeeds[current];
    const path = paths[seedPaths[seedIndex]]!;
    const point = seedPoints[seedIndex];
    let source: Float32Array = new Float32Array(3);
    if (path.points.length) {
      if (point * 3 + 3 > path.points.length)
        throw new Error(
          "Curvature association references an invalid guide point.",
        );
      source = path.points.subarray(point * 3, point * 3 + 3);
    } else if (
      (path.mappedKinds?.length ?? 0) > 0 &&
      path.mappedKinds![point] === 1
    ) {
      const mappedVertex = path.mappedVertices![point];
      if (mappedVertex < 0 || mappedVertex >= vertices)
        throw new Error(
          "Curvature association references an invalid mapped point.",
        );
      source = positions.subarray(mappedVertex * 3, mappedVertex * 3 + 3);
    }
    for (
      let index = vertexEdgeOffsets[current];
      index < vertexEdgeOffsets[current + 1];
      index++
    ) {
      const edge = vertexEdges[index];
      const neighbor =
        edgeVertices[edge * 2] === current
          ? edgeVertices[edge * 2 + 1]
          : edgeVertices[edge * 2];
      if (neighbor === -1) continue;
      const x = f(positions[neighbor * 3] - source[0]);
      const y = f(positions[neighbor * 3 + 1] - source[1]);
      const z = f(positions[neighbor * 3 + 2] - source[2]);
      const distance = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
      const candidate = Math.max(
        distance,
        f(vertexDistances[current] * f(1.005)),
      );
      const limit = f(f(path.radius) + f(path.radius));
      if (!Number.isFinite(candidate) || !Number.isFinite(limit))
        throw new Error("Curvature association distance overflowed.");
      if (candidate < vertexDistances[neighbor] && candidate < limit) {
        enqueue(neighbor);
        vertexDistances[neighbor] = candidate;
        vertexSeeds[neighbor] = seedIndex;
      }
    }
  }
  const faceDistances = new Float32Array(triangles.length / 3).fill(maximum);
  for (let face = 0; face < faceDistances.length; face++) {
    const corners = triangles.subarray(face * 3, face * 3 + 3);
    if (corners.some((vertex) => vertexSeeds[vertex] < 0)) continue;
    const ratios = Array.from(corners, (vertex) =>
      f(
        vertexDistances[vertex] /
          f(paths[seedPaths[vertexSeeds[vertex]]]!.radius),
      ),
    );
    const distance = f(f(f(ratios[1] + ratios[0]) + ratios[2]) / 3);
    if (!Number.isFinite(distance))
      throw new Error("Curvature association face distance overflowed.");
    faceDistances[face] = distance;
  }
  return {
    vertexDistances,
    vertexSeeds,
    seedPaths: new Int32Array(seedPaths),
    seedPoints: new Int32Array(seedPoints),
    faceDistances,
  };
}

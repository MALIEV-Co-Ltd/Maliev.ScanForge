import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL(
    "../docs/evidence/cloudcompare-20261028/",
    import.meta.url,
  ),
  out = new URL("meshing-continuation/", root);
const manifest = JSON.parse(
  await readFile(new URL("real-surface/manifest.json", root), "utf8"),
);
const sourceBytes = await readFile(manifest.sourcePath);
assert.equal(
  createHash("sha256").update(sourceBytes).digest("hex"),
  manifest.sourceSha256,
);
const lines = sourceBytes.toString().split(/\r?\n/),
  expectedPositions = [],
  expectedNormals = [];
for (const index of manifest.selection.sourceLineIndicesZeroBased) {
  const values = lines[index].trim().split(/\s+/).map(Number);
  assert.equal(values.length, 6);
  expectedPositions.push(...values.slice(0, 3).map(Math.fround));
  expectedNormals.push(...values.slice(3));
}
const meshBytes = await readFile(
    new URL("real-surface-mesh-geometry.json", out),
  ),
  cloud = JSON.parse(
    await readFile(new URL("real-surface-cloud-geometry.json", out), "utf8"),
  ),
  mesh = JSON.parse(meshBytes.toString());
assert.deepEqual(cloud.positions, expectedPositions);
assert.deepEqual(cloud.normals, expectedNormals);
assert.deepEqual(mesh.indexedMesh.vertices, expectedPositions);
const { vertices, triangles } = mesh.indexedMesh,
  edges = new Map(),
  used = new Set(),
  faces = new Set(),
  parent = Int32Array.from({ length: vertices.length / 3 }, (_, i) => i);
const find = (id) => {
  while (parent[id] !== id) {
    parent[id] = parent[parent[id]];
    id = parent[id];
  }
  return id;
};
const union = (a, b) => {
  parent[find(a)] = find(b);
};
let area = 0,
  projectedArea = 0,
  maxEdge = 0,
  degenerate = 0,
  duplicates = 0,
  positive = 0,
  negative = 0,
  minAngle = 180;
const axis = manifest.selection.normalAxis;
for (let i = 0; i < triangles.length; i += 3) {
  const ids = triangles.slice(i, i + 3),
    key = ids
      .slice()
      .sort((a, b) => a - b)
      .join(",");
  if (faces.has(key)) duplicates++;
  faces.add(key);
  const points = ids.map((id) => vertices.slice(id * 3, id * 3 + 3));
  for (let j = 0; j < 3; j++) {
    const a = ids[j],
      b = ids[(j + 1) % 3],
      key = [a, b].sort((a, b) => a - b).join(",");
    used.add(a);
    union(a, b);
    const edge = edges.get(key) ?? {
      a: Math.min(a, b),
      b: Math.max(a, b),
      incidence: 0,
      direction: 0,
    };
    edge.incidence++;
    edge.direction += a < b ? 1 : -1;
    edges.set(key, edge);
    maxEdge = Math.max(
      maxEdge,
      Math.hypot(...points[j].map((v, d) => v - points[(j + 1) % 3][d])),
    );
    const u = points[(j + 1) % 3].map((v, d) => v - points[j][d]),
      v = points[(j + 2) % 3].map((value, d) => value - points[j][d]);
    minAngle = Math.min(
      minAngle,
      (Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            u.reduce((sum, value, d) => sum + value * v[d], 0) /
              (Math.hypot(...u) * Math.hypot(...v)),
          ),
        ),
      ) *
        180) /
        Math.PI,
    );
  }
  const [a, b, c] = points,
    u = b.map((v, j) => v - a[j]),
    v = c.map((value, j) => value - a[j]);
  const cross = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const doubleArea = Math.hypot(...cross);
  area += doubleArea / 2;
  projectedArea += Math.abs(cross[axis]) / 2;
  if (!doubleArea) degenerate++;
  if (cross[axis] > 0) positive++;
  else if (cross[axis] < 0) negative++;
  for (let j = 0; j < 3; j++)
    for (let d = 0; d < 3; d++)
      assert.equal(mesh.positions[(i + j) * 3 + d], vertices[ids[j] * 3 + d]);
}
const boundary = [...edges.values()].filter((edge) => edge.incidence === 1),
  adjacency = new Map();
for (const edge of boundary)
  for (const [a, b] of [
    [edge.a, edge.b],
    [edge.b, edge.a],
  ]) {
    const neighbors = adjacency.get(a) ?? [];
    neighbors.push(b);
    adjacency.set(a, neighbors);
  }
const visited = new Set();
let boundaryComponents = 0,
  closedBoundaryLoops = 0,
  branchingBoundaryComponents = 0;
for (const start of adjacency.keys()) {
  if (visited.has(start)) continue;
  boundaryComponents++;
  const queue = [start];
  visited.add(start);
  let closed = true;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i],
      neighbors = adjacency.get(current);
    if (neighbors.length !== 2) closed = false;
    for (const next of neighbors)
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
  }
  if (closed) closedBoundaryLoops++;
  else branchingBoundaryComponents++;
}
const usedComponents = new Set([...used].map(find));
const links = new Map();
for (let i = 0; i < triangles.length; i += 3) {
  const ids = triangles.slice(i, i + 3);
  for (let j = 0; j < 3; j++) {
    const vertex = ids[j],
      a = ids[(j + 1) % 3],
      b = ids[(j + 2) % 3],
      link = links.get(vertex) ?? new Map();
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const neighbors = link.get(from) ?? new Set();
      neighbors.add(to);
      link.set(from, neighbors);
    }
    links.set(vertex, link);
  }
}
let nonManifoldVertices = 0;
for (const [vertex, link] of links) {
  const reached = new Set(),
    queue = [link.keys().next().value];
  reached.add(queue[0]);
  for (let i = 0; i < queue.length; i++)
    for (const neighbor of link.get(queue[i]))
      if (!reached.has(neighbor)) {
        reached.add(neighbor);
        queue.push(neighbor);
      }
  const degrees = [...link.values()].map((neighbors) => neighbors.size);
  const shape = adjacency.has(vertex)
    ? degrees.filter((degree) => degree === 1).length === 2 &&
      degrees.every((degree) => degree === 1 || degree === 2)
    : degrees.every((degree) => degree === 2);
  if (reached.size !== link.size || !shape) nonManifoldVertices++;
}
const result = {
  scope:
    "Independent analysis of a deterministic333-point real ASC1 surface patch, XZ projection, max3Dedge0.35mm. Source file hash and original line indices are reverified; selected Float32 positions and original normals match the browser source exactly.",
  sourceSha256: manifest.sourceSha256,
  meshGeometrySha256: createHash("sha256").update(meshBytes).digest("hex"),
  sourcePoints: manifest.sourceValidPoints,
  selectedPoints: manifest.selectedPoints,
  selectedFraction: manifest.selectedPoints / manifest.sourceValidPoints,
  originalSelectedSamplesPreserved: true,
  maxCoordinateFloat32QuantizationErrorMm:
    manifest.maxCoordinateFloat32QuantizationErrorMm,
  projectionPlane: manifest.projectionPlane,
  maxEdgeLimitMm: manifest.maxEdgeLengthMm,
  topology: {
    storedVertices: vertices.length / 3,
    usedVertices: used.size,
    unusedVertices: vertices.length / 3 - used.size,
    triangles: triangles.length / 3,
    edges: edges.size,
    components: usedComponents.size,
    boundaryEdges: boundary.length,
    boundaryEdgeComponents: boundaryComponents,
    closedBoundaryLoops,
    branchingBoundaryComponents,
    nonManifoldEdges: [...edges.values()].filter((edge) => edge.incidence > 2)
      .length,
    nonManifoldVertices,
    inconsistentEdges: [...edges.values()].filter(
      (edge) => edge.incidence === 2 && edge.direction !== 0,
    ).length,
    degenerateTriangles: degenerate,
    duplicateTriangles: duplicates,
    eulerCharacteristicUsedComplex:
      used.size - edges.size + triangles.length / 3,
  },
  geometry: {
    areaMm2: area,
    projectedAreaMm2: projectedArea,
    maximum3dEdgeMm: maxEdge,
    minimumTriangleAngleDegrees: minAngle,
    positiveProjectionWinding: positive,
    negativeProjectionWinding: negative,
  },
  limitations: [
    "Small selected patch, not full real-scan or general3D reconstruction acceptance.",
    "Pruning leaves disconnected strips, holes and unused samples; filled area is not a recovered surface-coverage certificate.",
    "Boundary loops are closed connected edge components whose boundary vertices all have degree2; branched/touching boundary components are reported separately.",
    "Vertex-link checks are combinatorial only; no physical scanner accuracy or self-intersection claim.",
  ],
};
assert.equal(result.topology.triangles, 275);
assert.equal(result.topology.degenerateTriangles, 0);
assert.equal(result.topology.nonManifoldEdges, 0);
assert(maxEdge <= manifest.maxEdgeLengthMm);
await writeFile(
  new URL("real-surface-quality.json", out),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));

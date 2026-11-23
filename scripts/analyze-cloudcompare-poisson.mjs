import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { Triangle, Vector3 } from "three";

// Independent quality check of a native export against the authored radius-10 sphere.
const root = new URL(
  "../docs/evidence/cloudcompare-20261028/",
  import.meta.url,
);
const bytes = await readFile(new URL("poisson-sphere-native.ply", root));
const input = await readFile(new URL("fixtures/sphere-normals.ply", root));
const geometry = new PLYLoader().parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
try {
  const vertices = geometry.getAttribute("position").array,
    normals = geometry.getAttribute("normal")?.array,
    triangles = geometry.index.array;
  assert(vertices.every(Number.isFinite));
  const radius = 10,
    edges = new Map(),
    faces = new Set(),
    used = new Set(),
    parents = Int32Array.from({ length: vertices.length / 3 }, (_, i) => i);
  const find = (id) => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]];
      id = parents[id];
    }
    return id;
  };
  const union = (a, b) => {
    parents[find(a)] = find(b);
  };
  const signedVertexErrors = [];
  let outwardNormals = 0,
    inwardNormals = 0,
    zeroNormals = 0;
  for (let i = 0; i < vertices.length; i += 3) {
    signedVertexErrors.push(
      Math.hypot(vertices[i], vertices[i + 1], vertices[i + 2]) - radius,
    );
    if (normals) {
      const dot =
        vertices[i] * normals[i] +
        vertices[i + 1] * normals[i + 1] +
        vertices[i + 2] * normals[i + 2];
      if (dot > 0) outwardNormals++;
      else if (dot < 0) inwardNormals++;
      else zeroNormals++;
    }
  }
  const point = (id) =>
    new Vector3(vertices[id * 3], vertices[id * 3 + 1], vertices[id * 3 + 2]);
  const origin = new Vector3(),
    nearest = new Vector3();
  let area = 0,
    volume = 0,
    degenerate = 0,
    duplicates = 0,
    outwardFaces = 0,
    inwardFaces = 0,
    minRadius = Infinity,
    maxRadius = 0;
  const centroidErrors = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const ids = Array.from(triangles.slice(i, i + 3));
    assert(
      ids.every(
        (id) => Number.isSafeInteger(id) && id >= 0 && id < vertices.length / 3,
      ),
    );
    const key = ids
      .slice()
      .sort((a, b) => a - b)
      .join(",");
    if (faces.has(key)) duplicates++;
    faces.add(key);
    for (let j = 0; j < 3; j++) {
      const a = ids[j],
        b = ids[(j + 1) % 3],
        key = [a, b].sort((a, b) => a - b).join(",");
      used.add(a);
      union(a, b);
      const edge = edges.get(key) ?? { incidence: 0, direction: 0 };
      edge.incidence++;
      edge.direction += a < b ? 1 : -1;
      edges.set(key, edge);
    }
    const [a, b, c] = ids.map(point),
      triangle = new Triangle(a, b, c);
    const cross = b.clone().sub(a).cross(c.clone().sub(a));
    area += cross.length() / 2;
    if (cross.lengthSq() === 0) degenerate++;
    const centroid = a
      .clone()
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3);
    centroidErrors.push(centroid.length() - radius);
    const dot = cross.dot(centroid);
    if (dot > 0) outwardFaces++;
    else if (dot < 0) inwardFaces++;
    volume += a.dot(b.clone().cross(c)) / 6;
    triangle.closestPointToPoint(origin, nearest);
    minRadius = Math.min(minRadius, nearest.length());
    maxRadius = Math.max(maxRadius, a.length(), b.length(), c.length());
  }
  const stats = (values) => {
    const absolute = values.map(Math.abs).sort((a, b) => a - b);
    return {
      samples: values.length,
      meanSignedMm: values.reduce((s, v) => s + v, 0) / values.length,
      rmsMm: Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length),
      meanAbsoluteMm: absolute.reduce((s, v) => s + v, 0) / values.length,
      p95AbsoluteMm: absolute[Math.ceil(absolute.length * 0.95) - 1],
      maximumAbsoluteMm: absolute.at(-1),
      minimumSignedMm: Math.min(...values),
      maximumSignedMm: Math.max(...values),
    };
  };
  const edgeValues = [...edges.values()];
  const result = {
    scope:
      "Native CloudCompare 2.13.2 Poisson reconstruction of 1200 outward-normal samples on an origin-centered radius-10-mm sphere. Independent PLY export analysis; no ScanForge reconstruction code used.",
    inputSha256: createHash("sha256").update(input).digest("hex"),
    outputSha256: createHash("sha256").update(bytes).digest("hex"),
    settings: {
      octreeDepth: 8,
      boundary: "Neumann",
      pointWeight: 2,
      samplesPerNode: 1.5,
      linearFit: false,
      outputDensity: false,
      threads: 2,
    },
    topology: {
      vertices: vertices.length / 3,
      usedVertices: used.size,
      triangles: triangles.length / 3,
      edges: edges.size,
      components: new Set([...used].map(find)).size,
      boundaryEdges: edgeValues.filter((e) => e.incidence === 1).length,
      nonManifoldEdges: edgeValues.filter((e) => e.incidence > 2).length,
      inconsistentEdges: edgeValues.filter(
        (e) => e.incidence === 2 && e.direction !== 0,
      ).length,
      degenerateTriangles: degenerate,
      duplicateTriangles: duplicates,
      eulerCharacteristic: used.size - edges.size + triangles.length / 3,
    },
    radialError: {
      vertices: stats(signedVertexErrors),
      faceCentroids: stats(centroidErrors),
      continuousMeshToSphere: {
        minimumRadiusMm: minRadius,
        maximumRadiusMm: maxRadius,
        maximumDistanceMm: Math.max(
          Math.abs(minRadius - radius),
          Math.abs(maxRadius - radius),
        ),
        method:
          "For each filled triangle, minimum norm is the closest point to the origin and maximum norm is at a vertex. Distance to the true sphere is absolute radial error. This is mesh-to-sphere only, not symmetric Hausdorff distance.",
      },
    },
    orientation: {
      outwardFaces,
      inwardFaces,
      outwardNormals,
      inwardNormals,
      zeroNormals,
    },
    surfaceAreaMm2: area,
    analyticSphereAreaMm2: 4 * Math.PI * radius * radius,
    signedVolumeMm3: volume,
    analyticSphereVolumeMm3: (4 / 3) * Math.PI * radius ** 3,
    limitations: [
      "One synthetic closed sphere and one parameter configuration; not a general Poisson quality certificate.",
      "No self-intersection test or full vertex-link manifold certification was performed.",
      "Vertex and face-centroid RMS weight their respective samples equally, not surface area.",
      "Density was disabled; open-surface trimming and holes were not exercised.",
    ],
  };
  assert.equal(result.topology.vertices, 3992);
  assert.equal(result.topology.triangles, 7980);
  assert.equal(result.topology.components, 1);
  assert.equal(result.topology.boundaryEdges, 0);
  assert.equal(result.topology.nonManifoldEdges, 0);
  assert.equal(result.topology.inconsistentEdges, 0);
  assert.equal(result.topology.eulerCharacteristic, 2);
  assert.equal(result.topology.degenerateTriangles, 0);
  await writeFile(
    new URL("poisson-sphere-quality.json", root),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  geometry.dispose();
}

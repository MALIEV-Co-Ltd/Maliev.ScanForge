import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";

// Compare two published outputs independently of the application meshing code.
const root = new URL(
  "../docs/evidence/cloudcompare-20261028/",
  import.meta.url,
);
const nativeFile = await readFile(new URL("native-delaunay-output.ply", root));
const sfFile = await readFile(
  new URL("meshing-scanforge-native-fixture-geometry.json", root),
);
const native = new PLYLoader().parse(
  nativeFile.buffer.slice(
    nativeFile.byteOffset,
    nativeFile.byteOffset + nativeFile.byteLength,
  ),
);
try {
  const sf = JSON.parse(sfFile.toString());
  const nativeVertices = Array.from(native.getAttribute("position").array);
  const nativeTriangles = Array.from(native.index.array);
  const vertexEquality =
    JSON.stringify(nativeVertices) === JSON.stringify(sf.indexedMesh.vertices);
  const faces = (triangles) =>
    new Set(
      Array.from({ length: triangles.length / 3 }, (_, i) =>
        triangles
          .slice(i * 3, i * 3 + 3)
          .sort((a, b) => a - b)
          .join(","),
      ),
    );
  const nativeFaces = faces(nativeTriangles),
    sfFaces = faces(sf.indexedMesh.triangles);
  const sharedFaces = [...nativeFaces].filter((face) =>
    sfFaces.has(face),
  ).length;
  const metrics = (vertices, triangles) => {
    const edges = new Map();
    let maxEdge = 0,
      degenerate = 0,
      positive = 0,
      negative = 0,
      area = 0;
    for (let i = 0; i < triangles.length; i += 3) {
      const ids = triangles.slice(i, i + 3);
      for (let j = 0; j < 3; j++) {
        const a = ids[j],
          b = ids[(j + 1) % 3],
          key = [a, b].sort((x, y) => x - y).join(",");
        edges.set(key, (edges.get(key) ?? 0) + 1);
        maxEdge = Math.max(
          maxEdge,
          Math.hypot(
            vertices[a * 3] - vertices[b * 3],
            vertices[a * 3 + 1] - vertices[b * 3 + 1],
            vertices[a * 3 + 2] - vertices[b * 3 + 2],
          ),
        );
      }
      const [a, b, c] = ids.map((id) => vertices.slice(id * 3, id * 3 + 3));
      const u = b.map((v, j) => v - a[j]),
        v = c.map((x, j) => x - a[j]);
      const cross = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const twiceArea = Math.hypot(...cross);
      area += twiceArea / 2;
      if (!twiceArea) degenerate++;
      if (cross[2] > 0) positive++;
      if (cross[2] < 0) negative++;
    }
    return {
      vertices: vertices.length / 3,
      triangles: triangles.length / 3,
      edges: edges.size,
      boundaryEdges: [...edges.values()].filter((n) => n === 1).length,
      nonManifoldEdges: [...edges.values()].filter((n) => n > 2).length,
      degenerateTriangles: degenerate,
      positiveZWinding: positive,
      negativeZWinding: negative,
      maxEdgeLengthMm: maxEdge,
      surfaceAreaMm2: area,
    };
  };
  const report = {
    scope:
      "437-point synthetic curved surface; XY projection; maximum 3D edge 2 mm. Native CloudCompare 2.13.2 output vs public MCP ScanForge output. Face comparison ignores vertex order within each triangle; normals/shading are not compared.",
    nativeSha256: createHash("sha256").update(nativeFile).digest("hex"),
    scanforgeGeometrySha256: createHash("sha256").update(sfFile).digest("hex"),
    vertexEquality,
    sharedUnorientedFaces: sharedFaces,
    unorientedTopologyEquality:
      vertexEquality &&
      sharedFaces === nativeFaces.size &&
      sharedFaces === sfFaces.size,
    native: metrics(nativeVertices, nativeTriangles),
    scanforge: metrics(sf.indexedMesh.vertices, sf.indexedMesh.triangles),
  };
  assert(vertexEquality);
  assert.equal(report.native.triangles, 772);
  assert.equal(report.scanforge.triangles, 772);
  assert(report.scanforge.maxEdgeLengthMm <= 2);
  assert.equal(report.scanforge.degenerateTriangles, 0);
  assert.equal(report.scanforge.nonManifoldEdges, 0);
  await writeFile(
    new URL("meshing-native-comparison.json", root),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  native.dispose();
}

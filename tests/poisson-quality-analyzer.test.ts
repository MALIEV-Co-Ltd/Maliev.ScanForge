import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

it("independently measures identical tetrahedra with zero distances and a closed manifold", () => {
  const root = mkdtempSync(join(tmpdir(), "scanforge-poisson-quality-"));
  try {
    const source = join(root, "tetra.ply"),
      report = join(root, "receipt.json");
    writeFileSync(
      source,
      "ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nelement face 4\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n0 0 1\n3 0 2 1\n3 0 1 3\n3 0 3 2\n3 1 2 3\n",
    );
    execFileSync(
      process.execPath,
      [
        resolve("scripts/verify-poisson-quality.mjs"),
        "--source",
        source,
        "--mesh",
        source,
        "--report",
        report,
      ],
      { stdio: "pipe" },
    );
    const receipt = JSON.parse(readFileSync(report, "utf8"));
    expect(receipt.reconstruction.topology).toMatchObject({
      vertices: 4,
      triangles: 4,
      components: 1,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      nonManifoldVertices: 0,
      inconsistentWindingEdges: 0,
      degenerateTriangles: 0,
      eulerCharacteristic: 2,
    });
    expect(receipt.reconstruction.topology.signedVolume).toBeCloseTo(1 / 6, 12);
    for (const distribution of Object.values(receipt.distances) as any[])
      expect(distribution.maximum).toBeLessThan(1e-14);
    expect(receipt.distances.sourceVerticesToMesh.samples).toBe(4);
    expect(receipt.distances.meshFaceCentroidsToSourceTopology.samples).toBe(4);
    expect(receipt.selfIntersection).toMatchObject({
      complete: true,
      nonAdjacentIntersectingTrianglePairs: 0,
    });
    expect(
      receipt.normalAgreement
        .outputGeometricFaceNormalsAgainstInterpolatedSourceNormals
        .normalizedSignedDot.minimum,
    ).toBeCloseTo(1, 12);
    expect(receipt.source.sha256).toBe(receipt.reconstruction.sha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("detects nonadjacent triangle intersections through BVH broadphase", () => {
  const root = mkdtempSync(join(tmpdir(), "scanforge-poisson-intersection-"));
  try {
    const source = join(root, "crossing.ply"),
      report = join(root, "receipt.json");
    writeFileSync(
      source,
      "ply\nformat ascii 1.0\nelement vertex 6\nproperty float x\nproperty float y\nproperty float z\nelement face 2\nproperty list uchar int vertex_indices\nend_header\n-1 -1 0\n1 -1 0\n0 1 0\n0 -0.5 -1\n0 -0.5 1\n0 0.5 0\n3 0 1 2\n3 3 4 5\n",
    );
    execFileSync(
      process.execPath,
      [
        resolve("scripts/verify-poisson-quality.mjs"),
        "--source",
        source,
        "--mesh",
        source,
        "--report",
        report,
      ],
      { stdio: "pipe" },
    );
    const receipt = JSON.parse(readFileSync(report, "utf8"));
    expect(receipt.selfIntersection).toMatchObject({
      complete: true,
      nonAdjacentIntersectingTrianglePairs: 1,
      classifications: { properCrossings: 1, pointOrEdgeContacts: 0 },
      examples: [[0, 1]],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

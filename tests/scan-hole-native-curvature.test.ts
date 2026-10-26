import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import fixture from "./fixtures/hole-fill-observed-curvature-annulus.json";
import cups from "./fixtures/hole-fill-observed-cups.json";
import failedCup41 from "./fixtures/hole-fill-observed-failed-cup-41.json";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { runScanEditAsync } from "../src/scan-edit";
import { withCurvatureKernel } from "./helpers/curvature-kernel-vm";

function positions(mesh: typeof fixture.source): Float32Array {
  return new Float32Array(
    mesh.faces.flatMap((face) => face.flatMap((id) => mesh.vertices[id])),
  );
}

function topology(points: Float32Array) {
  const indexed = nativeStlTopology(points);
  return analyzeIndexedMesh(
    Float64Array.from(indexed.vertices),
    indexed.triangles,
  );
}

function orientedDigest(points: Float32Array): string {
  const faces: string[] = [];
  for (let i = 0; i < points.length; i += 9) {
    const corners = [0, 1, 2].map((corner) =>
      Array.from(points.subarray(i + corner * 3, i + corner * 3 + 3)).join(","),
    );
    faces.push(
      [0, 1, 2]
        .map((offset) =>
          [...corners.slice(offset), ...corners.slice(0, offset)].join(";"),
        )
        .sort()[0],
    );
  }
  return createHash("sha256").update(faces.sort().join("\n")).digest("hex");
}

it("binds the failed 41-edge cup to the original binary STL corner stream", () => {
  const source = positions(failedCup41);
  expect(source.length / 9).toBe(123);
  expect(
    createHash("sha256").update(new Uint8Array(source.buffer)).digest("hex"),
  ).toBe("abf34711c3b63cb69ccab0537d96319d054fc3dd11255c2675b461fdc6f215b0");
  expect(topology(source).boundaryLoops[0]).toHaveLength(41);
});

it("retains the successful native Curvature control and its remeshed collar", () => {
  const original = new Set(
    fixture.source.vertices.map((point) => point.join(",")),
  );
  const retained = fixture.native.vertices.filter((point) =>
    original.has(point.join(",")),
  );
  expect(retained).toHaveLength(fixture.unchangedSourceVertices);
  expect(
    retained.every(
      (point) => Math.abs(Math.hypot(point[0], point[1]) - 4) < 1e-6,
    ),
  ).toBe(true);
  const result = topology(positions(fixture.native));
  expect(result.boundaryLoops).toHaveLength(fixture.nativeRemainingHoles);
  expect(result.nonManifoldEdges).toBe(0);
  expect(result.inconsistentEdges).toBe(0);
});

it.each(["curvature", "automatic"] as const)(
  "matches native entire-hole Curvature on the original smooth annulus through %s",
  async (algorithm) => {
    const source = positions(fixture.source);
    const before = source.slice();
    const indexed = topology(source);
    const inner = indexed.boundaryLoops.findIndex((loop) =>
      loop.every(
        (id) =>
          Math.hypot(indexed.vertices[id * 3], indexed.vertices[id * 3 + 1]) <
          2.01,
      ),
    );
    expect(inner).toBeGreaterThanOrEqual(0);
    const result = await withCurvatureKernel(() =>
      runScanEditAsync(
        {
          kind: "scanEdit",
          action: "fillHoles",
          positions: source,
          indices: [inner],
          algorithm,
        },
        {
          topologyCache: {
            positions: source,
            tolerance: 1e-6,
            topology: indexed,
          },
        },
      ),
    );
    expect(source).toEqual(before);
    expect(result.positions!.length / 9).toBe(fixture.nativeFacets);
    expect(orientedDigest(result.positions as Float32Array)).toBe(
      orientedDigest(positions(fixture.native)),
    );
  },
);

it.each([
  ...cups.cases.map((sample) => ({
    ...sample,
    algorithm: "curvature" as const,
  })),
  ...(["curvature", "automatic"] as const).map((algorithm) => ({
    ...failedCup41,
    rimEdges: failedCup41.holeEdges,
    algorithm,
  })),
])(
  "preserves the $rimEdges-edge cup when its $algorithm collar cannot form a graph",
  async (sample) => {
    const source = new Float32Array(
      sample.faces.flatMap((face) => face.flatMap((id) => sample.vertices[id])),
    );
    const before = source.slice();
    const indexed = topology(source);
    const vertices = indexed.vertices.slice();
    const triangles = indexed.triangles.slice();
    await expect(
      runScanEditAsync(
        {
          kind: "scanEdit",
          action: "fillHoles",
          positions: source,
          indices: [0],
          algorithm: sample.algorithm,
        },
        {
          topologyCache: {
            positions: source,
            tolerance: 1e-6,
            topology: indexed,
          },
        },
      ),
    ).rejects.toThrow(/Curvature/i);
    expect(source).toEqual(before);
    expect(indexed.vertices).toEqual(vertices);
    expect(indexed.triangles).toEqual(triangles);
  },
);

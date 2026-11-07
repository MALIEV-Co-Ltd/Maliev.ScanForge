import { expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { cleanupBoundaryFacets } from "../src/scan-boundary-cleanup";
import { publishSmoothedVertices, runScanEditAsync } from "../src/scan-edit";
import { withCurvatureKernel } from "./helpers/curvature-kernel-vm";

function fan(folded: boolean) {
  return analyzeIndexedMesh(
    Float64Array.from(
      folded
        ? [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, -1, 1]
        : [0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, -1, -1, 0],
    ),
    new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 4]),
  );
}
it("removes an inverted boundary ear in native swap-last facet order", () => {
  const topology = fan(true),
    before = topology.triangles.slice();
  const result = cleanupBoundaryFacets(topology, [0, 0, 1, 2, 2]);
  expect(result.removed).toBe(1);
  expect(result.retainedFaces).toEqual(new Uint32Array([2, 1]));
  expect(result.triangles).toEqual(new Uint32Array([0, 3, 4, 0, 2, 3]));
  expect(topology.triangles).toEqual(before);
});
it("keeps a flat boundary and rejects cancellation without mutating it", () => {
  const topology = fan(false),
    before = topology.triangles.slice();
  const result = cleanupBoundaryFacets(topology, [0, 0, 1, 2, 2]);
  expect(result.removed).toBe(0);
  expect(result.triangles).toBe(topology.triangles);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    cleanupBoundaryFacets(topology, [0, 0, 1, 2, 2], controller.signal),
  ).toThrow(/abort|cancel/i);
  expect(topology.triangles).toEqual(before);
});

it("preserves raw stationary corners when native deletion reorders surviving facets", () => {
  const topology = fan(true),
    source = new Float32Array(topology.triangles.length * 3);
  for (let c = 0; c < topology.triangles.length; c++)
    source.set(
      topology.vertices.subarray(
        topology.triangles[c] * 3,
        topology.triangles[c] * 3 + 3,
      ),
      c * 3,
    );
  source[18] = 0.0002;
  const before = source.slice(),
    vertices = topology.vertices.slice();
  vertices[4 * 3 + 2] += 0.125;
  const triangles = new Uint32Array([0, 3, 4, 0, 2, 3]);
  const sourceCorners = new Uint32Array([6, 7, 8, 3, 4, 5]);
  const result = publishSmoothedVertices(
    { kind: "scanEdit", action: "boundarySmooth", positions: source },
    topology,
    vertices,
    {},
    triangles,
    sourceCorners,
  );
  expect(result).toHaveLength(18);
  expect(result[0]).toBe(source[18]);
  expect(result.slice(3, 6)).toEqual(source.slice(21, 24));
  expect(result[8]).toBe(Math.fround(vertices[14]));
  expect(result.slice(9)).toEqual(source.slice(9, 18));
  expect(source).toEqual(before);
});

it("runs post-fit cleanup before publishing the complete folded-boundary result", async () => {
  const vertices = Float64Array.from([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, -1, 1, 1, -2, 1, 1, -3, 1,
  ]);
  const triangles = new Uint32Array([
    0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6,
  ]);
  const positions = new Float32Array(triangles.length * 3);
  for (let c = 0; c < triangles.length; c++)
    positions.set(
      vertices.subarray(triangles[c] * 3, triangles[c] * 3 + 3),
      c * 3,
    );
  const original = positions.slice(),
    topology = analyzeIndexedMesh(vertices, triangles);
  await withCurvatureKernel(async () => {
    const result = await runScanEditAsync(
      { kind: "scanEdit", action: "boundarySmooth", positions, strength: 0 },
      { topologyCache: { positions, tolerance: 1e-6, topology } },
    );
    expect(result.diagnostics.fittedBoundaries).toBe(1);
    expect(typeof result.diagnostics.removedFacets).toBe("number");
    expect(result.positions!.length / 9).toBe(
      5 - Number(result.diagnostics.removedFacets),
    );
    expect(result.positions!.every(Number.isFinite)).toBe(true);
    expect(positions).toEqual(original);
  });
}, 30000);

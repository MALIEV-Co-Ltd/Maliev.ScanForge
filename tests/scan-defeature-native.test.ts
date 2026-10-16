import { expect, it } from "vitest";
import fixture from "./fixtures/defeature-annular.json";
import { runScanEdit } from "../src/scan-edit";
import { retainFacets } from "../src/scan-defeature-topology";
import {
  computeAngleWeightedNormals,
  repatchSpatialBoundary,
} from "../src/scan-defeature-repatch";
import {
  analyzeMesh,
  type MeshProcessingOptions,
} from "../src/mesh-processing";

// Compare geometry independently of native facet allocation/order, while also
// checking winding and topology. Data is an observed export, not a port oracle.
function triangleKeys(positions: ArrayLike<number>, decimals: number) {
  const keys: string[] = [];
  for (let f = 0; f < positions.length; f += 9)
    keys.push(
      [0, 1, 2]
        .map((c) =>
          [0, 1, 2]
            .map((a) => positions[f + c * 3 + a].toFixed(decimals))
            .join(","),
        )
        .sort()
        .join("|"),
    );
  return keys.sort();
}
it("retains spatial-fill fidelity to the observed native reference", () => {
  const source = analyzeMesh(new Float32Array(fixture.positions), {
    tolerance: 0.001,
  });
  const normals = computeAngleWeightedNormals(source);
  let retained = retainFacets(
    source,
    Uint8Array.from(fixture.selection, (v) => +!v),
    {},
  ).topology;
  const largest = retained.components.reduce((a, b) =>
    a.length > b.length ? a : b,
  );
  const keep = new Uint8Array(retained.triangles.length / 3);
  for (const f of largest) keep[f] = 1;
  retained = retainFacets(retained, keep, {}).topology;
  const loop = retained.boundaryLoops.find((loop) =>
    loop.every((id) => {
      const x = retained.vertices[id * 3],
        y = retained.vertices[id * 3 + 1];
      return x > 0 && x < 7 && y > 0 && y < 7;
    }),
  )!;
  const patch = repatchSpatialBoundary(retained, loop, {
    vertexNormals: normals,
  });
  expect(patch.completed).toBe(true);
  const vertices = [...retained.vertices, ...patch.insertedVertices];
  const positions = [...retained.triangles, ...patch.triangles].flatMap((id) =>
    vertices.slice(id * 3, id * 3 + 3),
  );
  expect(triangleKeys(positions, 5)).toEqual(
    triangleKeys(fixture.nativeOutput, 5),
  );
});

it("reconstructs the native fixture with curvature fitting and valid successor topology", () => {
  const positions = new Float32Array(fixture.positions);
  const selection = new Uint8Array(fixture.selection);
  const selected = fixture.positions.filter(
    (_, i) => selection[Math.floor(i / 9)],
  );
  expect(triangleKeys(selected, 8)).toEqual(
    triangleKeys(fixture.nativeSelection, 8),
  );
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  analyzeMesh(positions, { topologyCache: cache, tolerance: 0.001 });
  const stages: string[] = [];
  const result = runScanEdit(
    {
      kind: "scanEdit",
      action: "defeature",
      positions,
      selection,
      tolerance: 0.001,
    },
    { topologyCache: cache, onProgress: (_, s) => stages.push(s) },
  );
  expect(result.diagnostics.curvaturePatches).toBe(1);
  expect(result.diagnostics.curvatureFallback).toBe("");
  expect(result.diagnostics.insertedVertices).toBeGreaterThan(5);
  const topology = analyzeMesh(result.positions!, {
    topologyCache: cache,
    tolerance: 0.001,
  });
  expect(topology.boundaryLoops).toHaveLength(1);
  expect(topology.vertices.length / 3).toBeGreaterThan(65);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.inconsistentEdges).toBe(0);
  expect(stages.some((s) => /Welding vertices|Building topology/.test(s))).toBe(
    false,
  );
  expect(Array.from(positions)).toEqual(fixture.positions);
});

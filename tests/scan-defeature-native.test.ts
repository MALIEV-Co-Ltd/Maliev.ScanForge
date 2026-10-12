import { expect, it } from "vitest";
import fixture from "./fixtures/defeature-annular.json";
import { runScanEdit } from "../src/scan-edit";
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
it("matches the observed native result on the same mesh and exact selected facets", () => {
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
  expect(result.positions!.length / 9).toBe(100);
  expect(result.diagnostics.insertedVertices).toBe(5);
  expect(triangleKeys(result.positions!, 5)).toEqual(
    triangleKeys(fixture.nativeOutput, 5),
  );
  const topology = analyzeMesh(result.positions!, {
    topologyCache: cache,
    tolerance: 0.001,
  });
  expect(topology.boundaryLoops).toHaveLength(1);
  expect(topology.vertices.length / 3).toBe(65);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.inconsistentEdges).toBe(0);
  expect(stages.some((s) => /Welding vertices|Building topology/.test(s))).toBe(
    false,
  );
  expect(Array.from(positions)).toEqual(fixture.positions);
});

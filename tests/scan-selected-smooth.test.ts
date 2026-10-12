import { expect, it } from "vitest";
import input from "./fixtures/defeature-annular.json";
import fixture from "./fixtures/smooth-annular.json";
import { runScanEdit } from "../src/scan-edit";
import {
  analyzeMesh,
  type MeshProcessingOptions,
} from "../src/mesh-processing";

it("matches native selected smoothing on the same annular mesh and selected facets", () => {
  const positions = new Float32Array(input.positions);
  const selection = new Uint8Array(input.selection);
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const before = analyzeMesh(positions, {
    tolerance: 0.001,
    topologyCache: cache,
  });
  const stages: string[] = [];
  const result = runScanEdit(
    {
      kind: "scanEdit",
      action: "smoothSelected",
      positions,
      selection,
      tolerance: 0.001,
    },
    { topologyCache: cache, onProgress: (_, s) => stages.push(s) },
  ).positions!;
  expect(result.length).toBe(positions.length);
  // Verify an injective, consistent native coordinate correspondence before
  // using export order to compare coordinates. All marked vertices move.
  const nativeMap = new Map<string, string>();
  const selected = new Set<string>();
  for (let i = 0; i < positions.length; i += 3)
    if (selection[Math.floor(i / 9)])
      selected.add(Array.from(positions.slice(i, i + 3)).join(","));
  for (let i = 0; i < positions.length; i += 3) {
    const key = Array.from(positions.slice(i, i + 3)).join(",");
    const value = fixture.nativeOutput.slice(i, i + 3).join(",");
    if (nativeMap.has(key)) expect(nativeMap.get(key)).toBe(value);
    nativeMap.set(key, value);
    if (!selected.has(key)) {
      expect(Array.from(result.slice(i, i + 3))).toEqual(
        Array.from(positions.slice(i, i + 3)),
      );
    }
  }
  expect(new Set(nativeMap.values()).size).toBe(nativeMap.size);
  const moved = [...nativeMap]
    .filter(([a, b]) => a !== b)
    .map(([a]) => a)
    .sort();
  expect(moved).toEqual([...selected].sort());
  expect(moved).toHaveLength(16);
  const maxError = Math.max(
    ...Array.from(result, (v, i) => Math.abs(v - fixture.nativeOutput[i])),
  );
  expect(maxError).toBeLessThan(0.000001);
  const after = analyzeMesh(result, {
    tolerance: 0.001,
    topologyCache: cache,
    onProgress: (_, s) => stages.push(s),
  });
  expect(after.triangles).toEqual(before.triangles);
  expect(after.edges).toBe(before.edges);
  expect(after.boundaryLoops).toHaveLength(2);
  expect(after.nonManifoldEdges).toBe(0);
  expect(stages.some((s) => /Welding vertices|Building topology/.test(s))).toBe(
    false,
  );
  expect(Array.from(positions)).toEqual(input.positions);
});

it("keeps convex outside corners fixed and respects cancellation", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  expect(
    runScanEdit({
      kind: "scanEdit",
      action: "smoothSelected",
      positions,
      selection: new Uint8Array([1]),
    }).positions,
  ).toEqual(positions);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    runScanEdit(
      {
        kind: "scanEdit",
        action: "smoothSelected",
        positions,
        selection: new Uint8Array([1]),
      },
      { signal: controller.signal },
    ),
  ).toThrow(/cancelled/i);
});

import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import {
  reduceScanMesh,
  reduceScanNoise,
  repolygonizeScanMesh,
} from "../src/scan-tools-reduction";

function grid(size = 6, bump = 0) {
  const output: number[] = [];
  const p = (x: number, y: number) => [
    x,
    y,
    x === size / 2 && y === size / 2 ? bump : 0,
  ];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      output.push(
        ...p(x, y),
        ...p(x + 1, y),
        ...p(x + 1, y + 1),
        ...p(x, y),
        ...p(x + 1, y + 1),
        ...p(x, y + 1),
      );
  return new Float32Array(output);
}
it("reduces a planar mesh by connected edge collapses without changing its boundary or components", () => {
  const source = grid(),
    copy = source.slice(),
    before = analyzeMesh(source);
  const result = reduceScanMesh(source, {
    mode: "triangles",
    targetTriangles: 50,
  });
  const after = analyzeMesh(result.positions);
  expect(result.positions.length / 9).toBe(50);
  expect(after.boundaryEdges).toBe(before.boundaryEdges);
  expect(after.boundaryLoops.length).toBe(1);
  expect(after.components.length).toBe(1);
  expect(
    after.nonManifoldEdges +
      after.nonManifoldVertices +
      after.degenerateTriangles +
      after.inconsistentEdges,
  ).toBe(0);
  expect(
    [...result.positions].filter((_, i) => i % 3 === 2).every((z) => z === 0),
  ).toBe(true);
  expect(source).toEqual(copy);
});
it("uses percentage as the retained triangle percentage", () => {
  const source = grid();
  const result = reduceScanMesh(source, { mode: "percentage", percentage: 75 });
  expect(result.positions.length / 9).toBe(54);
  expect(
    reduceScanMesh(source, { mode: "percentage", percentage: 100 }).positions,
  ).toEqual(source);
});
it("respects the conservative deviation bound and reports protected topology rather than dropping faces", () => {
  const source = grid();
  const result = reduceScanMesh(source, { mode: "deviation", deviation: 0.05 });
  expect(result.positions.length).toBeLessThan(source.length);
  expect(result.positions.every((x, i) => i % 3 !== 2 || x === 0)).toBe(true);
  const triangle = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  expect(
    reduceScanMesh(triangle, { mode: "triangles", targetTriangles: 1 })
      .positions,
  ).toEqual(triangle);
});
it("reports deviation without limiting the native smoothing result", () => {
  const source = grid(6, 0.2),
    copy = source.slice();
  const measured = reduceScanNoise(source, {
    iterations: 3,
    deviation: 0.00001,
    measureDeviation: true,
  });
  expect(measured.positions).toEqual(
    reduceScanNoise(source, { iterations: 3 }).positions,
  );
  expect(measured.summary).toContain("Original-to-surface comparison");
  expect(measured.summary).toContain("unmatched beyond");
  expect(measured.positions).not.toEqual(source);
  expect(source).toEqual(copy);
});
it("reuses topology across repeated noise edits without changing the uncached result", () => {
  const source = grid(6, 0.2);
  const topologyCache: NonNullable<
    import("../src/mesh-processing").MeshProcessingOptions["topologyCache"]
  > = {};
  const stages: string[] = [];
  const before = analyzeMesh(source, { tolerance: 1e-6, topologyCache });
  const options = {
    iterations: 3,
    deviation: 0.05,
    topologyCache,
    onProgress: (_: number, stage: string) => stages.push(stage),
  };
  const first = reduceScanNoise(source, options).positions;
  expect(first).toEqual(
    reduceScanNoise(source, { iterations: 3, deviation: 0.05 }).positions,
  );
  expect(topologyCache.topology!.edges).toBe(before.edges);
  expect(topologyCache.positions).toBe(first);
  const second = reduceScanNoise(first, options).positions;
  expect(second).toEqual(
    reduceScanNoise(first, { iterations: 3, deviation: 0.05 }).positions,
  );
  expect(topologyCache.positions).toBe(second);
  expect(stages.filter((s) => s === "Reusing mesh topology")).toHaveLength(2);
  expect(stages.some((s) => /Welding vertices|Building topology/.test(s))).toBe(
    false,
  );
});
it("smooths shared selection vertices while retaining unmarked vertices", () => {
  const source = grid(6, 0.2),
    before = analyzeMesh(source);
  const selection = new Uint8Array(source.length / 9);
  selection[28] = 1;
  const marked = new Set(Array.from(before.triangles.slice(28 * 3, 29 * 3)));
  const topologyCache: NonNullable<
    import("../src/mesh-processing").MeshProcessingOptions["topologyCache"]
  > = {};
  const result = reduceScanNoise(source, {
    iterations: 3,
    selectionOnly: true,
    selection,
    topologyCache,
  });
  let changed = false;
  for (let corner = 0; corner < before.triangles.length; corner++)
    for (let axis = 0; axis < 3; axis++) {
      const index = corner * 3 + axis;
      if (!marked.has(before.triangles[corner]))
        expect(result.positions[index]).toBe(source[index]);
      else changed ||= result.positions[index] !== source[index];
    }
  expect(changed).toBe(true);
  expect(topologyCache.positions).toBe(result.positions);
  expect(topologyCache.topology!.edges).toBeDefined();
});
it("validates finite positive parameters, selections, topology and cancellation", () => {
  const source = grid();
  for (const bad of [0, -1, NaN, Infinity]) {
    expect(() => reduceScanNoise(source, { deviation: bad })).toThrow();
    expect(() => repolygonizeScanMesh(source, { resolution: bad })).toThrow();
  }
  expect(() =>
    reduceScanMesh(source, { mode: "triangles", targetTriangles: 1.5 }),
  ).toThrow();
  expect(() =>
    reduceScanMesh(source, { mode: "percentage", percentage: 101 }),
  ).toThrow();
  expect(() => reduceScanNoise(source, { selectionOnly: true })).toThrow();
  expect(() => reduceScanNoise(source, { iterations: 101 })).toThrow();
  expect(() =>
    repolygonizeScanMesh(new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1, 0])),
  ).toThrow();
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    reduceScanMesh(source, { mode: "triangles", signal: controller.signal }),
  ).toThrow("cancelled");
});

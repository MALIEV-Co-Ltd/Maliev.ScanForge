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
it("reduces local mesh noise while bounding displacement from original coordinates", () => {
  const source = grid(6, 0.2),
    copy = source.slice();
  const result = reduceScanNoise(source, { iterations: 20, deviation: 0.05 });
  let changed = false;
  for (let i = 0; i < source.length; i += 3) {
    const d = Math.hypot(
      result.positions[i] - source[i],
      result.positions[i + 1] - source[i + 1],
      result.positions[i + 2] - source[i + 2],
    );
    expect(d).toBeLessThanOrEqual(0.050001);
    changed ||= d > 1e-6;
  }
  expect(changed).toBe(true);
  expect(source).toEqual(copy);
  expect(analyzeMesh(result.positions).boundaryEdges).toBe(
    analyzeMesh(source).boundaryEdges,
  );
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
it("does not adopt indexed identity when restored selection seams differ before welding", () => {
  const source = grid(6, 0.2);
  source[9] += 0.0000005;
  const topologyCache: NonNullable<
    import("../src/mesh-processing").MeshProcessingOptions["topologyCache"]
  > = {};
  const selection = new Uint8Array(source.length / 9);
  selection[0] = 1;
  const output = reduceScanNoise(source, {
    iterations: 1,
    deviation: 0.05,
    selectionOnly: true,
    selection,
    topologyCache,
  }).positions;
  expect(output.slice(9)).toEqual(source.slice(9));
  expect(topologyCache.positions).toBe(source);
  const stages: string[] = [];
  analyzeMesh(output, {
    tolerance: 1e-6,
    topologyCache,
    onProgress: (_, stage) => stages.push(stage),
  });
  expect(stages).toContain("Welding vertices");
});
it("pins every vertex shared with unselected triangles", () => {
  const source = grid(6, 0.2),
    selection = new Uint8Array(source.length / 9);
  for (let face = 0; face < selection.length; face++) {
    const coords = Array.from(source.slice(face * 9, face * 9 + 9));
    if (
      coords.filter((_, i) => i % 3 === 0).every((x) => x >= 2 && x <= 4) &&
      coords.filter((_, i) => i % 3 === 1).every((y) => y >= 2 && y <= 4)
    )
      selection[face] = 1;
  }
  const result = reduceScanNoise(source, {
    iterations: 3,
    selectionOnly: true,
    selection,
  });
  for (let face = 0; face < selection.length; face++)
    if (!selection[face])
      expect(result.positions.slice(face * 9, face * 9 + 9)).toEqual(
        source.slice(face * 9, face * 9 + 9),
      );
  expect(result.positions).not.toEqual(source);
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

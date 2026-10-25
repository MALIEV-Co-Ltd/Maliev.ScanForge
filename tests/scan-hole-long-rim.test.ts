import { expect, it } from "vitest";
import { Vector2, ShapeUtils } from "three";
import { refineHolePatch, validHolePatch } from "../src/scan-hole-refine";
import type { Vec3 } from "../src/types";
import type { MeshProcessingOptions } from "../src/mesh-processing";
it("converges beside a long fixed bridge edge among densely sampled rim edges", () => {
  const rim = Array.from(
    { length: 49 },
    (_, i) =>
      new Vector2(
        Math.cos((i * Math.PI) / 48) * 4,
        Math.sin((i * Math.PI) / 48) * 4,
      ),
  );
  const points = rim.map((p) => [p.x, p.y, 0] as Vec3),
    projection = rim.map((p) => p.clone());
  const seed = ShapeUtils.triangulateShape(rim, []).map((f) => f);
  const result = refineHolePatch(
    points,
    projection,
    seed,
    rim.length,
    (p) => [p.x, p.y, 0],
    {},
  );
  expect(validHolePatch(projection, result.triangles, rim.length)).toBe(true);
  expect(result.points.slice(0, rim.length)).toEqual(
    rim.map((p) => [p.x, p.y, 0]),
  );
  expect(result.triangles.length).toBeLessThan(10000);
});

it("fills both dense holes left by a bridge without rewelding the successor", async () => {
  const { runScanEdit } = await import("../src/scan-edit");
  const { analyzeMesh } = await import("../src/mesh-processing");
  const count = 48,
    values: number[] = [];
  const p = (i: number, r: number) => [
    Math.cos((i * 2 * Math.PI) / count) * r,
    Math.sin((i * 2 * Math.PI) / count) * r,
    0,
  ];
  for (let i = 0; i < count; i++)
    values.push(
      ...p(i, 4),
      ...p(i, 5),
      ...p(i + 1, 5),
      ...p(i, 4),
      ...p(i + 1, 5),
      ...p(i + 1, 4),
    );
  const source = Float32Array.from(values),
    topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> = {},
    options = { tolerance: 0.001, topologyCache };
  const inventory = runScanEdit(
    {
      kind: "scanEdit",
      positions: source,
      action: "inventory",
      tolerance: 0.001,
    },
    options,
  ).inventory!;
  // Select by the physical perimeter, independently of diameter estimation.
  const inner = inventory.boundaries.findIndex((b) => b.length < 30);
  const sourceTopology = topologyCache.topology!;
  const [unchangedKey, unchangedUses] = [...sourceTopology.edges].find(
    ([, uses]) => uses.length === 2,
  )!;
  const sourceEdgeCount = sourceTopology.edges.size;

  const bridge = runScanEdit(
    {
      kind: "scanEdit",
      positions: source,
      action: "fillHoles",
      mode: "bridge",
      algorithm: "flat",
      indices: [inner],
      start: 0,
      end: 24,
      tolerance: 0.001,
    },
    options,
  );

  // Compact source rows are snapshots; appending must preserve their values.
  expect(topologyCache.topology!.edges.get(unchangedKey)).toEqual(
    unchangedUses,
  );
  expect(sourceTopology.edges.size).toBe(sourceEdgeCount);
  const { analyzeIndexedMesh } = await import("../src/mesh-processing");
  const successor = topologyCache.topology!;
  const rebuilt = analyzeIndexedMesh(successor.vertices, successor.triangles, {
    tolerance: 0.001,
  });
  expect({ ...successor, edges: [...successor.edges] }).toEqual({
    ...rebuilt,
    edges: [...rebuilt.edges],
  });
  const stages: string[] = [];
  const remaining = runScanEdit(
    {
      kind: "scanEdit",
      positions: bridge.positions!,
      action: "inventory",
      tolerance: 0.001,
    },
    options,
  ).inventory!;
  const holes = remaining.boundaries.flatMap((b, i) =>
    b.length < 30 ? [i] : [],
  );
  expect(holes).toHaveLength(2);
  const filled = runScanEdit(
    {
      kind: "scanEdit",
      positions: bridge.positions!,
      action: "fillHoles",
      mode: "entire",
      indices: holes,
      algorithm: "surfaceRecovery",
      tolerance: 0.001,
    },
    { ...options, onProgress: (_, stage) => stages.push(stage) },
  );
  expect(filled.diagnostics.filledHoles).toBe(2);
  expect(stages).not.toContain("Welding vertices");
  expect(stages).not.toContain("Building topology");
  const final = analyzeMesh(filled.positions!, { tolerance: 0.001 });
  expect(final.boundaryLoops).toHaveLength(1);
  expect(final.nonManifoldEdges).toBe(0);
  expect(final.inconsistentEdges).toBe(0);
});

it("does not quantize or replace cached geometry for an empty fill", async () => {
  const { runScanEdit } = await import("../src/scan-edit");
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const source = [1e8, 0, 0, 1e8 + 1, 0, 0, 1e8, 1, 0],
    options = { topologyCache: cache, tolerance: 0.001 };
  runScanEdit(
    {
      kind: "scanEdit",
      positions: source,
      action: "inventory",
      tolerance: 0.001,
    },
    options,
  );
  const before = cache.topology!;
  expect(before.edges.size).toBe(3);
  const unchanged = runScanEdit(
    {
      kind: "scanEdit",
      positions: source,
      action: "fillHoles",
      indices: [],
      tolerance: 0.001,
    },
    options,
  );
  expect(unchanged.diagnostics.changed).toBe(false);
  expect(cache.topology).toBe(before);
  expect(cache.positions).toBe(source);
  expect(cache.topology!.degenerateTriangles).toBe(0);
  expect(cache.topology!.edges.size).toBe(3);
  expect(before.edges.size).toBe(3);
});

it("refreshes adjacency when an accepted patch's Float32 output collapses an existing facet", async () => {
  const { runScanEdit } = await import("../src/scan-edit");
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const tetra = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const source = [
    1e8,
    0,
    0,
    1e8 + 1,
    0,
    0,
    1e8,
    1,
    0,
    ...[
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3],
    ].flatMap((face) => face.flatMap((id) => tetra[id])),
  ];
  const options = { topologyCache: cache, tolerance: 0.001 };
  const inventory = runScanEdit(
    {
      kind: "scanEdit",
      action: "inventory",
      positions: source,
      tolerance: 0.001,
    },
    options,
  ).inventory!;
  const hole = inventory.boundaries.findIndex((boundary) =>
    boundary.points.every((v) => Math.abs(v) < 2),
  );
  expect(hole).toBeGreaterThanOrEqual(0);
  const before = cache.topology!;
  const result = runScanEdit(
    {
      kind: "scanEdit",
      action: "fillHoles",
      positions: source,
      indices: [hole],
      algorithm: "flat",
      tolerance: 0.001,
    },
    options,
  );
  expect(result.diagnostics.filledHoles).toBe(1);
  expect(cache.topology).not.toBe(before);
  expect(cache.topology!.degenerateTriangles).toBe(1);
  expect(cache.topology!.edges.size).toBe(6);
  expect(before.edges.size).toBe(9);
});

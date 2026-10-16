import { expect, it } from "vitest";
import { createScanBudget } from "../src/scan-resource-budget";
import { createMemoryPageStore } from "../src/scan-memory-page-store";
import { scanDirectoryWriter } from "../src/scan-page-directory";
import { preparePagedReductionSurface } from "../src/scan-paged-surface-index";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";
import type { ScanReductionManifest } from "../src/scan-geometry-source";

it("evicted neighboring chunks still contain the closest facet", async () => {
  const budget = createScanBudget(65_536, 0),
    store = createMemoryPageStore(budget, "surface");
  const chunks = scanDirectoryWriter(store, budget);
  const triangles = [
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    new Float32Array([0, 0, 0.09, 1, 0, 0.09, 0, 1, 0.09]),
  ];
  for (let id = 0; id < triangles.length; id++)
    await chunks.append({
      first: id,
      count: 1,
      page: await store.append(new Uint8Array(triangles[id].buffer)),
    });
  const manifest: ScanReductionManifest = {
    source: { id: "source", generation: 1 },
    ref: { id: "result", generation: 1 },
    chunks: await chunks.finish(),
    triangles: 2,
    targetTriangles: 2,
    bounds: [0, 0, 0, 1, 1, 0.09],
    precision: "float32",
    protectedPatches: 0,
    protectedSourceTriangles: 0,
  };
  const index = await preparePagedReductionSurface(manifest, store, budget);
  const baseline = budget.snapshot().reservedBytes;
  for (const point of [
    [0.2, 0.2, 0.1],
    [0.2, 0.2, -0.01],
    [0.2, 0.2, 0.1],
  ]) {
    const query = await index.queryBatch(new Float64Array(point), 0.25);
    const rounded = point.map(Math.fround);
    const expected = triangles
      .map((p, id) => ({
        id,
        distance: noiseTriangleDistance(
          rounded,
          [...p.subarray(0, 3)],
          [...p.subarray(3, 6)],
          [...p.subarray(6, 9)],
          0.25,
        ),
      }))
      .sort(
        (a, b) => Math.abs(a.distance) - Math.abs(b.distance) || a.id - b.id,
      )[0];
    expect(query.distances).toEqual(new Float64Array([expected.distance]));
    expect(query.triangleIds).toEqual(new Float64Array([expected.id]));
    query.release();
  }
  index.dispose();
  expect(budget.snapshot().reservedBytes).toBe(baseline);
  expect(budget.snapshot().peakBytes).toBeLessThanOrEqual(65_536);
});

it("resolves equal-distance opposite winding by global source ID and keeps strict radius", async () => {
  const budget = createScanBudget(65_536, 0),
    store = createMemoryPageStore(budget, "ties"),
    chunks = scanDirectoryWriter(store, budget);
  const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    opposite = new Float32Array([0, 0, 0, 0, 1, 0, 1, 0, 0]);
  for (const [id, triangle] of [p, opposite].entries())
    await chunks.append({
      first: id,
      count: 1,
      page: await store.append(new Uint8Array(triangle.buffer)),
    });
  const manifest: ScanReductionManifest = {
    source: { id: "source", generation: 1 },
    ref: { id: "ties", generation: 1 },
    chunks: await chunks.finish(),
    triangles: 2,
    targetTriangles: 2,
    bounds: [0, 0, 0, 1, 1, 0],
    precision: "float32",
    protectedPatches: 0,
    protectedSourceTriangles: 0,
  };
  const index = await preparePagedReductionSurface(manifest, store, budget);
  try {
    const batch = await index.queryBatch(
      new Float32Array([0.25, 0.25, 0.125, 0.25, 0.25, 0.25]),
      0.25,
    );
    expect([...batch.triangleIds]).toEqual([0, -1]);
    expect(batch.distances[0]).toBe(0.125);
    expect(batch.distances[1]).toBeNaN();
    batch.release();
  } finally {
    index.dispose();
  }
});

it("rejects an oversized query batch before waiting on its own retained scratch", async () => {
  const budget = createScanBudget(65_536, 0),
    store = createMemoryPageStore(budget, "capacity"),
    chunks = scanDirectoryWriter(store, budget);
  const triangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  await chunks.append({
    first: 0,
    count: 1,
    page: await store.append(new Uint8Array(triangle.buffer)),
  });
  const manifest: ScanReductionManifest = {
    source: { id: "source", generation: 1 },
    ref: { id: "capacity", generation: 1 },
    chunks: await chunks.finish(),
    triangles: 1,
    targetTriangles: 1,
    bounds: [0, 0, 0, 1, 1, 0],
    precision: "float32",
    protectedPatches: 0,
    protectedSourceTriangles: 0,
  };
  const index = await preparePagedReductionSurface(manifest, store, budget);
  const before = budget.snapshot().reservedBytes;
  await expect(
    index.queryBatch(new Float32Array(3900 * 3), 0.25),
  ).rejects.toThrow(/split the comparison batch/);
  index.dispose();
  expect(budget.snapshot().reservedBytes).toBe(before);
});

import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { createScanBudget } from "../src/scan-resource-budget";
import { createMemoryPageStore } from "../src/scan-memory-page-store";
import { residentScanSource } from "../src/scan-resident-source";
import { createScanSampleDirectory } from "../src/scan-sample-directory";

it("cross-page samples retain recovered weld order", async () => {
  const p: number[] = [];
  for (let n = 0; n < 90; n++) {
    // Neighboring cells, negative coordinates and a double-precision origin.
    const x = -12.123456789 + n * 0.75e-6;
    p.push(x, 0, 0, x, 1, 0, x + 2e-6, 0, 1);
  }
  const budget = createScanBudget(65_536, p.length * 8);
  const store = createMemoryPageStore(budget, "weld");
  const source = residentScanSource(p, { id: "weld", generation: 1 }, budget);
  const expected = analyzeMesh(p, { tolerance: 1e-6 });
  const actual = await createScanSampleDirectory(source, store, budget);
  const coordinates: number[] = [];
  for await (const batch of actual.samples()) {
    coordinates.push(...batch.coordinates);
    batch.release();
  }
  expect(new Float64Array(coordinates)).toEqual(expected.vertices);
  const corners = await actual.corners(0, source.metadata.triangles);
  expect([...corners.sampleIds]).toEqual([...expected.triangles]);
  corners.release();
  expect(actual.sampleCount).toBe(expected.vertices.length / 3);
  expect(budget.snapshot().peakBytes).toBeLessThanOrEqual(65_536);
});

it("preserves competing representatives by cell traversal rather than nearest distance", async () => {
  const input = [
    0, 0, 0, -0.9e-6, 0, 0, 0.9e-6, 0, 0, 1.1e-6, 0, 0, 2.1e-6, 0, 0, 0.7e-6, 0,
    0,
  ];
  const budget = createScanBudget(65_536, 0);
  const source = residentScanSource(
    input,
    { id: "ties", generation: 0 },
    budget,
  );
  const expected = analyzeMesh(input, { tolerance: 1e-6 });
  const actual = await createScanSampleDirectory(
    source,
    createMemoryPageStore(budget, "ties"),
    budget,
  );
  const corners = await actual.corners(0, 2);
  expect([...corners.sampleIds]).toEqual([...expected.triangles]);
  corners.release();
});

it("cancels before accessing pages and validates requested corner ranges", async () => {
  const budget = createScanBudget(65_536, 0);
  const source = residentScanSource(
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    { id: "abort", generation: 0 },
    budget,
  );
  const store = createMemoryPageStore(budget, "abort");
  const abort = new AbortController();
  abort.abort();
  await expect(
    createScanSampleDirectory(source, store, budget, abort.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(budget.snapshot().reservedBytes).toBe(0);
  const actual = await createScanSampleDirectory(source, store, budget);
  await expect(actual.corners(1, 1)).rejects.toThrow(/range/);
});

it("rejects insufficient setup capacity before retaining a partial reservation", async () => {
  const budget = createScanBudget(650, 0);
  const source = residentScanSource(
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    { id: "small", generation: 0 },
    budget,
  );
  await expect(
    createScanSampleDirectory(
      source,
      createMemoryPageStore(budget, "small"),
      budget,
    ),
  ).rejects.toThrow(/capacity/);
  expect(budget.snapshot().reservedBytes).toBe(0);
});

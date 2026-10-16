import { expect, it } from "vitest";
import { createScanBudget } from "../src/scan-resource-budget";
import { createMemoryPageStore } from "../src/scan-memory-page-store";
import { residentScanSource } from "../src/scan-resident-source";
import { createScanSampleDirectory } from "../src/scan-sample-directory";
import { scanDirectoryEntries } from "../src/scan-page-directory";
import { writeComparisonPages } from "../src/scan-comparison-output";
import { nativeNoiseColor } from "../src/scan-noise-color";

it("writes unique-sample statistics and original-corner colors without adjacency", async () => {
  const budget = createScanBudget(65_536, 0);
  const store = createMemoryPageStore(budget, "output");
  const source = residentScanSource(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, -1, 0, 0],
    { id: "source", generation: 1 },
    budget,
  );
  const samples = await createScanSampleDirectory(source, store, budget);
  let released = 0;
  async function* batches() {
    yield {
      firstSample: 0,
      distances: new Float64Array([0.01, -0.1]),
      triangleIds: new Float64Array([0, 1]),
      release() {
        released++;
      },
    };
    yield {
      firstSample: 2,
      distances: new Float64Array([NaN, 0.02]),
      triangleIds: new Float64Array([-1, 1]),
      release() {
        released++;
      },
    };
  }
  const result = await writeComparisonPages(samples, batches(), 0.05, 0.05, {
    store,
    budget,
    progress() {},
  });
  expect(released).toBe(2);
  expect(result.statistics).toMatchObject({
    total: 4,
    matched: 3,
    within: 2,
    unmatched: 1,
    percentage: 50,
    minimum: -0.1,
    maximum: 0.02,
  });
  expect(result.statistics.rms).toBe(
    Math.sqrt((0.01 ** 2 + 0.1 ** 2 + 0.02 ** 2) / 3),
  );
  const colors: number[] = [];
  for await (const entry of scanDirectoryEntries(
    result.colors,
    store,
    budget,
  )) {
    const page = await store.read(entry.page);
    colors.push(...page.bytes);
    page.release();
  }
  const distances = [0.01, -0.1, NaN, 0.02];
  expect(colors).toEqual(
    [0, 1, 2, 0, 2, 3].flatMap((id) =>
      Number.isNaN(distances[id])
        ? [50, 50, 50]
        : nativeNoiseColor(distances[id], Math.fround(0.05)),
    ),
  );
  expect(budget.snapshot().peakBytes).toBeLessThanOrEqual(65_536);
});

it("rejects missing or reordered samples and releases the failing batch", async () => {
  const budget = createScanBudget(65_536, 0),
    store = createMemoryPageStore(budget, "invalid");
  const samples = await createScanSampleDirectory(
    residentScanSource(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      { id: "source", generation: 1 },
      budget,
    ),
    store,
    budget,
  );
  let released = false;
  async function* invalid() {
    yield {
      firstSample: 1,
      distances: new Float64Array([0]),
      triangleIds: new Float64Array([0]),
      release() {
        released = true;
      },
    };
  }
  await expect(
    writeComparisonPages(samples, invalid(), 0.05, 0.05, {
      store,
      budget,
      progress() {},
    }),
  ).rejects.toThrow(/order/);
  expect(released).toBe(true);
});

import { expect, it } from "vitest";
import { createScanBudget } from "../src/scan-resource-budget";
import { createMemoryPageStore } from "../src/scan-memory-page-store";
import { scanDirectoryEntries } from "../src/scan-page-directory";

it("deep range lookups do not pin decoded ancestor pages", async () => {
  const budget = createScanBudget(65_536, 0),
    store = createMemoryPageStore(budget, "directory");
  const data = await store.append(new Uint8Array([1]));
  let ref = data;
  for (let depth = 0; depth < 8; depth++) {
    const entries = Array.from({ length: 8 }, (_, id) => ({
      first: id * 8 ** depth,
      count: 8 ** depth,
      page: id === 0 ? ref : data,
    }));
    ref = await store.append(new TextEncoder().encode(JSON.stringify(entries)));
  }
  const baseline = budget.snapshot().reservedBytes;
  const found = [];
  for await (const entry of scanDirectoryEntries(
    { root: ref, entries: 8 ** 8, levels: 8 },
    store,
    budget,
    undefined,
    0,
    1,
  ))
    found.push(entry);
  expect(found).toEqual([{ first: 0, count: 1, page: data }]);
  expect(budget.snapshot().reservedBytes).toBe(baseline);
  expect(budget.snapshot().peakBytes).toBeLessThanOrEqual(65_536);
});

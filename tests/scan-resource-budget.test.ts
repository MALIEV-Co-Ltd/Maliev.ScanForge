import { expect, it } from "vitest";
import { createScanBudget } from "../src/scan-resource-budget";

it("reservations bound live scratch, not scan length", async () => {
  const budget = createScanBudget(65_536, 4_000_000_000);
  const first = await budget.reserve("first", 50_000);
  let granted = false;
  const waiting = budget.reserve("second", 20_000).then((lease) => {
    granted = true;
    return lease;
  });
  await Promise.resolve();
  expect(granted).toBe(false);
  first.release();
  first.release();
  const second = await waiting;
  expect(budget.snapshot().reservedBytes).toBe(20_000);
  second.release();
  expect(budget.snapshot().peakBytes).toBeLessThanOrEqual(65_536);
  expect(budget.snapshot().reservedBytes).toBe(0);
  expect(budget.snapshot().residentProjectBytes).toBe(4_000_000_000);
});

it("queues claims FIFO and removes aborted waiters without starving successors", async () => {
  const budget = createScanBudget(100, 0);
  const current = await budget.reserve("current", 80);
  const abort = new AbortController();
  const pending = budget.reserve("cancelled", 90, abort.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  const successor = budget.reserve("successor", 30);
  abort.abort();
  await rejected;
  current.release();
  (await successor).release();
  expect(budget.snapshot().reservedBytes).toBe(0);
  await expect(budget.reserve("oversize", 101)).rejects.toThrow(/capacity/);
  await expect(budget.reserve("invalid", NaN)).rejects.toThrow(/integer/);
  await expect(
    budget.reserve("aborted", 1, abort.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("small requests cannot leapfrog an earlier larger request", async () => {
  const budget = createScanBudget(100, 0);
  const held = await budget.reserve("held", 60);
  const order: number[] = [];
  const a = budget.reserve("a", 80).then((lease) => {
    order.push(1);
    return lease;
  });
  const b = budget.reserve("b", 10).then((lease) => {
    order.push(2);
    return lease;
  });
  await Promise.resolve();
  expect(order).toEqual([]);
  held.release();
  const one = await a,
    two = await b;
  expect(order).toEqual([1, 2]);
  one.release();
  two.release();
});

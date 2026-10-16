import { expect, it } from "vitest";
import { createScanBudget } from "../src/scan-resource-budget";
import { residentScanSource } from "../src/scan-resident-source";
import { createMemoryPageStore } from "../src/scan-memory-page-store";

it("leases precise range copies without detaching or changing authored buffers", async () => {
  const budget = createScanBudget(65_536, 0);
  const input = [0.1234567890123, 0, 0, 1, 0, 0, 0, 1, 0];
  const source = residentScanSource(
    input,
    { id: "source", generation: 1 },
    budget,
  );
  expect(source.metadata.precision).toBe("float64");
  expect(source.metadata.triangles).toBe(1);
  const chunk = await source.readTriangles(0, 1);
  expect(chunk.positions).toBeInstanceOf(Float64Array);
  expect(chunk.positions[0]).toBe(input[0]);
  chunk.positions[0] = 99;
  expect(input[0]).toBe(0.1234567890123);
  chunk.release();
  chunk.release();
  expect(budget.snapshot().reservedBytes).toBe(0);
  await expect(source.readTriangles(-1, 1)).rejects.toThrow(/range/);
  await expect(source.readTriangles(0, 2)).rejects.toThrow(/range/);
});

it("retains caller Float32 arrays and validates range before allocation", async () => {
  const budget = createScanBudget(128, 0);
  const input = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const source = residentScanSource(
    input,
    { id: "float", generation: 0 },
    budget,
  );
  const chunk = await source.readTriangles(0, 1);
  expect(chunk.positions).toBeInstanceOf(Float32Array);
  expect(input.byteLength).toBe(36);
  chunk.release();
  expect(() =>
    residentScanSource([NaN, 0, 0], { id: "bad", generation: 0 }, budget),
  ).toThrow();
});

it("serves bounded ranges from a resident source larger than scratch capacity", async () => {
  const input = new Float32Array(9 * 30_000);
  const budget = createScanBudget(65_536, input.byteLength);
  const source = residentScanSource(
    input,
    { id: "large", generation: 1 },
    budget,
  );
  for (let start = 0; start < 30_000; start += 1000) {
    const chunk = await source.readTriangles(start, 1000);
    expect(chunk.triangleCount).toBe(1000);
    chunk.release();
  }
  expect(budget.snapshot().peakBytes).toBe(36_000);
  expect(budget.snapshot().reservedBytes).toBe(0);
  await expect(source.readTriangles(0, 2000)).rejects.toThrow(/capacity/);
});

it("cancels queued page reads without leaking reservations", async () => {
  const budget = createScanBudget(100, 0);
  const store = createMemoryPageStore(budget, "queued-reader");
  const ref = await store.append(new Uint8Array(60));
  const abort = new AbortController();
  const pending = store.read(ref, abort.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  abort.abort();
  await rejected;
  expect(budget.snapshot().reservedBytes).toBe(60);
  await store.remove(ref);
  expect(budget.snapshot().reservedBytes).toBe(0);
});

it("requests disk storage rather than deadlocking on retained memory pages", async () => {
  const budget = createScanBudget(100, 0);
  const store = createMemoryPageStore(budget, "full");
  const first = await store.append(new Uint8Array(40));
  await expect(store.append(new Uint8Array(61))).rejects.toThrow(
    /disk storage/,
  );
  await store.remove(first);
  expect(budget.snapshot().reservedBytes).toBe(0);
});

it("memory pages own immutable bytes, validate checksums and release readers", async () => {
  const budget = createScanBudget(65_536, 0);
  const store = createMemoryPageStore(budget, "job");
  const input = new Uint8Array([1, 2, 3]);
  const ref = await store.append(input);
  input[0] = 9;
  const page = await store.read(ref);
  expect([...page.bytes]).toEqual([1, 2, 3]);
  page.bytes[0] = 7;
  page.release();
  page.release();
  const another = await store.read(ref);
  expect([...another.bytes]).toEqual([1, 2, 3]);
  another.release();
  await expect(store.read({ ...ref, sha256: "wrong" })).rejects.toThrow(
    /checksum/,
  );
  await store.remove(ref);
  await expect(store.read(ref)).rejects.toThrow(/missing/);
  expect(budget.snapshot().reservedBytes).toBe(0);
});

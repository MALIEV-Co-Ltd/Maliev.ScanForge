import { afterEach, expect, it, vi } from "vitest";
import { importBatch, planImportBatch } from "../src/import-batch";

const MiB = 1024 ** 2;
const capacity = { cores: 8, memoryGiB: 8, usedHeapBytes: 64 * MiB };
it("reserves facet memory and caps the active-pair budget", async () => {
  const file = new File(["mesh"], "scan.stl");
  const result = await planImportBatch([file, file], undefined, {
    cores: 8,
    memoryGiB: 64,
    usedHeapBytes: 0,
  });
  expect(result.memoryBudgetBytes).toBe(1024 ** 3);
  expect(result.estimates[0].bytes).toBe(file.size * 16 + 32 * MiB);
});
function cloud(size = 80 * MiB): File {
  const sample = new Blob([
    "5000.000000000000 -3000.000000000000 200.000000000000\n".repeat(1200),
  ]);
  return {
    name: "cloud.asc",
    size,
    slice: (start: number, end: number) => sample.slice(0, end - start),
  } as File;
}
afterEach(() => vi.unstubAllGlobals());
it("admits sampled ASC pairs within the bounded memory budget", async () => {
  const admission = await planImportBatch(
    [cloud(), cloud()],
    undefined,
    capacity,
  );
  expect(admission.concurrency).toBe(2);
  expect(admission.reason).toBe("parallel");
  expect(
    admission.estimates.every((file) => file.basis === "sampled-asc"),
  ).toBe(true);
  expect(admission.estimatedPeakBytes).toBeLessThan(
    admission.memoryBudgetBytes,
  );
});
it("serializes larger sampled ASC pairs when they exceed the active-pair budget", async () => {
  expect(
    await planImportBatch(
      [cloud(200 * MiB), cloud(200 * MiB)],
      undefined,
      capacity,
    ),
  ).toMatchObject({ concurrency: 1, reason: "memory" });
});
it("budgets the largest active pair rather than every queued file", async () => {
  const pair = await planImportBatch([cloud(), cloud()], undefined, capacity);
  const batch = await planImportBatch(
    Array.from({ length: 10 }, () => cloud()),
    undefined,
    capacity,
  );
  expect(batch.concurrency).toBe(2);
  expect(batch.estimatedPeakBytes).toBe(pair.estimatedPeakBytes);
});
it("retains memory reserve and reports why admission is sequential", async () => {
  const admission = await planImportBatch([cloud(), cloud()], undefined, {
    ...capacity,
    usedHeapBytes: 2 * 1024 ** 3,
  });
  expect(admission).toMatchObject({
    concurrency: 1,
    reason: "memory",
    memoryBudgetBytes: 0,
  });
  expect(admission.message).toMatch(/memory budget/i);
  expect(
    await planImportBatch([cloud(), cloud()], undefined, {
      ...capacity,
      cores: 2,
    }),
  ).toMatchObject({ concurrency: 1, reason: "cpu" });
});
it("does not use the main thread heap limit as worker capacity", async () => {
  vi.stubGlobal("performance", {
    memory: { jsHeapSizeLimit: 128 * MiB, usedJSHeapSize: 64 * MiB },
  });
  expect(
    (await planImportBatch([cloud(), cloud()], undefined, capacity))
      .concurrency,
  ).toBe(2);
});
it("keeps conservative estimates when an ASC sample cannot be read", async () => {
  const file = {
    name: "unreadable.asc",
    size: 200 * MiB,
    slice: () => {
      throw Error("Read failed");
    },
  } as unknown as File;
  const admission = await planImportBatch([file, file], undefined, capacity);
  expect(admission).toMatchObject({ concurrency: 1, reason: "memory" });
  expect(
    admission.estimates.every((file) => file.basis === "source-size"),
  ).toBe(true);
});
it("cancels preparation before scheduling any parser", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    planImportBatch([cloud(), cloud()], controller.signal, capacity),
  ).rejects.toThrow();
});
it("reports the same admission to GUI progress, MCP progress and the batch result", async () => {
  const admission = await planImportBatch(
    [cloud(), cloud()],
    undefined,
    capacity,
  );
  const progress = vi.fn();
  const result = await importBatch([1, 2], async (value) => value, undefined, {
    admission,
    onProgress: progress,
  });
  expect(result.admission).toEqual(admission);
  expect(
    progress.mock.calls.every(([details]) => details.admission === admission),
  ).toBe(true);
});

it("does not advertise parallel scan parsers for CAD-only batches", async () => {
  const files = [new File(["cad"], "a.step"), new File(["cad"], "b.brep")];
  expect(await planImportBatch(files, undefined, capacity)).toMatchObject({
    concurrency: 1,
    reason: "format",
  });
});

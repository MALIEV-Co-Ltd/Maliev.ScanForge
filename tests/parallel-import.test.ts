import { afterEach, expect, it, vi } from "vitest";
import { importBatch, planImportBatch } from "../src/import-batch";

it("overlaps two loads but serializes commits and keeps ordered results", async () => {
  let active = 0,
    peak = 0,
    committing = 0;
  const states: unknown[] = [];
  const result = await importBatch(
    ["a", "b", "bad", "c"],
    async (name, _index, context) => {
      peak = Math.max(peak, ++active);
      context.progress(0.5, "Parsing");
      await new Promise((resolve) =>
        setTimeout(resolve, name === "a" ? 15 : 2),
      );
      active--;
      if (name === "bad") throw Error("Invalid scan");
      return name;
    },
    undefined,
    {
      concurrency: 2,
      onProgress: (state) => states.push(state),
      commit: async (value) => {
        expect(++committing).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 2));
        committing--;
        return value;
      },
    },
  );
  expect(peak).toBe(2);
  expect(result.completed).toEqual(["a", "b", "c"]);
  expect(result.failed).toEqual([{ index: 2, error: "Invalid scan" }]);
  expect(
    states.some(
      (s: any) =>
        s.files.filter((f: any) => f.status === "importing").length === 2,
    ),
  ).toBe(true);
});

it("waits for active loads on cancellation and never starts queued files", async () => {
  const controller = new AbortController();
  const started: number[] = [];
  let released = 0;
  const pending = importBatch(
    [1, 2, 3],
    async (file, _index, context) => {
      started.push(file);
      try {
        await new Promise<void>((_resolve, reject) =>
          context.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          ),
        );
        return file;
      } finally {
        released++;
      }
    },
    controller.signal,
    { concurrency: 2 },
  );
  controller.abort();
  const result = await pending;
  expect(result.cancelled).toBe(true);
  expect(started).toEqual([1, 2]);
  expect(released).toBe(2);
});

const MiB = 1024 ** 2;
const capacity = { cores: 8, memoryGiB: 8, usedHeapBytes: 64 * MiB };
function cloud(size = 200 * MiB): File {
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
it("estimates streaming ASC buffers instead of rejecting files over 128 MiB", async () => {
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

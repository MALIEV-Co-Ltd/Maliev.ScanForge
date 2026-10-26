import { expect, it } from "vitest";
import { importBatch, importConcurrency } from "../src/import-batch";

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

it("admits two small imports and falls back for constrained or large inputs", () => {
  expect(
    importConcurrency([{ size: 1000 }, { size: 1000 }], {
      cores: 8,
      memoryGiB: 8,
    }),
  ).toBe(2);
  expect(
    importConcurrency([{ size: 1000 }, { size: 1000 }], {
      cores: 2,
      memoryGiB: 8,
    }),
  ).toBe(1);
  expect(
    importConcurrency([{ size: 1000 }, { size: 1000 }], {
      cores: 8,
      memoryGiB: 4,
    }),
  ).toBe(1);
  expect(
    importConcurrency([{ size: 100e6 }, { size: 100e6 }], {
      cores: 8,
      memoryGiB: 8,
    }),
  ).toBe(1);
});

it("reserves the added per-facet stream before overlapping borderline import batches", () => {
  expect(
    importConcurrency([{ size: 18 * 1048576 }, { size: 18 * 1048576 }], {
      cores: 8,
      memoryGiB: 8,
    }),
  ).toBe(1);
});

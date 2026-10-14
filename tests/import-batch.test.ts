import { expect, it } from "vitest";
import { importBatch, validateImportBatch } from "../src/import-batch";

it("imports every file in order without overlapping workers and retains per-file results", async () => {
  let active = 0;
  const started: string[] = [];
  const result = await importBatch(
    ["a.stl", "bad.stl", "b.asc"],
    async (name) => {
      expect(++active).toBe(1);
      started.push(name);
      await Promise.resolve();
      active--;
      if (name === "bad.stl") throw new Error("Invalid scan");
      return name;
    },
  );
  expect(started).toEqual(["a.stl", "bad.stl", "b.asc"]);
  expect(result.completed).toEqual(["a.stl", "b.asc"]);
  expect(result.failed).toEqual([{ index: 1, error: "Invalid scan" }]);
  expect(result.cancelled).toBe(false);
});

it("stops the remaining queue on cancellation while retaining completed files", async () => {
  const controller = new AbortController();
  const result = await importBatch(
    [1, 2, 3],
    async (file) => {
      if (file === 2) {
        controller.abort();
        throw new DOMException("Cancelled", "AbortError");
      }
      return file;
    },
    controller.signal,
  );
  expect(result.completed).toEqual([1]);
  expect(result.failed).toEqual([]);
  expect(result.cancelled).toBe(true);
});

it("rejects project replacement mixed into a batch before any file imports", () => {
  expect(() => validateImportBatch(["a.stl", "project.scanforge"])).toThrow(
    "separately",
  );
  expect(() => validateImportBatch(["a.stl", "b.asc"])).not.toThrow();
  expect(() => validateImportBatch(["project.scanforge"])).not.toThrow();
  expect(() => validateImportBatch(["a.stl", "b.exe"])).toThrow("Unsupported");
});

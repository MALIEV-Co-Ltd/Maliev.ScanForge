import { afterEach, expect, it, vi } from "vitest";
import {
  diskBackedBlob,
  DISK_BLOB_BLOCK_BYTES,
} from "../src/transient-blob-storage";

afterEach(() => vi.unstubAllGlobals());

it("removes a committed temporary record when cancellation races the write completion", async () => {
  const controller = new AbortController();
  const records = new Map<string, unknown>([
    ["other-operation", { file: "keep" }],
  ]);
  let transactions = 0;
  const database = {
    createObjectStore: () => undefined,
    close: vi.fn(),
    transaction: () => {
      const number = ++transactions;
      let aborted = false;
      const tx = {
        oncomplete: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        error: null,
        abort: () => {
          aborted = true;
          tx.onabort?.();
        },
        objectStore: () => ({
          openCursor: () => ({ result: null }),
          put: (value: unknown, key: string) => records.set(key, value),
          get: (key: string) => ({ result: records.get(key) }),
          delete: (key: string) => records.delete(key),
        }),
      };
      queueMicrotask(() => {
        if (aborted) return;
        if (number === 1) controller.abort();
        tx.oncomplete?.();
      });
      return tx;
    },
  };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request = {
        result: database,
        onupgradeneeded: undefined as (() => void) | undefined,
        onsuccess: undefined as (() => void) | undefined,
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  });
  const blob = new Blob();
  Object.defineProperty(blob, "size", { value: DISK_BLOB_BLOCK_BYTES });
  await expect(diskBackedBlob(blob, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect([...records.entries()]).toEqual([
    ["other-operation", { file: "keep" }],
  ]);
  expect(database.close).toHaveBeenCalledOnce();
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  deleteTopologyRecord,
  readTopologyRecord,
  writeTopologyRecord,
  type TopologyCacheRecord,
} from "../src/topology-cache-store";

const DAY = 86_400_000;
const MIB = 1024 * 1024;

/** Async requests, atomic commit/abort, and connection ownership without a dependency. */
class CacheDatabaseDouble {
  stores = new Map<string, Map<string, unknown>>();
  opens: Array<{ name: string; version: number | undefined }> = [];
  connections: Array<{
    close: ReturnType<typeof vi.fn>;
    onversionchange?: () => void;
  }> = [];
  requests: Array<{ store: string; operation: string }> = [];
  mode:
    | "normal"
    | "unavailable"
    | "blocked"
    | "stalled-open"
    | "stalled-transaction"
    | "quota" = "normal";
  pendingOpen?: () => void;
  aborted = 0;

  factory = {
    open: (name: string, version?: number) => {
      this.opens.push({ name, version });
      if (this.mode === "unavailable") throw new Error("disabled");
      const request: Record<string, unknown> = {};
      const connection = {
        close: vi.fn(),
        onversionchange: undefined as (() => void) | undefined,
        objectStoreNames: { contains: (key: string) => this.stores.has(key) },
        createObjectStore: (key: string) => this.stores.set(key, new Map()),
        transaction: (names: string | string[], mode: string) =>
          this.transaction(names, mode),
      };
      this.connections.push(connection);
      const finish = () => {
        request.result = connection;
        if (!this.stores.size)
          (request.onupgradeneeded as (() => void) | undefined)?.();
        (request.onsuccess as (() => void) | undefined)?.();
      };
      if (this.mode === "stalled-open" || this.mode === "blocked") {
        this.pendingOpen = finish;
        if (this.mode === "blocked")
          queueMicrotask(() =>
            (request.onblocked as (() => void) | undefined)?.(),
          );
      } else queueMicrotask(finish);
      return request;
    },
  };

  transaction(names: string | string[], mode: string) {
    const selected = typeof names === "string" ? [names] : names;
    const drafts = new Map(
      selected.map((name) => [name, new Map(this.stores.get(name))]),
    );
    let pending = 0;
    let finished = false;
    const transaction = {
      oncomplete: undefined as (() => void) | undefined,
      onabort: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      error: null as Error | null,
      abort: () => {
        if (finished) return;
        finished = true;
        this.aborted++;
        queueMicrotask(() => transaction.onabort?.());
      },
      objectStore: (name: string) => {
        const values = drafts.get(name)!;
        const enqueue = (operation: string, perform: () => unknown) => {
          this.requests.push({ store: name, operation });
          const request = {
            result: undefined as unknown,
            onsuccess: undefined as (() => void) | undefined,
          };
          pending++;
          if (this.mode !== "stalled-transaction")
            queueMicrotask(() => {
              if (finished) return;
              if (this.mode === "quota" && operation === "put") {
                transaction.error = new Error("QuotaExceededError");
                transaction.abort();
                return;
              }
              request.result = perform();
              request.onsuccess?.();
              pending--;
              queueMicrotask(() => {
                if (finished || pending) return;
                finished = true;
                if (mode === "readwrite")
                  for (const [key, draft] of drafts)
                    this.stores.set(key, draft);
                transaction.oncomplete?.();
              });
            });
          return request;
        };
        return {
          get: (key: string) =>
            enqueue("get", () => structuredClone(values.get(key))),
          getAll: () =>
            enqueue("getAll", () => structuredClone([...values.values()])),
          put: (value: { key: string }) =>
            enqueue("put", () => {
              values.set(value.key, structuredClone(value));
              return value.key;
            }),
          delete: (key: string) => enqueue("delete", () => values.delete(key)),
        };
      },
    };
    return transaction;
  }
}

let database: CacheDatabaseDouble;
function record(key: string, bytes = 32): TopologyCacheRecord {
  return {
    key,
    bytes,
    sourceLength: 9,
    tolerance: 1e-7,
    payload: { value: new Uint32Array([1, 2, 3]) },
    checksum: "abc123",
    createdAt: Date.now(),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T00:00:00Z"));
  database = new CacheDatabaseDouble();
  vi.stubGlobal("indexedDB", database.factory);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("persists across connections, touches only metadata, and closes every connection", async () => {
  const value = record("v1:mesh");
  expect(await writeTopologyRecord(value)).toBe(true);
  database.requests = [];
  expect(await readTopologyRecord(value.key)).toEqual(value);
  expect(
    database.requests.filter(
      (request) => request.store === "records" && request.operation === "get",
    ),
  ).toHaveLength(1);
  expect(database.requests).not.toContainEqual({
    store: "records",
    operation: "put",
  });
  expect(database.requests).not.toContainEqual({
    store: "records",
    operation: "getAll",
  });
  expect(database.opens).toEqual([
    { name: "scanforge-topology-cache", version: 1 },
    { name: "scanforge-topology-cache", version: 1 },
  ]);
  expect(
    database.connections.every(
      (connection) => connection.close.mock.calls.length === 1,
    ),
  ).toBe(true);
  await deleteTopologyRecord(value.key);
  expect(await readTopologyRecord(value.key)).toBeUndefined();
});

it("bounds entries by LRU and reads refresh eviction order", async () => {
  for (let index = 0; index < 8; index++) {
    vi.setSystemTime(Date.now() + 1);
    expect(await writeTopologyRecord(record(`mesh${index}`))).toBe(true);
  }
  vi.setSystemTime(Date.now() + 1);
  expect(await readTopologyRecord("mesh0")).toBeDefined();
  vi.setSystemTime(Date.now() + 1);
  expect(await writeTopologyRecord(record("mesh8"))).toBe(true);
  expect(await readTopologyRecord("mesh1")).toBeUndefined();
  expect(await readTopologyRecord("mesh0")).toBeDefined();
  expect(database.stores.get("records")?.size).toBe(8);
});

it("caps per-record and total bytes without allocating giant payloads", async () => {
  expect(await writeTopologyRecord(record("oversize", 128 * MIB + 1))).toBe(
    false,
  );
  expect(database.opens).toHaveLength(0);
  expect(await writeTopologyRecord(record("a", 128 * MIB))).toBe(true);
  vi.setSystemTime(Date.now() + 1);
  expect(await writeTopologyRecord(record("b", 128 * MIB))).toBe(true);
  vi.setSystemTime(Date.now() + 1);
  expect(await writeTopologyRecord(record("c", MIB))).toBe(true);
  expect(await readTopologyRecord("a")).toBeUndefined();
  expect(await readTopologyRecord("b")).toBeDefined();
});

it("removes expired and structurally corrupt entries from both stores", async () => {
  expect(await writeTopologyRecord(record("expired"))).toBe(true);
  vi.setSystemTime(Date.now() + 30 * DAY);
  database.requests = [];
  expect(await readTopologyRecord("expired")).toBeUndefined();
  expect(
    database.requests.filter(
      (request) => request.store === "records" && request.operation === "get",
    ),
  ).toHaveLength(0);
  expect(database.stores.get("records")?.has("expired")).toBe(false);
  expect(database.stores.get("metadata")?.has("expired")).toBe(false);
  expect(await writeTopologyRecord(record("corrupt"))).toBe(true);
  database.stores
    .get("records")!
    .set("corrupt", { ...record("corrupt"), bytes: NaN });
  expect(await readTopologyRecord("corrupt")).toBeUndefined();
  expect(database.stores.get("metadata")?.has("corrupt")).toBe(false);
});

it("evicts expired entries on writes and accounts replacement bytes once", async () => {
  expect(await writeTopologyRecord(record("old"))).toBe(true);
  vi.setSystemTime(Date.now() + 30 * DAY);
  expect(await writeTopologyRecord(record("new", 128 * MIB))).toBe(true);
  expect(database.stores.get("records")?.has("old")).toBe(false);
  expect(await writeTopologyRecord(record("new", 128 * MIB))).toBe(true);
  expect(await writeTopologyRecord(record("other", 128 * MIB))).toBe(true);
  expect(await readTopologyRecord("new")).toBeDefined();
});

it("degrades to misses and false for unavailable storage and preserves prior data on quota abort", async () => {
  database.mode = "unavailable";
  expect(await readTopologyRecord("a")).toBeUndefined();
  expect(await writeTopologyRecord(record("a"))).toBe(false);
  await expect(deleteTopologyRecord("a")).resolves.toBeUndefined();
  database.mode = "normal";
  const original = record("a");
  expect(await writeTopologyRecord(original)).toBe(true);
  database.mode = "quota";
  expect(
    await writeTopologyRecord({ ...original, checksum: "replacement" }),
  ).toBe(false);
  database.mode = "normal";
  expect(await readTopologyRecord("a")).toEqual(original);
});

it("bounds stalled opens, closes late success, and closes on version changes", async () => {
  database.mode = "stalled-open";
  const pending = readTopologyRecord("a");
  await vi.advanceTimersByTimeAsync(3100);
  expect(await pending).toBeUndefined();
  database.pendingOpen?.();
  expect(database.connections[0].close).toHaveBeenCalledOnce();
  database.mode = "normal";
  await readTopologyRecord("a");
  database.connections[1].onversionchange?.();
  expect(database.connections[1].close).toHaveBeenCalled();
});

it("fails closed on blocked opens and aborts stalled transactions before closing", async () => {
  database.mode = "blocked";
  expect(await readTopologyRecord("a")).toBeUndefined();
  database.pendingOpen?.();
  expect(database.connections[0].close).toHaveBeenCalledOnce();
  database.mode = "stalled-transaction";
  const pending = writeTopologyRecord(record("a"));
  await vi.advanceTimersByTimeAsync(3100);
  expect(await pending).toBe(false);
  expect(database.aborted).toBe(1);
  expect(database.connections[1].close).toHaveBeenCalledOnce();
});

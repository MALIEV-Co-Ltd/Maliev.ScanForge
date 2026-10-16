/** Disposable derived geometry only; never shares stores with project recovery data. */
export interface TopologyCacheRecord {
  key: string;
  sourceLength: number;
  tolerance: number;
  payload: unknown;
  checksum: string;
  bytes: number;
  createdAt: number;
}

interface CacheMetadata {
  key: string;
  bytes: number;
  createdAt: number;
  lastUsed: number;
}

const DATABASE = "scanforge-topology-cache";
const RECORDS = "records";
const METADATA = "metadata";
const MAX_RECORD_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 8;
const MAX_AGE = 30 * 86_400_000;
const DEADLINE = 3000;

function validKey(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && key.length <= 1024;
}
function validBytes(bytes: unknown): bytes is number {
  return (
    typeof bytes === "number" &&
    Number.isSafeInteger(bytes) &&
    bytes > 0 &&
    bytes <= MAX_RECORD_BYTES
  );
}
function validTime(value: unknown, now: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= now
  );
}
function validRecord(
  value: unknown,
  now: number,
): value is TopologyCacheRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as TopologyCacheRecord;
  return (
    validKey(record.key) &&
    validBytes(record.bytes) &&
    Number.isSafeInteger(record.sourceLength) &&
    record.sourceLength >= 0 &&
    Number.isFinite(record.tolerance) &&
    record.tolerance > 0 &&
    typeof record.checksum === "string" &&
    record.checksum.length > 0 &&
    record.checksum.length <= 256 &&
    validTime(record.createdAt, now) &&
    now - record.createdAt < MAX_AGE
  );
}
function validMetadata(value: unknown, now: number): value is CacheMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as CacheMetadata;
  return (
    validKey(metadata.key) &&
    validBytes(metadata.bytes) &&
    validTime(metadata.createdAt, now) &&
    now - metadata.createdAt < MAX_AGE &&
    validTime(metadata.lastUsed, now) &&
    metadata.lastUsed >= metadata.createdAt
  );
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const fail = () => {
      expired = true;
      clearTimeout(timer);
      reject(new Error("Topology cache unavailable."));
    };
    const timer = setTimeout(fail, DEADLINE);
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (expired) {
          request.transaction?.abort();
          return;
        }
        for (const name of [RECORDS, METADATA]) {
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        if (expired) db.close();
        else {
          db.onversionchange = () => db.close();
          resolve(db);
        }
      };
      request.onerror = fail;
      request.onblocked = fail;
    } catch {
      fail();
    }
  });
}

/** Keep requests in IDB callbacks so the transaction stays active across browsers. */
async function transact<T>(
  fallback: T,
  operation: (transaction: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    return await new Promise<T>((resolve) => {
      const transaction = db!.transaction([RECORDS, METADATA], "readwrite");
      let value = fallback;
      let settled = false;
      const finish = (result: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const fail = () => {
        try {
          transaction.abort();
        } catch {
          /* Already completed or aborted. */
        }
        finish(fallback);
      };
      const timer = setTimeout(fail, DEADLINE);
      transaction.oncomplete = () => finish(value);
      transaction.onabort = () => finish(fallback);
      transaction.onerror = fail;
      try {
        operation(transaction, (result) => {
          value = result;
        });
      } catch {
        fail();
      }
    });
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}

function onSuccess<T>(
  request: IDBRequest<T>,
  transaction: IDBTransaction,
  operation: () => void,
): void {
  request.onsuccess = () => {
    try {
      operation();
    } catch {
      try {
        transaction.abort();
      } catch {
        /* Deadline still bounds an inactive transaction. */
      }
    }
  };
}

export async function readTopologyRecord(
  key: string,
): Promise<TopologyCacheRecord | undefined> {
  if (!validKey(key)) return undefined;
  return transact<TopologyCacheRecord | undefined>(
    undefined,
    (transaction, result) => {
      const records = transaction.objectStore(RECORDS);
      const metadata = transaction.objectStore(METADATA);
      const metadataRequest = metadata.get(key);
      onSuccess(metadataRequest, transaction, () => {
        const entry: unknown = metadataRequest.result;
        const now = Date.now();
        const remove = () => {
          records.delete(key);
          metadata.delete(key);
        };
        if (!validMetadata(entry, now) || entry.key !== key) {
          remove();
          return;
        }
        const recordRequest = records.get(key);
        onSuccess(recordRequest, transaction, () => {
          const record: unknown = recordRequest.result;
          const readTime = Date.now();
          if (
            !validRecord(record, readTime) ||
            record.key !== key ||
            record.bytes !== entry.bytes ||
            record.createdAt !== entry.createdAt
          ) {
            remove();
            return;
          }
          metadata.put({ ...entry, lastUsed: readTime });
          result(record);
        });
      });
    },
  );
}

export async function writeTopologyRecord(
  record: TopologyCacheRecord,
): Promise<boolean> {
  if (!validRecord(record, Date.now())) return false;
  return transact(false, (transaction, result) => {
    const records = transaction.objectStore(RECORDS);
    const metadata = transaction.objectStore(METADATA);
    const entriesRequest = metadata.getAll();
    onSuccess(entriesRequest, transaction, () => {
      const now = Date.now();
      const entries: CacheMetadata[] = [];
      const remove = (key: string) => {
        records.delete(key);
        metadata.delete(key);
      };
      for (const value of entriesRequest.result as unknown[]) {
        if (!validMetadata(value, now)) {
          if (
            value &&
            typeof value === "object" &&
            "key" in value &&
            validKey(value.key)
          )
            remove(value.key);
        } else if (value.key !== record.key) entries.push(value);
      }
      entries.sort(
        (left, right) =>
          left.lastUsed - right.lastUsed ||
          left.createdAt - right.createdAt ||
          left.key.localeCompare(right.key),
      );
      let totalBytes = entries.reduce(
        (total, entry) => total + entry.bytes,
        record.bytes,
      );
      while (entries.length >= MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
        const evicted = entries.shift()!;
        totalBytes -= evicted.bytes;
        remove(evicted.key);
      }
      records.put(record);
      metadata.put({
        key: record.key,
        bytes: record.bytes,
        createdAt: record.createdAt,
        lastUsed: now,
      } satisfies CacheMetadata);
      result(true);
    });
  });
}

export async function deleteTopologyRecord(key: string): Promise<void> {
  if (!validKey(key)) return;
  await transact(undefined, (transaction) => {
    transaction.objectStore(RECORDS).delete(key);
    transaction.objectStore(METADATA).delete(key);
  });
}

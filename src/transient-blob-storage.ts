export const DISK_BLOB_BLOCK_BYTES = 64 * 1024 * 1024;

async function openTransientDatabase(
  signal?: AbortSignal,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown, value?: IDBDatabase) => {
      if (finished) {
        value?.close();
        return;
      }
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(value!);
    };
    const cancel = () =>
      finish(
        signal?.reason ?? new DOMException("Storage cancelled", "AbortError"),
      );
    const timer = setTimeout(
      () => finish(new Error("Temporary blob storage timed out.")),
      30_000,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const request = indexedDB.open("scanforge-transient-blobs", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("blobs");
      request.onsuccess = () => finish(undefined, request.result);
      request.onerror = () =>
        finish(request.error ?? new Error("Temporary blob storage failed."));
      request.onblocked = () =>
        finish(new Error("Temporary blob storage is blocked."));
    } catch (error) {
      finish(error);
    }
  });
}

/** Remove one terminated worker's staging record without touching other saves. */
export async function deleteTransientBlob(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openTransientDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("blobs", "readwrite");
      const timer = setTimeout(() => {
        try {
          tx.abort();
        } catch {
          /* Already settled. */
        }
        reject(new Error("Temporary blob cleanup timed out."));
      }, 30_000);
      tx.oncomplete = () => {
        clearTimeout(timer);
        resolve();
      };
      tx.onerror = tx.onabort = () => {
        clearTimeout(timer);
        reject(tx.error ?? new Error("Temporary blob cleanup failed."));
      };
      try {
        tx.objectStore("blobs").delete(key);
      } catch (error) {
        clearTimeout(timer);
        try {
          tx.abort();
        } catch {
          /* Already settled. */
        }
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}

/** Deleting the database record leaves the returned browser-owned Blob alive. */
export async function diskBackedBlob(
  blob: Blob,
  signal?: AbortSignal,
  temporaryKey?: string,
): Promise<Blob> {
  signal?.throwIfAborted();
  if (blob.size < DISK_BLOB_BLOCK_BYTES || typeof indexedDB === "undefined")
    return blob;
  const db = await openTransientDatabase(signal);
  const key = temporaryKey ?? crypto.randomUUID();
  const transaction = <T>(
    run: (store: IDBObjectStore) => () => T,
    operationSignal: AbortSignal | null = signal ?? null,
  ) =>
    new Promise<T>((resolve, reject) => {
      const tx = db.transaction("blobs", "readwrite");
      let finished = false;
      const finish = (error?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        operationSignal?.removeEventListener("abort", cancel);
        if (error) {
          try {
            tx.abort();
          } catch {
            /* Already settled. */
          }
          reject(error);
        } else {
          try {
            resolve(result());
          } catch (failure) {
            reject(failure);
          }
        }
      };
      const cancel = () =>
        finish(
          operationSignal?.reason ??
            new DOMException("Storage cancelled", "AbortError"),
        );
      const timer = setTimeout(
        () => finish(new Error("Temporary blob transaction timed out.")),
        30_000,
      );
      operationSignal?.addEventListener("abort", cancel, { once: true });
      let result: () => T;
      tx.oncomplete = () => finish();
      tx.onerror = tx.onabort = () =>
        finish(tx.error ?? new Error("Temporary blob transaction failed."));
      try {
        operationSignal?.throwIfAborted();
        result = run(tx.objectStore("blobs"));
      } catch (error) {
        finish(error);
      }
    });
  let completed = false;
  try {
    await transaction((store) => {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (item.value.expires <= Date.now()) item.delete();
        item.continue();
      };
      store.put({ file: blob, expires: Date.now() + 900_000 }, key);
      return () => undefined;
    });
    const file = await transaction((store) => {
      const request = store.get(key);
      store.delete(key);
      return () => {
        const file = request.result?.file;
        if (!(file instanceof Blob) || file.size !== blob.size)
          throw new Error("Temporary blob storage returned invalid bytes.");
        return file;
      };
    });
    completed = true;
    return file;
  } finally {
    if (!completed) {
      try {
        await transaction((store) => {
          store.delete(key);
          return () => undefined;
        }, null);
      } catch {
        // The expiry sweep remains a fallback if storage is unavailable.
      }
    }
    db.close();
  }
}

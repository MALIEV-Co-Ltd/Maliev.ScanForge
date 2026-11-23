export interface Backup {
  id: string;
  name: string;
  savedAt: number;
  file: Blob;
  thumbnail?: Blob;
}
/** IndexedDB transactions retain the previous successful backup atomically. */
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error("Backup database did not open in time."));
    }, 5000);
    const request = indexedDB.open("scanforge-project-backups", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("backups", { keyPath: "id" });
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
    request.onblocked = () => {
      clearTimeout(timer);
      expired = true;
      reject(new Error("Backup database is blocked by another browser tab."));
    };
  });
}
export async function listBackups(): Promise<Backup[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("backups", "readonly");
      const request = transaction.objectStore("backups").getAll();
      transaction.oncomplete = () =>
        resolve(
          (request.result as Backup[]).sort((a, b) => b.savedAt - a.savedAt),
        );
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
export async function writeBackup(backup: Backup): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("backups", "readwrite"),
        store = transaction.objectStore("backups");
      store.put(backup);
      store.delete(`${backup.id}:previous`);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export function backupProjectId(id: string): string {
  return id.replace(/:previous$/, "");
}

/** Delete the project and its legacy previous snapshot together. */
export async function removeBackup(id: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("backups", "readwrite");
      const store = transaction.objectStore("backups");
      store.delete(backupProjectId(id));
      store.delete(`${backupProjectId(id)}:previous`);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const BACKUP_INTERVAL_MS = 30_000;

/** Interval writer: edits only update the pending state; deletes serialize after writes. */
export class IntervalBackupController<T> {
  private current?: {
    id: string;
    value: T;
    key: readonly unknown[];
    enabled: boolean;
  };
  private saved = new Map<string, readonly unknown[]>();
  // Change detection must not own the geometry/history it compares.
  private identities = new WeakMap<object, symbol>();
  private identity(value: unknown): unknown {
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function")
    ) {
      let token = this.identities.get(value);
      if (!token) {
        token = Symbol();
        this.identities.set(value, token);
      }
      return token;
    }
    return value;
  }
  private deleted = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  private writing = false;
  private stopped = false;
  constructor(
    private save: (
      id: string,
      value: T,
      allowed: () => boolean,
    ) => Promise<void | false>,
    private remove: (id: string) => Promise<void>,
    private failed: (error: unknown) => void,
  ) {}
  update(
    id: string,
    value: T,
    key: readonly unknown[],
    enabled: boolean,
  ): void {
    if (this.stopped) return;
    this.current = { id, value, key, enabled };
  }
  tick(): Promise<void> {
    const snapshot = this.current;
    if (
      this.stopped ||
      this.writing ||
      !snapshot?.enabled ||
      this.deleted.has(snapshot.id)
    )
      return this.tail;
    const saved = this.saved.get(snapshot.id);
    if (
      saved &&
      saved.length === snapshot.key.length &&
      saved.every((item, i) => item === this.identity(snapshot.key[i]))
    )
      return this.tail;
    this.writing = true;
    const allowed = () => !this.stopped && !this.deleted.has(snapshot.id);
    this.tail = this.tail.then(async () => {
      try {
        if (allowed()) {
          const saved = await this.save(snapshot.id, snapshot.value, allowed);
          if (saved !== false && allowed())
            this.saved.set(
              snapshot.id,
              snapshot.key.map((item) => this.identity(item)),
            );
        }
      } catch (error) {
        this.failed(error);
      } finally {
        this.writing = false;
      }
    });
    return this.tail;
  }
  delete(id: string): Promise<void> {
    id = backupProjectId(id);
    this.deleted.add(id);
    const operation = this.tail.then(() => this.remove(id));
    this.tail = operation.catch((error) => {
      this.deleted.delete(id);
      this.failed(error);
    });
    return operation;
  }
  stop(): void {
    this.stopped = true;
    this.current = undefined;
    this.saved.clear();
  }
}

/** One writer per tab; pending edits supersede queued snapshots, never an active write. */
export class BackupQueue<T> {
  private pending?: T;
  private running = false;
  private stopped = false;
  constructor(
    private save: (value: T) => Promise<void>,
    private failed: (error: unknown) => void,
  ) {}
  enqueue(value: T): void {
    if (this.stopped) return;
    this.pending = value;
    if (!this.running) void this.drain();
  }
  stop(): void {
    this.stopped = true;
    this.pending = undefined;
  }
  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (!this.stopped && this.pending !== undefined) {
        const value = this.pending;
        this.pending = undefined;
        try {
          await this.save(value);
        } catch (error) {
          this.failed(error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export interface Backup {
  id: string;
  name: string;
  savedAt: number;
  file: Blob;
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
      const previous = store.get(backup.id);
      previous.onsuccess = () => {
        if (previous.result)
          store.put({ ...previous.result, id: `${backup.id}:previous` });
        store.put(backup);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
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

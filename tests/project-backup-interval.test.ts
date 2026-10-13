import { expect, it, vi } from "vitest";
import {
  BACKUP_INTERVAL_MS,
  IntervalBackupController,
  backupProjectId,
} from "../src/project-backup";

it("coalesces edits until the interval and skips unchanged or busy projects", async () => {
  vi.useFakeTimers();
  const saved: [string, number][] = [];
  const writer = new IntervalBackupController<number>(
    async (id, value) => {
      saved.push([id, value]);
    },
    async () => {},
    () => {},
  );
  const timer = setInterval(() => void writer.tick(), BACKUP_INTERVAL_MS);
  try {
    for (let i = 1; i <= 100; i++) writer.update("project", i, [i], true);
    await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL_MS - 1);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual([["project", 100]]);
    await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL_MS);
    expect(saved).toHaveLength(1);
    writer.update("project", 101, [101], false);
    await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL_MS);
    expect(saved).toHaveLength(1);
    writer.update("project", 101, [101], true);
    await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL_MS);
    expect(saved).toEqual([
      ["project", 100],
      ["project", 101],
    ]);
  } finally {
    clearInterval(timer);
    writer.stop();
    vi.useRealTimers();
  }
});

it("continues a recovered previous snapshot using its existing project identity", async () => {
  const saved: string[] = [];
  const writer = new IntervalBackupController<number>(
    async (id) => {
      saved.push(id);
    },
    async () => {},
    () => {},
  );
  writer.update(backupProjectId("original:previous"), 1, [1], true);
  await writer.tick();
  writer.update("original", 2, [2], true);
  await writer.tick();
  writer.update("new-project", 3, [3], true);
  await writer.tick();
  expect(saved).toEqual(["original", "original", "new-project"]);
});

it("serializes deletion after an active write and never resurrects a deleted project", async () => {
  const events: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = new IntervalBackupController<number>(
    async (_id, _value, allowed) => {
      events.push("encoding");
      await blocked;
      if (allowed()) events.push("saved");
    },
    async (id) => {
      events.push(`deleted:${id}`);
    },
    () => {},
  );
  writer.update("original", 1, [1], true);
  const saving = writer.tick();
  await Promise.resolve();
  const deleting = writer.delete("original:previous");
  release();
  await Promise.all([saving, deleting]);
  writer.update("original", 2, [2], true);
  await writer.tick();
  expect(events).toEqual(["encoding", "deleted:original"]);
});

it("retries failed saves and failed deletions without losing the active document", async () => {
  const failures: unknown[] = [];
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("Quota"))
    .mockResolvedValue(undefined);
  const remove = vi.fn().mockRejectedValueOnce(new Error("Storage"));
  const writer = new IntervalBackupController<number>(save, remove, (error) =>
    failures.push(error),
  );
  writer.update("project", 1, [1], true);
  await writer.tick();
  await writer.tick();
  expect(save).toHaveBeenCalledTimes(2);
  await expect(writer.delete("project")).rejects.toThrow("Storage");
  await Promise.resolve();
  writer.update("project", 2, [2], true);
  await writer.tick();
  expect(save).toHaveBeenCalledTimes(3);
  expect(failures).toHaveLength(2);
  writer.stop();
  writer.update("project", 3, [3], true);
  await writer.tick();
  expect(save).toHaveBeenCalledTimes(3);
});

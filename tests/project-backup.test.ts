import { expect, it } from "vitest";
import { BackupQueue } from "../src/project-backup";
it("serializes writes and replaces pending snapshots with the latest revision", async () => {
  const written: number[] = [];
  let finish!: () => void;
  const first = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const queue = new BackupQueue<number>(
    async (value) => {
      written.push(value);
      if (value === 1) await first;
    },
    () => {},
  );
  queue.enqueue(1);
  queue.enqueue(2);
  queue.enqueue(3);
  expect(written).toEqual([1]);
  finish();
  await first;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(written).toEqual([1, 3]);
  queue.stop();
});
it("reports failures and continues backing up subsequent edits", async () => {
  const errors: unknown[] = [],
    written: number[] = [];
  const queue = new BackupQueue<number>(
    async (value) => {
      if (value === 1) throw new Error("Quota exceeded");
      written.push(value);
    },
    (error) => errors.push(error),
  );
  queue.enqueue(1);
  queue.enqueue(2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(errors).toHaveLength(1);
  expect(written).toEqual([2]);
  queue.stop();
  queue.enqueue(3);
  expect(written).toEqual([2]);
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeAutomaticProjectBackup } from "../src/automatic-project-backup";
import { writeBackup, IntervalBackupController } from "../src/project-backup";
import { encodeProjectInBackground } from "../src/project-encoding-client";
import type { ProjectSession } from "../src/project-file";
import {
  beginPriorityScanPreparation,
  hasPriorityScanPreparation,
  prepareMeshInBackground,
} from "../src/scan-background-preparation";

vi.mock("../src/project-backup", async (original) => ({
  ...(await original<typeof import("../src/project-backup")>()),
  writeBackup: vi.fn(),
}));
class Encoder {
  static instances: Encoder[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    Encoder.instances.push(this);
  }
  complete() {
    this.onmessage!({ data: { file: new Blob(["backup"]) } });
  }
}
const session = {
  project: { name: "original", entities: [] },
  history: [],
  future: [],
} as unknown as ProjectSession;
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", {});
  vi.stubGlobal("Worker", Encoder);
  vi.mocked(writeBackup).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Encoder.instances = [];
  expect(hasPriorityScanPreparation()).toBe(false);
});

it("omits an unresolved thumbnail after five seconds and completes the backup without external cancellation", async () => {
  const cleanup = new AbortController();
  const saving = writeAutomaticProjectBackup(
    "project",
    session,
    () => true,
    () => new Promise<Blob>(() => {}),
    cleanup.signal,
  );
  try {
    await flush();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(Encoder.instances).toHaveLength(0);
    expect(hasPriorityScanPreparation()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(Encoder.instances).toHaveLength(1);
    // Only the existing encoder lease remains after the thumbnail deadline.
    expect(vi.getTimerCount()).toBe(1);
    Encoder.instances[0].complete();
    await saving;
    expect(writeBackup).toHaveBeenCalledOnce();
    expect(vi.mocked(writeBackup).mock.calls[0][0]).not.toHaveProperty(
      "thumbnail",
    );
    expect(hasPriorityScanPreparation()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    cleanup.abort();
    await saving;
  }
});

it("skips priority work before thumbnails and does not mark a deferred key saved", async () => {
  const thumbnail = vi.fn();
  const release = beginPriorityScanPreparation();
  const writer = new IntervalBackupController<ProjectSession>(
    (id, value, allowed) =>
      writeAutomaticProjectBackup(id, value, allowed, thumbnail),
    async () => {},
    vi.fn(),
  );
  writer.update("project", session, [session], true);
  await writer.tick();
  expect(thumbnail).not.toHaveBeenCalled();
  expect(Encoder.instances).toHaveLength(0);
  release();
  const saving = writer.tick();
  await flush();
  expect(Encoder.instances).toHaveLength(1);
  Encoder.instances[0].complete();
  await saving;
  expect(writeBackup).toHaveBeenCalledOnce();
});

it("holds speculation behind its own lease without self cancellation, and yields to incoming priority", async () => {
  const observe = vi.fn();
  const saving = writeAutomaticProjectBackup("project", session, () => true);
  const stop = prepareMeshInBackground(new Float32Array(9), { observe });
  await flush();
  await vi.advanceTimersByTimeAsync(250);
  expect(observe).not.toHaveBeenCalled();
  expect(Encoder.instances).toHaveLength(1);
  expect(Encoder.instances[0].terminate).not.toHaveBeenCalled();
  const release = beginPriorityScanPreparation();
  expect(await saving).toBe(false);
  expect(Encoder.instances[0].terminate).toHaveBeenCalledOnce();
  expect(writeBackup).not.toHaveBeenCalled();
  release();
  await vi.advanceTimersByTimeAsync(250);
  expect(observe).toHaveBeenCalledOnce();
  stop();
});

it("abandons an unresolved thumbnail on priority and removes the subscription", async () => {
  let finish!: (value: Blob) => void;
  const thumbnail = vi.fn(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  const saving = writeAutomaticProjectBackup(
    "project",
    session,
    () => true,
    thumbnail,
  );
  await flush();
  const release = beginPriorityScanPreparation();
  expect(await saving).toBe(false);
  release();
  finish(new Blob());
  await flush();
  expect(Encoder.instances).toHaveLength(0);
  expect(writeBackup).not.toHaveBeenCalled();
});

it("subscribes before invoking the thumbnail callback", async () => {
  let release!: () => void;
  const saving = writeAutomaticProjectBackup(
    "project",
    session,
    () => true,
    async () => {
      release = beginPriorityScanPreparation();
      return new Blob();
    },
  );
  expect(await saving).toBe(false);
  release();
  expect(Encoder.instances).toHaveLength(0);
});

it("retries the latest session on the next interval after preemption", async () => {
  const failed = vi.fn();
  const writer = new IntervalBackupController<ProjectSession>(
    (id, value, allowed) => writeAutomaticProjectBackup(id, value, allowed),
    async () => {},
    failed,
  );
  writer.update("project", session, [session], true);
  const first = writer.tick();
  await flush();
  const release = beginPriorityScanPreparation();
  await first;
  const latest = {
    ...session,
    project: { ...session.project, name: "latest" },
  };
  writer.update("project", latest, [latest], true);
  release();
  const second = writer.tick();
  await flush();
  expect(Encoder.instances).toHaveLength(2);
  expect(
    Encoder.instances[1].postMessage.mock.calls[0][0].session.project.name,
  ).toBe("latest");
  Encoder.instances[1].complete();
  await second;
  await writer.tick();
  expect(writeBackup).toHaveBeenCalledOnce();
  expect(writeBackup).toHaveBeenCalledWith(
    expect.objectContaining({ name: "latest" }),
  );
  expect(failed).not.toHaveBeenCalled();
});

it("cancels a queued automatic encoder without cancelling an explicit export", async () => {
  const explicit = encodeProjectInBackground(session);
  const automatic = writeAutomaticProjectBackup("project", session, () => true);
  await flush();
  const release = beginPriorityScanPreparation();
  expect(Encoder.instances[0].terminate).not.toHaveBeenCalled();
  Encoder.instances[0].complete();
  await explicit;
  expect(await automatic).toBe(false);
  expect(Encoder.instances).toHaveLength(1);
  release();
});

it.each(["unmount", "delete"])(
  "cancels active automatic encoding on %s and preserves the previous backup",
  async () => {
    const cancel = new AbortController();
    const saving = writeAutomaticProjectBackup(
      "project",
      session,
      () => true,
      undefined,
      cancel.signal,
    );
    await flush();
    cancel.abort();
    expect(await saving).toBe(false);
    expect(Encoder.instances[0].terminate).toHaveBeenCalledOnce();
    expect(writeBackup).not.toHaveBeenCalled();
  },
);

it("keeps encoder lease expiry as a real retryable failure", async () => {
  const saving = writeAutomaticProjectBackup("project", session, () => true);
  const failed = expect(saving).rejects.toThrow(/two-minute worker lease/);
  await flush();
  await vi.advanceTimersByTimeAsync(120_000);
  await failed;
  expect(writeBackup).not.toHaveBeenCalled();
});

it("ignores thumbnail failure but propagates storage failure without losing cleanup", async () => {
  vi.mocked(writeBackup).mockRejectedValueOnce(new Error("Quota"));
  const saving = writeAutomaticProjectBackup(
    "project",
    session,
    () => true,
    async () => {
      throw new Error("Thumbnail");
    },
  );
  const failed = expect(saving).rejects.toThrow("Quota");
  await flush();
  Encoder.instances[0].complete();
  await failed;
});

it("does not hide storage errors when priority arrives during an atomic write", async () => {
  let release!: () => void;
  vi.mocked(writeBackup).mockImplementationOnce(async () => {
    release = beginPriorityScanPreparation();
    throw new Error("Quota during write");
  });
  const saving = writeAutomaticProjectBackup("project", session, () => true);
  const failed = expect(saving).rejects.toThrow("Quota during write");
  await flush();
  Encoder.instances[0].complete();
  try {
    await failed;
  } finally {
    release();
  }
});

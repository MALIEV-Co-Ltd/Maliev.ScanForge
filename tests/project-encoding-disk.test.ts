import { afterEach, expect, it, vi } from "vitest";
import {
  decodeProjectContents,
  encodeProjectFileLocally,
} from "../src/project-file-codec";
import { diskBackedBlob } from "../src/transient-blob-storage";
import type { ProjectSession } from "../src/project-file";
import {
  ApplicationApi,
  type ApiResult,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";

// Exercise the batching boundary with real lossless payloads and tiny allocations.
vi.mock("../src/transient-blob-storage", () => ({
  DISK_BLOB_BLOCK_BYTES: 64,
  diskBackedBlob: vi.fn(async (file: Blob) => new Blob([file])),
}));

afterEach(() => vi.mocked(diskBackedBlob).mockClear());

function session(): ProjectSession {
  return {
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "Batched export",
      entities: Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        name: String(i),
        kind: "mesh" as const,
        positions: Float32Array.from({ length: 90 }, (_, n) => Math.sin(n + i)),
        color: "#ffffff",
        visible: true,
        opacity: 1,
      })),
    },
    history: [],
    future: [],
  };
}

it("stages completed payload batches before the full project is assembled", async () => {
  const source = session();
  source.history = [{ label: "Import", entities: source.project.entities }];
  const file = await encodeProjectFileLocally(source);
  const staged = vi.mocked(diskBackedBlob).mock.calls.map(([blob]) => blob);
  expect(staged.length).toBeGreaterThan(1);
  expect(staged.every((blob) => blob.size >= 64 && blob.size < file.size)).toBe(
    true,
  );
  const restored = await decodeProjectContents(file);
  expect(restored.project.entities.map((e) => e.positions)).toEqual(
    source.project.entities.map((e) => e.positions),
  );
  expect(restored.history[0].entities[0].positions).toBe(
    restored.project.entities[0].positions,
  );
});

it("rejects a failed checkpoint without publishing an incomplete project", async () => {
  vi.mocked(diskBackedBlob).mockRejectedValueOnce(
    new Error("Storage quota exceeded"),
  );
  await expect(encodeProjectFileLocally(session())).rejects.toThrow(
    "Storage quota exceeded",
  );
  expect(diskBackedBlob).toHaveBeenCalledTimes(1);
  // A failed save must not poison the next attempt.
  expect((await encodeProjectFileLocally(session())).size).toBeGreaterThan(16);
});

it("exposes the same checkpointed lossless export through the public MCP operation", async () => {
  const source = session();
  source.history = [{ label: "Import", entities: source.project.entities }];
  const state: WorkspaceSnapshot = {
    projectId: "checkpoint-project",
    name: source.project.name,
    entities: source.project.entities,
    history: source.history,
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  const host = {
    snapshot: () => state,
    busy: () => false,
    activity: vi.fn(),
  } as unknown as WorkspaceHost;
  const api = new ApplicationApi(host, createOperations(host));
  function result<T>(wire: ApiResult): T {
    if (!wire.ok) throw new Error(wire.error.message);
    return wire.result as T;
  }
  try {
    const { jobId } = result<{ jobId: string }>(
      await api.invoke("project_export", { format: "project" }),
    );
    let artifactId = "";
    await vi.waitFor(async () => {
      const job = result<{ status: string; result?: { artifactId: string } }>(
        await api.invoke("job_get", { jobId }),
      );
      expect(job.status).toBe("succeeded");
      artifactId = job.result!.artifactId;
    });
    expect(diskBackedBlob).toHaveBeenCalled();
    const wire = result<{ base64: string }>(
      await api.invoke("artifact_read", { artifactId }),
    );
    const restored = await decodeProjectContents(
      new Blob([Uint8Array.from(Buffer.from(wire.base64, "base64"))]),
    );
    expect(restored.projectId).toBe(state.projectId);
    expect(restored.project.entities.map((e) => e.positions)).toEqual(
      source.project.entities.map((e) => e.positions),
    );
    expect(restored.history[0].label).toBe("Import");
  } finally {
    api.dispose();
  }
});

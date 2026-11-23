import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { listBackups } from "../src/project-backup";
import { encodeProjectFile } from "../src/project-file";
vi.mock("../src/project-backup", async (original) => ({
  ...(await original<typeof import("../src/project-backup")>()),
  listBackups: vi.fn(),
}));
vi.mock("../src/cad/client", () => ({
  CadClient: class {
    dispose() {}
  },
}));
function setup() {
  const state: WorkspaceSnapshot = {
    projectId: "existing",
    name: "Open",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: vi.fn(),
    commit: vi.fn(),
    replace: vi.fn((project, _cad, session) => {
      Object.assign(state, {
        name: project.name,
        entities: project.entities,
        projectId: session?.projectId,
        history: session?.history,
        future: session?.future,
      });
    }),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    present: vi.fn(async () => {}),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
    deleteBackup: vi.fn(async () => {}),
  };
  const api = new ApplicationApi(host, createOperations(host));
  return { host, state, api };
}
it("exposes backup metadata, interval policy and downloadable thumbnail artifacts", async () => {
  const { api } = setup();
  vi.mocked(listBackups).mockResolvedValue([
    {
      id: "existing",
      name: "Bracket",
      savedAt: 1,
      file: new Blob(["project"]),
      thumbnail: new Blob(["preview"], { type: "image/webp" }),
    },
  ]);
  try {
    const result = await api.invoke("backup_list", { includeThumbnails: true });
    expect(result).toMatchObject({
      ok: true,
      result: {
        intervalMs: 30000,
        changedProjectsOnly: true,
        projectId: "existing",
        backups: [
          {
            id: "existing",
            bytes: 7,
            thumbnail: { mime: "image/webp", bytes: 7 },
          },
        ],
      },
    });
  } finally {
    api.dispose();
  }
});
it("guards deletion by revision and request receipt while retaining the open model", async () => {
  const { api, host, state } = setup();
  vi.mocked(listBackups).mockResolvedValue([
    { id: "existing:previous", name: "Bracket", savedAt: 1, file: new Blob() },
  ]);
  try {
    expect(
      (
        await api.invoke("backup_delete", {
          backupId: "existing:previous",
          expectedRevision: 99,
          requestId: "wrong",
        })
      ).ok,
    ).toBe(false);
    expect(host.deleteBackup).not.toHaveBeenCalled();
    const args = {
      backupId: "existing:previous",
      expectedRevision: api.currentRevision(),
      requestId: "delete",
    };
    const first = await api.invoke("backup_delete", args);
    expect(first).toMatchObject({
      ok: true,
      result: { deletedProjectId: "existing", automaticBackupsPaused: true },
    });
    expect(await api.invoke("backup_delete", args)).toEqual(first);
    expect(host.deleteBackup).toHaveBeenCalledTimes(1);
    expect(state.name).toBe("Open");
  } finally {
    api.dispose();
  }
});
it("restores complete backup history through the shared import operation and keeps its identity", async () => {
  const { api, host, state } = setup();
  const file = await encodeProjectFile({
    projectId: "unrelated-file-identity",
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "Recovered",
      entities: [],
    },
    history: [{ label: "Earlier", entities: [] }],
    future: [{ label: "Redo", entities: [] }],
  });
  vi.mocked(listBackups).mockResolvedValue([
    { id: "existing:previous", name: "Recovered", savedAt: 1, file },
  ]);
  try {
    const refusal = await api.invoke("backup_restore", {
      backupId: "existing:previous",
      replace: false,
      expectedRevision: api.currentRevision(),
      requestId: "refuse",
    });
    expect(refusal.ok).toBe(false);
    expect(host.replace).not.toHaveBeenCalled();
    const started = await api.invoke("backup_restore", {
      backupId: "existing:previous",
      replace: true,
      expectedRevision: api.currentRevision(),
      requestId: "restore",
    });
    expect(started.ok).toBe(true);
    await vi.waitFor(() => expect(host.replace).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(host.view).toHaveBeenCalledWith("fit"));
    expect(host.present).toHaveBeenCalledTimes(1);
    expect(vi.mocked(host.view).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(host.replace).mock.invocationCallOrder[0],
    );
    expect(state).toMatchObject({
      projectId: "existing",
      name: "Recovered",
      history: [{ label: "Earlier" }],
      future: [{ label: "Redo" }],
    });
  } finally {
    api.dispose();
  }
});

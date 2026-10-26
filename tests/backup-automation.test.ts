import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { listBackups } from "../src/project-backup";
import { encodeProjectFile } from "../src/project-file";
import type { Entity } from "../src/types";
const { importBrep } = vi.hoisted(() => ({ importBrep: vi.fn() }));
vi.mock("../src/project-backup", async (original) => ({
  ...(await original<typeof import("../src/project-backup")>()),
  listBackups: vi.fn(),
}));
vi.mock("../src/cad/client", () => ({
  CadClient: class {
    importFile = importBrep;
    dispose() {}
  },
}));
it.each(["project_import", "backup_restore"])(
  "%s refreshes CAD handles without replacing saved geometry or BREP in any history state",
  async (operation) => {
    const { api, state } = setup();
    const saved: Entity = {
      id: "saved-cad",
      name: "Native fitted solid",
      kind: "cad",
      positions: [0.12345678901234567, 0, 0, 1, 0, 0, 0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      edgePositions: [0.12345678901234567, 0, 0, 1, 0, 0],
      brep: "SAVED BREP",
      kernelId: "retired",
      color: "#ffffff",
      visible: true,
      opacity: 1,
    };
    importBrep.mockReset().mockResolvedValue({
      kernelId: "fresh",
      positions: [0.123456789012345, 0, 0, 1, 0, 0, 0, 1, 0],
      normals: Array(9).fill(0),
      edgePositions: [],
      brep: "RESERIALIZED BREP",
    });
    const file = await encodeProjectFile({
      project: {
        format: "maliev-scanforge",
        version: 1,
        units: "mm",
        name: "Saved",
        entities: [saved],
      },
      history: [{ label: "Earlier", entities: [saved] }],
      future: [{ label: "Redo", entities: [saved] }],
    });
    vi.mocked(listBackups).mockResolvedValue([
      { id: "existing", name: "Saved", savedAt: 1, file },
    ]);
    try {
      let args: Record<string, unknown> = { backupId: "existing" };
      if (operation === "project_import") {
        const uploaded = await api.invoke("artifact_put", {
          name: "saved.scanforge",
          offset: 0,
          base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
        });
        expect(uploaded.ok).toBe(true);
        if (!uploaded.ok) throw Error("Project fixture upload failed");
        args = {
          artifactId: (uploaded.result as { artifactId: string }).artifactId,
        };
      }
      const started = await api.invoke(operation, {
        ...args,
        replace: true,
        expectedRevision: api.currentRevision(),
        requestId: "saved-cad-restore",
      });
      expect(started.ok).toBe(true);
      await vi.waitFor(() => expect(state.entities).toHaveLength(1));
      for (const restored of [
        state.entities[0],
        state.history[0].entities[0],
        state.future[0].entities[0],
      ]) {
        expect(Array.from(restored.positions)).toEqual(saved.positions);
        expect(Array.from(restored.normals!)).toEqual(saved.normals);
        expect(Array.from(restored.edgePositions!)).toEqual(
          saved.edgePositions,
        );
        expect(restored.brep).toBe(saved.brep);
        expect(restored.kernelId).toBe("fresh");
      }
      expect(importBrep).toHaveBeenCalledTimes(1);
    } finally {
      api.dispose();
    }
  },
);
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

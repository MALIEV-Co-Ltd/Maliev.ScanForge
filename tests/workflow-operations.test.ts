import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createWorkflowOperations } from "../src/automation/workflow-operations";
import { VisualCaptureError } from "../src/automation/visual-capture";
import { CommandRepeat } from "../src/command-repeat";
import { coordinateAlignmentInterface } from "../src/automation/workflow-operations";

it("previews landmarks as a retry-protected cancellable job and accepts through the shared host", async () => {
  const { api, host, mutate, state } = setup();
  host.previewLandmarks = vi.fn(async (options) => {
    options.check?.();
    options.onProgress?.(0.5, "Refining landmarks");
    return {
      active: true,
      preview: true,
      diagnostics: { logicalLanes: options.workerCount },
    };
  });
  host.acceptLandmarks = vi.fn(() => ({ active: false, accepted: true }));
  try {
    const request = {
      expectedRevision: api.currentRevision(),
      requestId: "landmark-preview",
      workerCount: 4,
      parallel: false,
    };
    const launched = await api.invoke("landmark_preview", request);
    expect(launched.ok).toBe(true);
    expect(await api.invoke("landmark_preview", request)).toEqual(launched);
    if (!launched.ok) throw new Error("Preview launch failed");
    const jobId = (launched.result as { jobId: string }).jobId;
    for (let i = 0; i < 20; i++) {
      const result = await api.invoke("job_get", { jobId });
      if (
        result.ok &&
        (result.result as { status: string }).status === "succeeded"
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(await api.invoke("job_get", { jobId })).toMatchObject({
      ok: true,
      result: {
        status: "succeeded",
        result: { preview: true, diagnostics: { logicalLanes: 4 } },
      },
    });
    expect(host.previewLandmarks).toHaveBeenCalledTimes(1);
    expect(host.previewLandmarks).toHaveBeenCalledWith(
      expect.objectContaining({
        workerCount: 4,
        parallel: false,
        signal: expect.any(AbortSignal),
        check: expect.any(Function),
      }),
    );
    expect(state.history).toHaveLength(1);
    expect(await mutate("landmark_accept")).toMatchObject({
      ok: true,
      result: { accepted: true },
    });
    expect(host.acceptLandmarks).toHaveBeenCalledTimes(1);
  } finally {
    api.dispose();
  }
});
it("cancels the owning landmark preview job when its preview is discarded", async () => {
  const { api, host, mutate, state } = setup();
  host.previewLandmarks = (options) =>
    new Promise((_resolve, reject) => {
      options.signal!.addEventListener(
        "abort",
        () => reject(options.signal!.reason),
        { once: true },
      );
    });
  host.discardPreview = vi.fn();
  try {
    const launched = await mutate("landmark_preview");
    if (!launched.ok) throw new Error("Preview launch failed");
    const jobId = (launched.result as { jobId: string }).jobId;
    expect((await mutate("preview_discard", { target: "landmarks" })).ok).toBe(
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await api.invoke("job_get", { jobId })).toMatchObject({
      ok: true,
      result: { status: "cancelled" },
    });
    expect(host.discardPreview).toHaveBeenCalledWith("landmarks");
    expect(state.history).toHaveLength(1);
  } finally {
    api.dispose();
  }
});
it("rejects a stale asynchronous landmark preview before publication", async () => {
  const { api, host, mutate, state } = setup();
  let finish!: () => void;
  let published = false;
  host.previewLandmarks = async (options) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    options.check?.();
    published = true;
    return { active: true, preview: true };
  };
  try {
    const launched = await mutate("landmark_preview");
    if (!launched.ok) throw new Error("Preview launch failed");
    state.name = "Changed during preview";
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      await api.invoke("job_get", {
        jobId: (launched.result as { jobId: string }).jobId,
      }),
    ).toMatchObject({
      ok: true,
      result: { status: "failed", error: { code: "REVISION_CONFLICT" } },
    });
    expect(published).toBe(false);
    expect(state.history).toHaveLength(1);
  } finally {
    api.dispose();
  }
});
it("reports GUI cancellation of an agent landmark preview as cancelled", async () => {
  const { api, host, mutate } = setup();
  host.previewLandmarks = async () => {
    throw new DOMException("Preview closed from GUI", "AbortError");
  };
  try {
    const launched = await mutate("landmark_preview");
    if (!launched.ok) throw new Error("Preview launch failed");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      await api.invoke("job_get", {
        jobId: (launched.result as { jobId: string }).jobId,
      }),
    ).toMatchObject({ ok: true, result: { status: "cancelled" } });
  } finally {
    api.dispose();
  }
});

it("opens coordinate alignment through MCP with the shared ribbon defaults and validates targets", async () => {
  const { api, state, mutate, ui } = setup();
  try {
    expect((await mutate("ui_set", { datumAlignmentOpen: true })).ok).toBe(
      false,
    );
    state.entities = [
      {
        id: "scan",
        name: "Scan",
        kind: "mesh",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        visible: true,
        color: "#fff",
        opacity: 1,
      },
    ];
    state.selectedId = "scan";
    const expected = coordinateAlignmentInterface(
      { datumAlignmentOpen: true },
      state.entities[0],
    );
    expect((await mutate("ui_set", { datumAlignmentOpen: true })).ok).toBe(
      true,
    );
    expect(ui).toMatchObject(expected);
    expect(
      (await mutate("ui_set", { datumAlignmentOpen: true, workspace: "mesh" }))
        .ok,
    ).toBe(false);
    expect(
      (
        await mutate("ui_set", {
          datumAlignmentOpen: true,
          toolPanelOpen: false,
        })
      ).ok,
    ).toBe(false);
    state.entities[0].locked = true;
    expect((await mutate("ui_set", { datumAlignmentOpen: true })).ok).toBe(
      false,
    );
    expect((await mutate("ui_set", { datumAlignmentOpen: false })).ok).toBe(
      true,
    );
    expect(state.history).toHaveLength(1);
  } finally {
    api.dispose();
  }
});

it("MCP launches and repeats the shared current command with revision, busy and retry guards", async () => {
  const { host } = setup();
  let busy = false;
  const repeat = new CommandRepeat();
  const run = vi.fn();
  repeat.configure({ "ribbon:transform": run }, () => busy);
  host.busy = () => busy;
  host.activity = (running) => {
    busy = running;
  };
  host.inspectCommands = () => repeat.inspect();
  host.launchCommand = (name) => repeat.run(name);
  const api = new ApplicationApi(host, createWorkflowOperations(host));
  try {
    expect(await api.invoke("command_get")).toMatchObject({
      ok: true,
      result: { lastCommand: null, canRepeat: false },
    });
    const args = {
      name: "ribbon:transform",
      expectedRevision: api.currentRevision(),
      requestId: "launch",
    };
    expect(await api.invoke("command_run", args)).toMatchObject({
      ok: true,
      result: { command: args.name, status: "launched" },
    });
    await api.invoke("command_run", args);
    expect(run).toHaveBeenCalledTimes(1);
    const again = {
      expectedRevision: api.currentRevision(),
      requestId: "repeat",
    };
    expect((await api.invoke("command_repeat", again)).ok).toBe(true);
    await api.invoke("command_repeat", again);
    expect(run).toHaveBeenCalledTimes(2);
    busy = true;
    expect(
      await api.invoke("command_repeat", { ...again, requestId: "busy" }),
    ).toMatchObject({ ok: false, error: { code: "BUSY" } });
    busy = false;
    expect(
      await api.invoke("command_repeat", {
        ...again,
        expectedRevision: 999,
        requestId: "stale",
      }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    expect(run).toHaveBeenCalledTimes(2);
  } finally {
    api.dispose();
  }
});

function setup() {
  const state: WorkspaceSnapshot = {
    name: "Original",
    entities: [],
    history: [{ entities: [], label: "Create box" }],
    future: [
      { entities: [], label: "Transform" },
      { entities: [], label: "Fillet" },
    ],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  const ui = { settingsOpen: false };
  const controlViewport = vi.fn();
  const image = {
    data: btoa("\x89PNG\r\n\x1a\n"),
    mimeType: "image/png" as const,
    width: 800,
    height: 600,
    bytes: 8,
    scope: "application" as const,
    capturedAt: "2026-10-13T00:00:00Z",
    sourceWidth: 800,
    sourceHeight: 600,
    redacted: "password-and-agent-token-inputs" as const,
    renderer: "browser-dom-with-current-viewport" as const,
  };
  const host = {
    snapshot: () => state,
    busy: () => false,
    activity: vi.fn(),
    inspectApplication: () => ui,
    setInterface: (patch: object) => Object.assign(ui, patch),
    inspectViewport: () => ({ projection: "orthographic" }),
    controlViewport,
    pickViewport: () => ({ hits: [] }),
    renameProject: (name: string) => {
      state.name = name;
    },
    captureScreenshot: vi.fn(async () => image),
  } as unknown as WorkspaceHost;
  const api = new ApplicationApi(host, createWorkflowOperations(host));
  const mutate = (name: string, args: object = {}) =>
    api.invoke(name, {
      ...args,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { state, ui, host, api, mutate, controlViewport, image };
}
it("returns ordered history labels compatible with the retained cursor", async () => {
  const { api } = setup();
  try {
    expect(await api.invoke("history_get")).toMatchObject({
      ok: true,
      result: {
        cursor: 1,
        entries: [
          { index: 0, label: "Starting state", current: false },
          { index: 1, label: "Create box", current: true },
          { index: 2, label: "Transform", current: false },
          { index: 3, label: "Fillet", current: false },
        ],
      },
    });
  } finally {
    api.dispose();
  }
});
it("sets UI visibility through the shared host and rejects empty settings", async () => {
  const { api, mutate, ui } = setup();
  try {
    expect((await mutate("ui_set", { settingsOpen: true })).ok).toBe(true);
    expect(ui.settingsOpen).toBe(true);
    expect((await mutate("ui_set")).ok).toBe(false);
  } finally {
    api.dispose();
  }
});
it("renames without replacing geometry/history and guards stale writes", async () => {
  const { api, mutate, state } = setup();
  const history = state.history;
  try {
    const revision = api.currentRevision();
    expect(await mutate("project_update", { name: "Fixture" })).toMatchObject({
      ok: true,
      result: { name: "Fixture" },
    });
    expect(state.history).toBe(history);
    expect(
      await api.invoke("project_update", {
        name: "Stale",
        expectedRevision: revision,
        requestId: "old",
      }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  } finally {
    api.dispose();
  }
});
it("validates navigation variants and refuses empty selection frames", async () => {
  const { api, mutate, controlViewport } = setup();
  try {
    expect(
      (
        await mutate("viewport_control", {
          action: "rotate",
          direction: "left",
          degrees: 15,
        })
      ).ok,
    ).toBe(true);
    expect(controlViewport).toHaveBeenCalledOnce();
    expect(
      (
        await mutate("viewport_control", {
          action: "rotate",
          direction: "left",
          degrees: 200,
        })
      ).ok,
    ).toBe(false);
    expect(
      (await mutate("viewport_control", { action: "fit", selection: true })).ok,
    ).toBe(false);
  } finally {
    api.dispose();
  }
});
it("exposes paired normalized surface-orbit coordinates through MCP", async () => {
  const { api, mutate, controlViewport } = setup();
  try {
    expect(
      (
        await mutate("viewport_control", {
          action: "rotate",
          direction: "left",
          degrees: 15,
          x: 0.7,
          y: 0.4,
        })
      ).ok,
    ).toBe(true);
    expect(controlViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 0.7, y: 0.4 }),
    );
    for (const coords of [{ x: 0.7 }, { y: 0.4 }, { x: -0.1, y: 0.4 }]) {
      expect(
        (
          await mutate("viewport_control", {
            action: "rotate",
            direction: "left",
            degrees: 15,
            ...coords,
          })
        ).ok,
      ).toBe(false);
    }
    expect(controlViewport).toHaveBeenCalledOnce();
  } finally {
    api.dispose();
  }
});

it("returns an image and readable artifact, recoverable through session metadata", async () => {
  const { api, image } = setup();
  try {
    const result = await api.invoke("screenshot_capture");
    expect(result).toMatchObject({
      ok: true,
      result: { image, artifact: { mime: "image/png", bytes: 8 } },
    });
    if (!result.ok) throw Error("Capture failed");
    const artifact = (result.result as { artifact: { artifactId: string } })
      .artifact;
    expect(
      await api.invoke("artifact_read", { artifactId: artifact.artifactId }),
    ).toMatchObject({ ok: true, result: { base64: image.data } });
    expect(await api.invoke("session_get")).toMatchObject({
      ok: true,
      result: {
        activeJobId: null,
        artifacts: [{ artifactId: artifact.artifactId }],
      },
    });
  } finally {
    api.dispose();
  }
});
it("preserves screenshot failure codes and supports compact tool discovery", async () => {
  const { api, host } = setup();
  host.captureScreenshot = async () => {
    throw new VisualCaptureError("CAPTURE_BUSY", "Capture in progress");
  };
  try {
    expect(await api.invoke("screenshot_capture")).toMatchObject({
      ok: false,
      error: { code: "CAPTURE_BUSY" },
    });
    const result = await api.invoke("tools_search", {
      query: "camera",
      limit: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error("Search failed");
    const tools = (result.result as { tools: object[] }).tools;
    expect(tools.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(tools)).not.toContain("inputSchema");
    expect(
      await api.invoke("tools_search", {
        query: "screenshot",
        includeSchemas: true,
      }),
    ).toMatchObject({
      ok: true,
      result: {
        tools: [
          { name: "screenshot_capture", inputSchema: { type: "object" } },
        ],
      },
    });
  } finally {
    api.dispose();
  }
});

it("discards a named GUI preview while busy without releasing unrelated work", async () => {
  const { api, host, mutate, state } = setup();
  host.busy = () => true;
  host.discardPreview = vi.fn();
  const entities = state.entities;
  try {
    expect(
      await mutate("preview_discard", { target: "surface" }),
    ).toMatchObject({
      ok: true,
      result: { cancellationRequested: true, committedGeometryPreserved: true },
    });
    expect(host.discardPreview).toHaveBeenCalledWith("surface");
    expect(host.activity).not.toHaveBeenCalled();
    expect(state.entities).toBe(entities);
    expect((await mutate("preview_discard", { target: "everything" })).ok).toBe(
      false,
    );
  } finally {
    api.dispose();
  }
});

it("discovers nested modeling subcommands and parameters without returning their full schemas", async () => {
  const { api } = setup();
  try {
    for (const [query, name] of [
      ["fillet", "cad_create"],
      ["opacity", "object_update"],
      ["reducePolygons", "mesh_process"],
    ]) {
      const result = await api.invoke("tools_search", { query });
      expect(result.ok).toBe(true);
      if (!result.ok) throw Error("Search failed");
      const tools = (result.result as { tools: Array<{ name: string }> }).tools;
      expect(tools.some((tool) => tool.name === name)).toBe(true);
      expect(JSON.stringify(tools)).not.toContain("inputSchema");
    }
  } finally {
    api.dispose();
  }
});

it("returns viewport mirror readiness and failure diagnostics through the existing MCP read operation", async () => {
  const { api, host } = setup();
  const mirror = {
    active: true,
    pending: true,
    ready: false,
    error: null as string | null,
    sourceCount: 1,
  };
  host.inspectViewport = () => ({
    projection: "orthographic",
    interactiveMirror: { ...mirror },
  });
  try {
    expect(await api.invoke("viewport_get", {})).toMatchObject({
      ok: true,
      result: { interactiveMirror: mirror },
    });
    mirror.pending = false;
    mirror.error = "source expired";
    expect(await api.invoke("viewport_get", {})).toMatchObject({
      ok: true,
      result: {
        interactiveMirror: {
          pending: false,
          ready: false,
          error: "source expired",
        },
      },
    });
  } finally {
    api.dispose();
  }
});

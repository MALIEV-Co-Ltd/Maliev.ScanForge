import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createWorkflowOperations } from "../src/automation/workflow-operations";

function fixture() {
  const snapshot = {
    name: "Scan",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  } as WorkspaceSnapshot;
  const status = {
    connected: true,
    source: "gamepad",
    preferences: { deadzone: 0.1 },
  };
  const control = vi.fn(async (_command: unknown, signal: AbortSignal) => {
    signal.throwIfAborted();
    return status;
  });
  const host = {
    snapshot: () => snapshot,
    busy: () => false,
    activity: vi.fn(),
    inspectSpaceMouse: () => status,
    controlSpaceMouse: control,
  } as unknown as WorkspaceHost;
  const api = new ApplicationApi(host, createWorkflowOperations(host));
  return { api, snapshot, control, status };
}

it("shares navigation status and guards repeated MCP connection requests without adding history", async () => {
  const { api, snapshot, control, status } = fixture();
  try {
    expect(await api.invoke("spacemouse_get")).toMatchObject({
      ok: true,
      result: status,
    });
    const request = {
      action: "connectDriver",
      expectedRevision: api.currentRevision(),
      requestId: "driver-once",
    };
    const first = await api.invoke("spacemouse_control", request);
    expect(first).toMatchObject({ ok: true, result: status });
    expect(await api.invoke("spacemouse_control", request)).toEqual(first);
    expect(control).toHaveBeenCalledOnce();
    expect(control.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(
      await api.invoke("spacemouse_control", {
        ...request,
        requestId: "stale",
        expectedRevision: 123456,
      }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    expect(snapshot.history).toEqual([]);
  } finally {
    api.dispose();
  }
});

it("rejects malformed and misplaced preferences before reaching the shared controller", async () => {
  const { api, control } = fixture();
  try {
    for (const args of [
      { action: "preferences", preferences: {} },
      { action: "preferences", preferences: { deadzone: 1 } },
      { action: "preferences", preferences: { rotationSpeed: -1 } },
      { action: "preferences", preferences: { invented: true } },
      { action: "automatic", preferences: { deadzone: 0.1 } },
    ])
      expect(
        await api.invoke("spacemouse_control", {
          ...args,
          expectedRevision: api.currentRevision(),
          requestId: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: false });
    expect(control).not.toHaveBeenCalled();
    expect(
      await api.invoke("spacemouse_control", {
        action: "preferences",
        preferences: { translationSpeed: 2, rotationEnabled: false },
        expectedRevision: api.currentRevision(),
        requestId: "valid",
      }),
    ).toMatchObject({ ok: true });
    expect(control).toHaveBeenCalledOnce();
  } finally {
    api.dispose();
  }
});

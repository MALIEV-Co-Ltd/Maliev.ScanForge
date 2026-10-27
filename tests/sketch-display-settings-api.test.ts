import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
});
function setup() {
  const state: WorkspaceSnapshot = {
    name: "Sketch display",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: { sketchControlPoints: true, sketchMeshPoints: true },
  };
  const commit = vi.fn(),
    settings = vi.fn((patch: Record<string, unknown>) =>
      Object.assign(state.settings, patch),
    );
  let busy = false;
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: vi.fn(),
    commit,
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings,
    activity: vi.fn(),
    busy: () => busy,
  };
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  const request = (
    patch: Record<string, unknown>,
    requestId: string = crypto.randomUUID(),
  ) => ({ patch, expectedRevision: api.currentRevision(), requestId });
  return {
    api,
    state,
    commit,
    settings,
    request,
    busy: () => {
      busy = true;
    },
  };
}

it.each(["sketchControlPoints", "sketchMeshPoints"])(
  "changes and observes %s through the shared settings operation without model history",
  async (field) => {
    const h = setup(),
      before = h.state.entities,
      history = h.state.history;
    const result = await h.api.invoke(
      "settings_set",
      h.request({ [field]: false }),
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const read = await h.api.invoke("project_get", {});
    expect(read).toMatchObject({
      ok: true,
      result: { settings: { [field]: false } },
    });
    expect(h.state.entities).toBe(before);
    expect(h.state.history).toBe(history);
    expect(h.commit).not.toHaveBeenCalled();
  },
);

it("retains retry and revision protection for the two sketch visibility settings", async () => {
  const h = setup(),
    args = h.request(
      { sketchControlPoints: false, sketchMeshPoints: false },
      "display-once",
    );
  const result = await h.api.invoke("settings_set", args);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(await h.api.invoke("settings_set", args)).toEqual(result);
  expect(h.settings).toHaveBeenCalledOnce();
  expect(
    await h.api.invoke("settings_set", { ...args, requestId: "stale-display" }),
  ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  expect(h.settings).toHaveBeenCalledOnce();
});

it.each(["sketchControlPoints", "sketchMeshPoints"])(
  "rejects invalid %s values before writing display state",
  async (field) => {
    const h = setup();
    for (const value of ["false", 0, null])
      expect(
        await h.api.invoke("settings_set", h.request({ [field]: value })),
      ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(h.settings).not.toHaveBeenCalled();
    expect(h.state.settings).toMatchObject({
      sketchControlPoints: true,
      sketchMeshPoints: true,
    });
  },
);

it("keeps the shared busy gate for sketch visibility changes", async () => {
  const h = setup();
  h.busy();
  expect(
    await h.api.invoke("settings_set", h.request({ sketchMeshPoints: false })),
  ).toMatchObject({ ok: false, error: { code: "BUSY" } });
  expect(h.settings).not.toHaveBeenCalled();
});

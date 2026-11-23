import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import {
  beginReferenceConstructionPreview,
  releaseReferenceConstructionPreview,
  inspectReferenceConstructionPreview,
} from "../src/automation/reference-construction-preview";
const apis: ApplicationApi[] = [];
function setup() {
  vi.useFakeTimers();
  const state: WorkspaceSnapshot = {
    name: "Admission",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const handler = vi.fn(() => ({ started: true }));
  const activity = vi.fn();
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("No kernel");
    },
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity,
    inspectApplication: () => ({ previews: {} }),
  };
  const names = [
    "global_alignment_preview",
    "alignment_preview",
    "landmark_preview",
    "landmark_edit",
    "scan_preview",
    "interactive_alignment_edit",
    "object_select",
  ];
  const api = new ApplicationApi(
    host,
    Object.fromEntries(names.map((n) => [n, handler])),
  );
  apis.push(api);
  const clear = vi.fn();
  const preview = beginReferenceConstructionPreview(
    host,
    { show: vi.fn(), clear },
    {
      geometry: { kind: "point", position: [0, 0, 0] },
      state: { completionWord: 0 },
    },
    {
      definition: {
        version: 1,
        kind: "point",
        mode: "coordinates",
        position: [1, 2, 3],
        sources: [],
      },
      writeNumericInputs: true,
      evaluationAllowed: true,
    },
  );
  const request = (command: string, args: Record<string, unknown> = {}) =>
    api.invoke(command, {
      ...args,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { api, host, state, handler, activity, clear, preview, request };
}
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
it.each([
  ["global_alignment_preview", {}],
  [
    "alignment_preview",
    {
      entityIds: ["mesh"],
      constraints: [{ kind: "point", point: [0, 0, 0], axis: 0 }],
    },
  ],
  ["landmark_preview", {}],
  ["landmark_edit", { action: "begin", movingId: "mesh" }],
  [
    "scan_preview",
    { action: "create", entityId: "mesh", operation: { kind: "shrinkwrap" } },
  ],
  ["interactive_alignment_edit", { action: "begin", entityIds: ["mesh"] }],
])(
  "blocks %s before work admission while a reference owns the preview",
  async (command, args) => {
    const { request, handler, activity, host, preview } = setup();
    expect(await request(command, args)).toMatchObject({
      ok: false,
      error: { code: "BUSY" },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(activity).not.toHaveBeenCalled();
    expect(inspectReferenceConstructionPreview(host)).toMatchObject({
      active: true,
      sessionId: preview.sessionId,
    });
  },
);
it("uses the same admission check for direct GUI preview producers", () => {
  const { api } = setup();
  expect(typeof api.requireReferencePreviewIdle).toBe("function");
  expect(() => api.requireReferencePreviewIdle()).toThrow(
    /reference.*preview/i,
  );
});
it("keeps unrelated reads and selection available without retiring the owner", async () => {
  const { api, host, request } = setup();
  expect((await api.invoke("capabilities_get")).ok).toBe(true);
  expect((await request("object_select", { entityId: "mesh" })).ok).toBe(true);
  expect(inspectReferenceConstructionPreview(host).active).toBe(true);
});
it("blocks failed cleanup until owner-scoped retirement is retried", async () => {
  const { api, host, clear, preview, request } = setup();
  clear.mockImplementationOnce(() => {
    throw Error("GPU retirement failed");
  });
  expect(() =>
    releaseReferenceConstructionPreview(host, preview.sessionId),
  ).toThrow(/retirement/);
  expect(() => api.requireReferencePreviewIdle()).toThrow(
    /reference.*preview/i,
  );
  expect(await request("global_alignment_preview")).toMatchObject({
    ok: false,
    error: { code: "BUSY" },
  });
  releaseReferenceConstructionPreview(host, preview.sessionId);
  expect(() => api.requireReferencePreviewIdle()).not.toThrow();
  expect((await request("global_alignment_preview")).ok).toBe(true);
});
it("retires expiry before admitting another producer", async () => {
  const { api, clear, request } = setup();
  vi.advanceTimersByTime(60000);
  expect(clear).toHaveBeenCalledOnce();
  expect(() => api.requireReferencePreviewIdle()).not.toThrow();
  expect((await request("global_alignment_preview")).ok).toBe(true);
});
it("also blocks a renderer-owned retirement after registry release", () => {
  const { api, host, preview } = setup();
  releaseReferenceConstructionPreview(host, preview.sessionId);
  host.inspectApplication = () => ({
    previews: { referenceConstruction: true },
  });
  expect(() => api.requireReferencePreviewIdle()).toThrow(
    /reference.*preview/i,
  );
});
it("preserves the BUSY receipt and admits a fresh request after release", async () => {
  const { api, host, preview, handler } = setup();
  const args = {
    expectedRevision: api.currentRevision(),
    requestId: "same-request",
  };
  const blocked = await api.invoke("global_alignment_preview", args);
  expect(blocked).toMatchObject({ ok: false, error: { code: "BUSY" } });
  releaseReferenceConstructionPreview(host, preview.sessionId);
  expect(await api.invoke("global_alignment_preview", args)).toEqual(blocked);
  expect(handler).not.toHaveBeenCalled();
  expect(
    (
      await api.invoke("global_alignment_preview", {
        ...args,
        requestId: "fresh-request",
      })
    ).ok,
  ).toBe(true);
});
it("retires stale model ownership before admitting a preview", async () => {
  const { host, state, clear, request } = setup();
  state.name = "Changed";
  expect((await request("global_alignment_preview")).ok).toBe(true);
  expect(clear).toHaveBeenCalledOnce();
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "stale",
  });
});

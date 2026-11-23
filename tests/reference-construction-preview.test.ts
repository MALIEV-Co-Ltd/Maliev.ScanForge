import { afterEach, expect, it, vi } from "vitest";
import type { WorkspaceHost, WorkspaceSnapshot } from "../src/automation/api";
import {
  beginReferenceConstructionPreview,
  inspectReferenceConstructionPreview,
  editReferenceConstructionPreview,
  applyReferenceConstructionPreview,
  releaseReferenceConstructionPreview,
  disposeReferenceConstructionPreview,
} from "../src/automation/reference-construction-preview";

const hosts: WorkspaceHost[] = [];
const prior = {
  geometry: { kind: "point" as const, position: [0, 0, 0] as const },
  state: { completionWord: 0 },
};
const draft = {
  definition: {
    version: 1 as const,
    kind: "point" as const,
    mode: "coordinates" as const,
    position: [1, 2, 3] as const,
    sources: [],
  },
  writeNumericInputs: true,
  evaluationAllowed: true,
};
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const state: WorkspaceSnapshot = {
    name: "Preview",
    projectId: "p",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const previews: Record<string, boolean> = {};
  const host = {
    snapshot: () => state,
    inspectApplication: () => ({ previews }),
  } as unknown as WorkspaceHost;
  const display = { show: vi.fn(), clear: vi.fn() };
  hosts.push(host);
  return {
    state,
    host,
    display,
    previews,
    begin: () => beginReferenceConstructionPreview(host, display, prior, draft),
  };
}
afterEach(() => {
  for (const host of hosts.splice(0)) disposeReferenceConstructionPreview(host);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it("owns one displayed preview and one finite timer per host", () => {
  const { host, display, begin } = setup();
  const initial = begin();
  expect(display.show).toHaveBeenCalledWith(
    initial.sessionId,
    expect.objectContaining({
      preview: expect.objectContaining({
        geometry: { kind: "point", position: [1, 2, 3] },
      }),
    }),
  );
  expect(vi.getTimerCount()).toBe(1);
  expect(() => begin()).toThrow(/active/);
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: true,
    sessionId: initial.sessionId,
    version: 1,
  });
});
it("releases only the requested owner and retires its timer", () => {
  const { host, display, begin } = setup();
  const initial = begin();
  expect(releaseReferenceConstructionPreview(host, "other-owner")).toBe(false);
  expect(display.clear).not.toHaveBeenCalled();
  expect(releaseReferenceConstructionPreview(host, initial.sessionId)).toBe(
    true,
  );
  expect(display.clear).toHaveBeenCalledWith(initial.sessionId);
  expect(releaseReferenceConstructionPreview(host, initial.sessionId)).toBe(
    false,
  );
  expect(vi.getTimerCount()).toBe(0);
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "cancelled",
  });
});
it("expires and clears the owned display without an explicit inspection call", () => {
  const { host, display, begin } = setup();
  const initial = begin();
  vi.advanceTimersByTime(60000);
  expect(display.clear).toHaveBeenCalledWith(initial.sessionId);
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "expired",
  });
  expect(vi.getTimerCount()).toBe(0);
});
it("renews exactly one timer after a successful displayed edit", () => {
  const { host, display, begin } = setup();
  const initial = begin();
  vi.advanceTimersByTime(10000);
  const edited = editReferenceConstructionPreview(host, initial.sessionId, 1, {
    ...draft,
    definition: { ...draft.definition, position: [4, 5, 6] },
  });
  expect(edited).toMatchObject({ version: 2, expiresAt: 71000 });
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(50000);
  expect(display.clear).not.toHaveBeenCalled();
  vi.advanceTimersByTime(10000);
  expect(display.clear).toHaveBeenCalledOnce();
});
it("preserves old cache/version/lease and restores display after a rejected edit", () => {
  const { host, display, begin } = setup();
  const initial = begin();
  vi.advanceTimersByTime(10000);
  display.show.mockImplementationOnce(() => {
    throw Error("new display failed");
  });
  expect(() =>
    editReferenceConstructionPreview(host, initial.sessionId, 1, draft),
  ).toThrow("new display failed");
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: true,
    version: 1,
    expiresAt: 61000,
  });
  expect(display.show).toHaveBeenLastCalledWith(
    initial.sessionId,
    expect.objectContaining({ definition: draft.definition }),
  );
  expect(vi.getTimerCount()).toBe(1);
});
it("retires a preview when both its edit and display restoration fail", () => {
  const { host, display, begin } = setup();
  const initial = begin();
  display.show
    .mockImplementationOnce(() => {
      throw Error("new failed");
    })
    .mockImplementationOnce(() => {
      throw Error("restore failed");
    });
  expect(() =>
    editReferenceConstructionPreview(host, initial.sessionId, 1, draft),
  ).toThrow();
  expect(display.clear).toHaveBeenCalledWith(initial.sessionId);
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "cancelled",
  });
  expect(vi.getTimerCount()).toBe(0);
});
it("clears stale models without committing or renewing", () => {
  const { host, display, state, begin } = setup();
  const initial = begin();
  state.name = "Changed";
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "stale",
  });
  expect(display.clear).toHaveBeenCalledWith(initial.sessionId);
  expect(state.history).toHaveLength(0);
});
it("rejects model changes made during edit display publication", () => {
  const { host, display, state, begin } = setup();
  const initial = begin();
  display.show.mockImplementationOnce(() => {
    state.name = "Changed";
  });
  expect(() =>
    editReferenceConstructionPreview(host, initial.sessionId, 1, draft),
  ).toThrow(/changed|stale/);
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "stale",
  });
  expect(display.clear).toHaveBeenCalledWith(initial.sessionId);
});
it("publishes cached Apply once and clears its display/timer", () => {
  const { host, display, state, begin } = setup();
  const initial = begin();
  const publish = vi.fn(() => {
    state.history.push({ entities: [], label: "Create reference" });
  });
  const result = applyReferenceConstructionPreview(
    host,
    initial.sessionId,
    1,
    publish,
  );
  expect(result).toMatchObject({
    preview: { geometry: { kind: "point", position: [1, 2, 3] } },
    cleanupPending: false,
  });
  expect(state.history).toHaveLength(1);
  expect(display.clear).toHaveBeenCalledWith(initial.sessionId);
  expect(vi.getTimerCount()).toBe(0);
  expect(() =>
    applyReferenceConstructionPreview(host, initial.sessionId, 1, publish),
  ).toThrow();
  expect(publish).toHaveBeenCalledOnce();
});
it("retains a usable preview after a rejected atomic publication", () => {
  const { host, display, begin } = setup();
  const initial = begin();
  expect(() =>
    applyReferenceConstructionPreview(host, initial.sessionId, 1, () => {
      throw Error("commit rejected");
    }),
  ).toThrow("commit rejected");
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: true,
    version: 1,
  });
  expect(display.clear).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
});
it("reports committed Apply plus retained cleanup instead of retrying publication", () => {
  const { host, display, begin } = setup();
  const initial = begin();
  display.clear.mockImplementationOnce(() => {
    throw Error("clear failed");
  });
  const publish = vi.fn();
  const result = applyReferenceConstructionPreview(
    host,
    initial.sessionId,
    1,
    publish,
  );
  expect(result).toMatchObject({
    cleanupPending: true,
    cleanupError: "clear failed",
  });
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "applied",
    cleanupPending: true,
  });
  expect(() =>
    applyReferenceConstructionPreview(host, initial.sessionId, 1, publish),
  ).toThrow();
  expect(publish).toHaveBeenCalledOnce();
  expect(releaseReferenceConstructionPreview(host, initial.sessionId)).toBe(
    true,
  );
  expect(vi.getTimerCount()).toBe(0);
});
it("retains failed expiry cleanup for an explicit owner-scoped retry", () => {
  const { host, display, begin } = setup();
  const initial = begin();
  display.clear.mockImplementationOnce(() => {
    throw Error("clear failed");
  });
  vi.advanceTimersByTime(60000);
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "expired",
    cleanupPending: true,
    cleanupError: "clear failed",
  });
  expect(() => begin()).toThrow(/cleanup/);
  expect(releaseReferenceConstructionPreview(host, "other")).toBe(false);
  expect(releaseReferenceConstructionPreview(host, initial.sessionId)).toBe(
    true,
  );
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
    reason: "expired",
  });
});
it("cleans a failed initial display publication", () => {
  const { host, display, begin } = setup();
  display.show.mockImplementationOnce(() => {
    throw Error("show failed");
  });
  expect(() => begin()).toThrow("show failed");
  expect(display.clear).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    active: false,
  });
});
it("isolates workspace disposal and blocks reentrant release", () => {
  const a = setup(),
    b = setup();
  const first = a.begin(),
    second = b.begin();
  applyReferenceConstructionPreview(a.host, first.sessionId, 1, () => {
    expect(() =>
      releaseReferenceConstructionPreview(a.host, first.sessionId),
    ).toThrow(/transition/);
  });
  expect(inspectReferenceConstructionPreview(b.host)).toMatchObject({
    active: true,
    sessionId: second.sessionId,
  });
  disposeReferenceConstructionPreview(b.host);
  expect(b.display.clear).toHaveBeenCalledWith(second.sessionId);
  expect(vi.getTimerCount()).toBe(0);
});
it("blocks reentrant release from the owned clear callback", () => {
  const { host, display, begin } = setup();
  const initial = begin();
  display.clear.mockImplementation(() => {
    expect(() =>
      releaseReferenceConstructionPreview(host, initial.sessionId),
    ).toThrow(/transition/);
  });
  expect(releaseReferenceConstructionPreview(host, initial.sessionId)).toBe(
    true,
  );
  expect(display.clear).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("retains failed initial display cleanup for an owner-scoped retry", () => {
  const { host, display, begin } = setup();
  display.show.mockImplementationOnce(() => {
    throw Error("show failed");
  });
  display.clear.mockImplementationOnce(() => {
    throw Error("clear failed");
  });
  expect(() => begin()).toThrow();
  const state = inspectReferenceConstructionPreview(host);
  expect(state).toMatchObject({
    active: false,
    reason: "cancelled",
    cleanupPending: true,
  });
  if (!("sessionId" in state)) throw Error("Missing cleanup owner");
  expect(releaseReferenceConstructionPreview(host, state.sessionId)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("does not display or renew an edit with the wrong version", () => {
  const { host, display, begin } = setup();
  const initial = begin();
  expect(() =>
    editReferenceConstructionPreview(host, initial.sessionId, 0, draft),
  ).toThrow(/version/);
  expect(display.show).toHaveBeenCalledOnce();
  expect(inspectReferenceConstructionPreview(host)).toMatchObject({
    version: 1,
    expiresAt: 61000,
  });
});
it.each([
  "interactive",
  "landmarkSession",
  "sketchSection",
  "datum",
  "scan",
  "landmarks",
  "surface",
  "globalAlignment",
])("rejects competing %s preview before display allocation", (key) => {
  const { previews, display, begin } = setup();
  previews[key] = true;
  expect(() => begin()).toThrow(/preview|alignment/i);
  expect(display.show).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

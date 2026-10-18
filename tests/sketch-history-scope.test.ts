import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { rectangleSketch, type Sketch } from "../src/sketch";
import { SketchUndo } from "../src/sketch-undo";
import { InteractiveAlignmentSession } from "../src/interactive-alignment-session";
import catalog from "../src/automation/catalog.json";

function setup() {
  const initial = rectangleSketch();
  const source = {
    id: "source",
    name: "Locked reference",
    kind: "cad" as const,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    kernelId: "reference",
    locked: true,
    visible: true,
    color: "#ffffff",
    opacity: 1,
  };
  const state: WorkspaceSnapshot = {
    name: "Sketch",
    entities: [source],
    history: [{ entities: [], label: "CAD" }],
    future: [],
    selectedId: null,
    selection: null,
    settings: {},
    sketchDraft: initial,
    authoring: {
      sketch: structuredClone(initial),
      activeSketchId: "a",
      sketches: ["a", "b"].map((id) => ({
        id,
        name: id,
        sketch: structuredClone(initial),
      })),
    },
  };
  const sessions = new Map<string, SketchUndo>();
  const key = () =>
    state.authoring.activeSketchId
      ? `saved:${state.authoring.activeSketchId}`
      : "legacy";
  const publish = (sketch: Sketch) => {
    state.sketchDraft = sketch;
    if (state.authoring.activeSketchId)
      state.authoring.sketches = state.authoring.sketches!.map((item) =>
        item.id === state.authoring.activeSketchId ? { ...item, sketch } : item,
      );
    else state.authoring.sketch = sketch;
  };
  let busy = false;
  let interactive: ReturnType<InteractiveAlignmentSession["inspect"]> | null =
    null;
  const step = vi.fn((repeat: boolean) => {
    // Real ApplicationApi has already set activity(true): the adapter must not
    // reject its own admitted write because the API owns the busy lane.
    expect(busy).toBe(true);
    const session = sessions.get(key());
    const next = repeat
      ? session?.redo(state.sketchDraft!)
      : session?.undo(state.sketchDraft!);
    if (!next) return false;
    publish(next);
    return true;
  });
  const host: WorkspaceHost = {
    snapshot: () => ({ ...state }),
    cad: () => {
      throw new Error("Sketch history must not call native CAD");
    },
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: (next) => {
      let session = sessions.get(key());
      if (!session) {
        session = new SketchUndo();
        sessions.set(key(), session);
      }
      session.record(state.sketchDraft!, next);
      publish(next);
    },
    stepSketchHistory: step,
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => busy,
    activity: (running) => {
      busy = running;
    },
    inspectInteractive: () => interactive,
  };
  const api = new ApplicationApi(host, createOperations(host));
  let request = 0;
  const invoke = (command: string, args: Record<string, unknown> = {}) =>
    api.invoke(command, {
      expectedRevision: api.currentRevision(),
      requestId: `request-${++request}`,
      ...args,
    });
  const edit = async (offset: number) => {
    const next = structuredClone(state.sketchDraft!);
    next.points[0].x += offset;
    expect(await invoke("sketch_set", { sketch: next })).toMatchObject({
      ok: true,
    });
    return next;
  };
  const activate = (id?: string) => {
    state.authoring.activeSketchId = id;
    state.sketchDraft = id
      ? state.authoring.sketches!.find((item) => item.id === id)!.sketch
      : state.authoring.sketch!;
  };
  return {
    api,
    state,
    host,
    step,
    initial,
    source,
    sessions,
    invoke,
    edit,
    activate,
    setBusy: (value: boolean) => {
      busy = value;
    },
    lockInteractive: () => {
      const target = {
        ...source,
        kind: "mesh" as const,
        kernelId: undefined,
        locked: false,
      };
      interactive = new InteractiveAlignmentSession(
        [target],
        [target.id],
        [0, 0, 0],
      ).inspect();
    },
  };
}

it.each([undefined, "model"])(
  "preserves the existing model default (scope=%s)",
  async (scope) => {
    const h = setup();
    try {
      const before = structuredClone(h.state.authoring);
      expect(
        await h.invoke("history_undo", scope ? { scope } : {}),
      ).toMatchObject({ ok: true, result: { updated: true } });
      expect(
        await h.invoke("history_redo", scope ? { scope } : {}),
      ).toMatchObject({ ok: true, result: { updated: true } });
      expect(h.host.undo).toHaveBeenCalledOnce();
      expect(h.host.redo).toHaveBeenCalledOnce();
      expect(h.step).not.toHaveBeenCalled();
      expect(h.state.authoring).toEqual(before);
    } finally {
      h.api.dispose();
    }
  },
);

it("undoes/redoes one current sketch edit without model history or locked CAD writes, including retry", async () => {
  const h = setup();
  try {
    const history = h.state.history,
      future = h.state.future,
      entities = h.state.entities;
    const sourceBefore = structuredClone(h.source);
    const changed = await h.edit(3);
    const undoArgs = {
      scope: "sketch",
      expectedRevision: h.api.currentRevision(),
      requestId: "same-undo",
    };
    expect(await h.api.invoke("history_undo", undoArgs)).toMatchObject({
      ok: true,
      result: { updated: true, scope: "sketch" },
    });
    expect(h.state.sketchDraft).toEqual(h.initial);
    expect(await h.api.invoke("history_undo", undoArgs)).toMatchObject({
      ok: true,
      result: { updated: true, scope: "sketch" },
    });
    expect(h.step).toHaveBeenCalledOnce();
    expect(await h.invoke("history_undo", { scope: "sketch" })).toMatchObject({
      ok: true,
      result: { updated: false, scope: "sketch" },
    });
    expect(await h.invoke("history_redo", { scope: "sketch" })).toMatchObject({
      ok: true,
      result: { updated: true, scope: "sketch" },
    });
    expect(h.state.sketchDraft).toEqual(changed);
    expect(h.state.authoring.sketches![0].sketch).toEqual(changed);
    expect(h.state.entities).toBe(entities);
    expect(h.source).toEqual(sourceBefore);
    expect(h.state.history).toBe(history);
    expect(h.state.future).toBe(future);
    expect(h.host.commit).not.toHaveBeenCalled();
    expect(h.host.undo).not.toHaveBeenCalled();
    expect(h.host.redo).not.toHaveBeenCalled();
  } finally {
    h.api.dispose();
  }
});

it("traverses only the currently active saved or legacy session", async () => {
  const h = setup();
  try {
    const a = await h.edit(2);
    h.activate("b");
    const b = await h.edit(4);
    expect(await h.invoke("history_undo", { scope: "sketch" })).toMatchObject({
      ok: true,
      result: { updated: true },
    });
    expect(h.state.authoring.sketches![0].sketch).toEqual(a);
    expect(h.state.authoring.sketches![1].sketch).toEqual(h.initial);
    h.activate("a");
    expect(await h.invoke("history_undo", { scope: "sketch" })).toMatchObject({
      ok: true,
      result: { updated: true },
    });
    expect(h.state.sketchDraft).toEqual(h.initial);
    h.activate();
    await h.edit(6);
    expect(await h.invoke("history_undo", { scope: "sketch" })).toMatchObject({
      ok: true,
      result: { updated: true },
    });
    expect(h.state.authoring.sketch).toEqual(h.initial);
    h.activate("b");
    expect(await h.invoke("history_redo", { scope: "sketch" })).toMatchObject({
      ok: true,
      result: { updated: true },
    });
    expect(h.state.sketchDraft).toEqual(b);
  } finally {
    h.api.dispose();
  }
});

it("rejects stale revisions, busy/interactive admission and unknown scopes before touching history", async () => {
  const h = setup();
  try {
    const stale = h.api.currentRevision();
    await h.edit(2);
    expect(
      await h.invoke("history_undo", {
        scope: "sketch",
        expectedRevision: stale,
      }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    expect(await h.invoke("history_undo", { scope: "other" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
    h.setBusy(true);
    expect(await h.invoke("history_undo", { scope: "sketch" })).toMatchObject({
      ok: false,
      error: { code: "BUSY" },
    });
    h.setBusy(false);
    h.lockInteractive();
    expect(await h.invoke("history_redo", { scope: "sketch" })).toMatchObject({
      ok: false,
      error: { code: "BUSY" },
    });
    expect(h.step).not.toHaveBeenCalled();
    expect(h.host.undo).not.toHaveBeenCalled();
    expect(h.host.redo).not.toHaveBeenCalled();
  } finally {
    h.api.dispose();
  }
});

it("never falls back to model undo when the sketch adapter is unavailable", async () => {
  const h = setup();
  try {
    delete h.host.stepSketchHistory;
    const response = await h.invoke("history_undo", { scope: "sketch" });
    expect(response).toMatchObject({ ok: false });
    if (response.ok) throw new Error("Missing adapter was accepted");
    expect(response.error.message).toContain("Sketch history is unavailable");
    expect(h.host.undo).not.toHaveBeenCalled();
  } finally {
    h.api.dispose();
  }
});

it("discovers explicit sketch scope without changing required mutation guards or readOnly metadata", () => {
  for (const name of ["history_undo", "history_redo"]) {
    const tool = catalog.find((item) => item.name === name)!;
    expect(tool).toMatchObject({ readOnly: false, job: false });
    expect(tool.inputSchema).toMatchObject({
      required: ["expectedRevision", "requestId"],
      additionalProperties: false,
      properties: {
        scope: { type: "string", enum: ["model", "sketch"], default: "model" },
      },
    });
  }
});

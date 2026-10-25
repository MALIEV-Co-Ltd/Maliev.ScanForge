import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { rectangleSketch, type Sketch } from "../src/sketch";
import type { CadClient } from "../src/cad/client";
function setup() {
  const state: WorkspaceSnapshot = {
    name: "Sketch solve",
    entities: [],
    history: [],
    future: [],
    authoring: { sketch: rectangleSketch() },
    selectedId: null,
    selection: null,
    settings: {},
  };
  let busy = false;
  const setSketch = vi.fn((sketch: Sketch) => {
    state.authoring = { ...state.authoring, sketch };
  });
  const host: WorkspaceHost = {
    snapshot: () => ({ ...state }),
    cad: () => ({}) as CadClient,
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch,
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => busy,
    activity: (running) => {
      busy = running;
    },
  };
  const api = new ApplicationApi(host, createOperations(host));
  return { api, state, setSketch };
}
it("solves and publishes once through the existing guarded sketch_set operation", async () => {
  const { api, state, setSketch } = setup();
  try {
    const sketch = rectangleSketch();
    sketch.points[1].x = 35;
    const original = structuredClone(sketch);
    const args = {
      sketch,
      solve: true,
      expectedRevision: api.currentRevision(),
      requestId: "solve-once",
    };
    const result = await api.invoke("sketch_set", args);
    expect(result).toMatchObject({
      ok: true,
      result: {
        updated: true,
        solution: { converged: true, conflictingConstraintIds: [] },
      },
    });
    expect(state.authoring.sketch!.points[1].x).toBeCloseTo(40, 4);
    expect(sketch).toEqual(original);
    expect(await api.invoke("sketch_set", args)).toEqual(result);
    expect(setSketch).toHaveBeenCalledOnce();
    const prior = state.authoring.sketch;
    expect(
      await api.invoke("sketch_set", { ...args, requestId: "stale" }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    expect(state.authoring.sketch).toBe(prior);
  } finally {
    api.dispose();
  }
});
it("rejects a conflicting solve atomically without replacing or mutating the draft", async () => {
  const { api, state, setSketch } = setup();
  try {
    const original = state.authoring.sketch;
    const sketch = rectangleSketch();
    sketch.constraints.push({
      id: "impossible",
      kind: "fixed",
      point: "p1",
      x: 10,
      y: 0,
    });
    const revision = api.currentRevision();
    const result = await api.invoke("sketch_set", {
      sketch,
      solve: true,
      expectedRevision: revision,
      requestId: "conflict",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/conflict|unsolved/i);
    expect(setSketch).not.toHaveBeenCalled();
    expect(state.authoring.sketch).toBe(original);
    expect(api.currentRevision()).toBe(revision);
  } finally {
    api.dispose();
  }
});
it.each([undefined, false])(
  "retains unsolved draft replacement when solve=%s",
  async (solve) => {
    const { api, state } = setup();
    try {
      const sketch = rectangleSketch();
      sketch.points[1].x = 35;
      const args = {
        sketch,
        ...(solve === undefined ? {} : { solve }),
        expectedRevision: api.currentRevision(),
        requestId: "legacy",
      };
      expect(await api.invoke("sketch_set", args)).toMatchObject({
        ok: true,
        result: { updated: true },
      });
      expect(state.authoring.sketch!.points[1].x).toBe(35);
    } finally {
      api.dispose();
    }
  },
);

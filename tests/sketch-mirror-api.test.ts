import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import type { Sketch } from "../src/sketch";

const source = (): Sketch => ({
  version: 1,
  points: [
    { id: "axis-a", x: 1, y: -4 },
    { id: "axis-b", x: 1, y: 4 },
    { id: "a", x: 3, y: 0 },
    { id: "b", x: 5, y: 2 },
  ],
  segments: [
    { id: "axis", a: "axis-a", b: "axis-b", construction: true },
    { id: "line", a: "a", b: "b" },
  ],
  constraints: [{ id: "fixed-a", kind: "fixed", point: "a", x: 3, y: 0 }],
});

function fixture(busy = false) {
  const state: WorkspaceSnapshot = {
    name: "Mirror",
    entities: [],
    history: [],
    future: [],
    authoring: { sketch: source() },
    selectedId: null,
    selection: null,
    settings: {},
  };
  const setSketch = vi.fn((next: Sketch) => {
    if (state.sketchDraft) state.sketchDraft = next;
    else state.authoring = { ...state.authoring, sketch: next };
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
    activity: vi.fn(),
  };
  return {
    api: new ApplicationApi(host, createOperations(host)),
    state,
    host,
    setSketch,
  };
}

const selection = { axis: "axis", curveIds: ["line"] };

it("discovers mirror and creates free copies once while keeping the constrained originals", async () => {
  const { api, state, host, setSketch } = fixture();
  try {
    const found = await api.invoke("tools_search", { query: "sketch mirror" });
    expect(JSON.stringify(found)).toContain("sketch_mirror");
    const before = structuredClone(state.authoring.sketch!);
    const request = {
      ...selection,
      expectedRevision: api.currentRevision(),
      requestId: "mirror",
    };
    const reply = await api.invoke("sketch_mirror", request);
    expect(reply).toMatchObject({ ok: true, result: { changed: true } });
    if (!reply.ok) throw Error(reply.error.message);
    const result = reply.result as {
      pointMap: Record<string, string>;
      curveMap: Record<string, string>;
      createdPointIds: string[];
      createdCurveIds: string[];
    };
    const next = state.authoring.sketch!;
    expect(next.points.slice(0, 4)).toEqual(before.points);
    expect(next.segments.slice(0, 2)).toEqual(before.segments);
    expect(next.constraints).toEqual(before.constraints);
    expect(next.points.find((p) => p.id === result.pointMap.a)).toEqual({
      id: result.pointMap.a,
      x: -1,
      y: 0,
    });
    expect(next.points.find((p) => p.id === result.pointMap.b)).toEqual({
      id: result.pointMap.b,
      x: -3,
      y: 2,
    });
    expect(next.segments.find((s) => s.id === result.curveMap.line)).toEqual({
      id: result.curveMap.line,
      a: result.pointMap.a,
      b: result.pointMap.b,
    });
    expect(result.createdPointIds).toHaveLength(2);
    expect(result.createdCurveIds).toEqual([result.curveMap.line]);
    expect(await api.invoke("sketch_mirror", request)).toEqual(reply);
    expect(setSketch).toHaveBeenCalledOnce();
    expect(host.commit).not.toHaveBeenCalled();
    expect(state.history).toEqual([]);
    expect(
      await api.invoke("sketch_mirror", { ...request, requestId: "stale" }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    expect(
      await api.invoke("sketch_mirror", { ...request, curveIds: ["axis"] }),
    ).toMatchObject({ ok: false, error: { code: "REQUEST_CONFLICT" } });
  } finally {
    api.dispose();
  }
});

it("mirrors the active draft without replacing the persisted authoring sketch", async () => {
  const { api, state, setSketch } = fixture();
  try {
    state.sketchDraft = source();
    state.sketchDraft.points[2].x = 4;
    state.sketchDraft.constraints = [];
    const persisted = structuredClone(state.authoring.sketch);
    const reply = await api.invoke("sketch_mirror", {
      ...selection,
      expectedRevision: api.currentRevision(),
      requestId: "draft",
    });
    expect(reply.ok).toBe(true);
    expect(state.authoring.sketch).toEqual(persisted);
    expect(state.sketchDraft.points.some((p) => p.x === -2 && p.y === 0)).toBe(
      true,
    );
    expect(setSketch).toHaveBeenCalledOnce();
  } finally {
    api.dispose();
  }
});

it("rejects invalid selections and schema fields before changing the sketch or revision", async () => {
  const { api, state, setSketch } = fixture();
  try {
    const before = structuredClone(state),
      revision = api.currentRevision();
    const invalid = [
      { curveIds: [] },
      { curveIds: ["line", "line"] },
      { curveIds: ["axis"] },
      { curveIds: ["missing"] },
      { axis: "line" },
      { axis: "missing" },
      { curveIds: [3] },
      { copyConstraints: true },
    ];
    for (const [index, fields] of invalid.entries()) {
      const reply = await api.invoke("sketch_mirror", {
        ...selection,
        ...fields,
        expectedRevision: revision,
        requestId: `invalid-${index}`,
      });
      expect(reply.ok).toBe(false);
      if ([0, 1, 6, 7].includes(index))
        expect(reply).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    }
    expect(state).toEqual(before);
    expect(api.currentRevision()).toBe(revision);
    expect(setSketch).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});

it("rejects a missing sketch and preserves a replacement draft when the revision changes during work", async () => {
  const { api, state, setSketch } = fixture();
  try {
    state.authoring = {};
    expect(
      (
        await api.invoke("sketch_mirror", {
          ...selection,
          expectedRevision: api.currentRevision(),
          requestId: "missing",
        })
      ).ok,
    ).toBe(false);
    state.authoring = { sketch: source() };
    const pending = api.invoke("sketch_mirror", {
      ...selection,
      expectedRevision: api.currentRevision(),
      requestId: "revision-race",
    });
    const replacement = source();
    replacement.points[2].x = 7;
    state.sketchDraft = replacement;
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "REVISION_CONFLICT" },
    });
    expect(state.sketchDraft).toBe(replacement);
    expect(setSketch).not.toHaveBeenCalled();
  } finally {
    api.dispose();
  }
});

it("preserves the sketch when the executor is busy or disposed during an awaited mirror", async () => {
  const locked = fixture(true);
  try {
    expect(
      await locked.api.invoke("sketch_mirror", {
        ...selection,
        expectedRevision: locked.api.currentRevision(),
        requestId: "busy",
      }),
    ).toMatchObject({ ok: false, error: { code: "BUSY" } });
    expect(locked.setSketch).not.toHaveBeenCalled();
  } finally {
    locked.api.dispose();
  }
  const { api, state, setSketch } = fixture();
  const before = structuredClone(state);
  const pending = api.invoke("sketch_mirror", {
    ...selection,
    expectedRevision: api.currentRevision(),
    requestId: "cancelled",
  });
  api.dispose();
  expect((await pending).ok).toBe(false);
  expect(state).toEqual(before);
  expect(setSketch).not.toHaveBeenCalled();
});

it("retains large reference sections without serializing the workspace for every sample", async () => {
  const { api, state, host } = fixture();
  try {
    const sketch = state.authoring.sketch!;
    sketch.frame = {
      origin: [0, 0, 0],
      u: [1, 0, 0],
      v: [0, 1, 0],
      normal: [0, 0, 1],
    };
    sketch.reference = {
      kind: "section",
      sourceId: "scan",
      axis: "z",
      offset: 0,
      onSlicingPlane: true,
      selectedOnly: false,
      sampled: false,
      segments: Array.from({ length: 8192 }, (_, i) => i % 4),
    };
    const revision = api.currentRevision(),
      references = structuredClone(sketch.reference);
    const snapshots = vi.spyOn(host, "snapshot");
    const result = await api.invoke("sketch_mirror", {
      ...selection,
      expectedRevision: revision,
      requestId: "large-reference",
    });
    expect(result.ok).toBe(true);
    expect(state.authoring.sketch!.reference).toEqual(references);
    expect(state.authoring.sketch!.points).toHaveLength(6);
    expect(snapshots.mock.calls.length).toBeLessThan(256);
  } finally {
    api.dispose();
  }
});

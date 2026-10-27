import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createAuthoringOperations } from "../src/automation/authoring-operations";
import type { Entity } from "../src/types";
import type { CadClient } from "../src/cad/client";
import {
  parseProject,
  serializeProject,
  serializeProjectBlob,
} from "../src/io";

const plane: Entity = {
  id: "plane",
  name: "Rotated datum",
  kind: "plane",
  positions: [],
  color: "#fff",
  opacity: 1,
  visible: true,
  planeFrame: { center: [4, 5, 6], normal: [0, 0, 1], tangent: [0, 2, 0] },
};
function setup(entities = [structuredClone(plane)]) {
  const state: WorkspaceSnapshot = {
    name: "Plane sketch",
    entities,
    history: [],
    future: [],
    authoring: {},
    selectedId: "plane",
    selectedIds: ["plane"],
    selection: null,
    settings: {},
  };
  const setAuthoring = vi.fn((authoring: WorkspaceSnapshot["authoring"]) => {
    state.authoring = authoring;
  });
  const host = {
    snapshot: () => state,
    cad: () => ({}) as CadClient,
    commit: vi.fn(),
    replace: vi.fn(),
    select: vi.fn((id: string | null) => {
      state.selectedId = id;
      state.selectedIds = id ? [id] : [];
    }),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
    setAuthoring,
  } as WorkspaceHost;
  const api = new ApplicationApi(host, createAuthoringOperations(host));
  return { state, api, setAuthoring };
}
it("creates a detached empty sketch from the stored plane tangent, retries once and persists its placement", async () => {
  const h = setup();
  try {
    const args = {
      action: "create",
      name: "On datum",
      planeSourceId: "plane",
      normalOffset: -3,
      expectedRevision: h.api.currentRevision(),
      requestId: "plane-create",
    };
    const result = await h.api.invoke("sketch_manage", args);
    expect(result).toMatchObject({
      ok: true,
      result: {
        frame: {
          origin: [4, 5, 3],
          u: [0, 1, 0],
          v: [-1, 0, 0],
          normal: [0, 0, 1],
        },
      },
    });
    const sketch = h.state.authoring.sketches![0].sketch;
    expect(sketch.points).toEqual([]);
    expect(sketch.segments).toEqual([]);
    expect(sketch.constraints).toEqual([]);
    expect(await h.api.invoke("sketch_manage", args)).toEqual(result);
    expect(h.setAuthoring).toHaveBeenCalledOnce();
    expect(h.state.selectedId).toBeNull();
    expect(h.state.selectedIds).toEqual([]);
    h.state.entities[0].planeFrame!.center[0] = 100;
    expect(sketch.frame!.origin).toEqual([4, 5, 3]);
    for (const text of [
      serializeProject("Plane", [], h.state.authoring),
      await (await serializeProjectBlob("Plane", [], h.state.authoring)).text(),
    ])
      expect(parseProject(text).authoring).toEqual(h.state.authoring);
    expect(
      await h.api.invoke("sketch_manage", { ...args, requestId: "stale" }),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  } finally {
    h.api.dispose();
  }
});
it.each([
  { planeSourceId: "missing" },
  {
    planeSourceId: "plane",
    sketch: {
      version: 1,
      points: [],
      segments: [],
      constraints: [],
      frame: {
        origin: [0, 0, 0],
        u: [1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, 1],
      },
    },
  },
  { normalOffset: 2 },
  { planeSourceId: "plane", normalOffset: Infinity },
  { planeSourceId: "plane", normalOffset: 1e10 },
  {
    planeSourceId: "plane",
    sketch: { version: 1, points: [], segments: [], constraints: [] },
  },
  {
    sketch: {
      version: 1,
      points: [],
      segments: [],
      constraints: [],
      frame: {
        origin: [0, 0, 0],
        u: [2, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, 1],
      },
    },
  },
])(
  "rejects invalid or ambiguous plane creation without publishing: %j",
  async (fields) => {
    const h = setup();
    try {
      expect(
        await h.api.invoke("sketch_manage", {
          action: "create",
          name: "Bad",
          ...fields,
          expectedRevision: h.api.currentRevision(),
          requestId: "bad",
        }),
      ).toMatchObject({ ok: false });
      expect(h.setAuthoring).not.toHaveBeenCalled();
      expect(h.state.authoring).toEqual({});
    } finally {
      h.api.dispose();
    }
  },
);
it("uses legacy fitted plane center/normal and rejects malformed stored tangent without publishing", async () => {
  const legacy = structuredClone(plane);
  delete legacy.planeFrame;
  legacy.fit = {
    kind: "plane",
    center: [4, 5, 6],
    axis: [0, 0, 1],
    rms: 0,
    maxError: 0,
  };
  const h = setup([legacy]);
  try {
    expect(
      await h.api.invoke("sketch_manage", {
        action: "create",
        name: "Legacy",
        planeSourceId: "plane",
        expectedRevision: h.api.currentRevision(),
        requestId: "legacy",
      }),
    ).toMatchObject({
      ok: true,
      result: { frame: { origin: [4, 5, 6], u: [1, 0, 0], v: [0, 1, 0] } },
    });
    legacy.planeFrame = {
      center: [4, 5, 6],
      normal: [0, 0, 1],
      tangent: [0, 0, 1],
    };
    expect(
      await h.api.invoke("sketch_manage", {
        action: "create",
        name: "Invalid",
        planeSourceId: "plane",
        expectedRevision: h.api.currentRevision(),
        requestId: "invalid-tangent",
      }),
    ).toMatchObject({ ok: false });
    expect(h.setAuthoring).toHaveBeenCalledOnce();
  } finally {
    h.api.dispose();
  }
});
it("rejects source placement arguments on non-create actions", async () => {
  const h = setup();
  try {
    await h.api.invoke("sketch_manage", {
      action: "create",
      name: "First",
      expectedRevision: h.api.currentRevision(),
      requestId: "first",
    });
    const sketchId = h.state.authoring.activeSketchId;
    expect(
      await h.api.invoke("sketch_manage", {
        action: "activate",
        sketchId,
        planeSourceId: "plane",
        expectedRevision: h.api.currentRevision(),
        requestId: "bad-activate",
      }),
    ).toMatchObject({ ok: false });
    expect(h.setAuthoring).toHaveBeenCalledOnce();
  } finally {
    h.api.dispose();
  }
});

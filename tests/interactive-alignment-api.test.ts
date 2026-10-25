import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createInteractiveOperations } from "../src/automation/interactive-alignment-operations";
import type { InteractiveAlignmentState } from "../src/interactive-alignment-session";
import type { CadClient } from "../src/cad/client";
import { createInteractiveEditor } from "../src/automation/interactive-editor";
import type { InteractiveMirrorBackend } from "../src/interactive-mirror-backend";
import { noiseNormals } from "../src/scan-native-noise";
const setup = () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const snapshot: WorkspaceSnapshot = {
    name: "Test",
    entities: [
      {
        id: "scan",
        name: "Scan",
        kind: "mesh",
        positions: source,
        normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
        color: "#aaa",
        opacity: 1,
        visible: true,
      },
    ],
    history: [],
    future: [],
    authoring: {},
    selectedId: "scan",
    selectedIds: ["scan"],
    selection: null,
    settings: {},
  };
  let state: InteractiveAlignmentState | null = null;
  const host: WorkspaceHost = {
    snapshot: () => snapshot,
    cad: () => ({}) as CadClient,
    busy: () => false,
    activity: vi.fn(),
    commit: (entities, label) => {
      snapshot.history.push({ entities: snapshot.entities, label });
      snapshot.entities = entities;
    },
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    publishInteractive: (next) => {
      state = next;
    },
    inspectInteractive: () => state,
    installInteractiveMirror: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
    discardPreview: vi.fn(() => {
      throw new Error(
        "Interactive cancellation must not call the unrelated GUI discard callback",
      );
    }),
  };
  const ops = createInteractiveOperations(host);
  const api = new ApplicationApi(host, {
    ...ops,
    object_select: vi.fn(),
    command_run: vi.fn(),
    command_repeat: vi.fn(),
  });
  const args = (requestId: string) => ({
    expectedRevision: api.currentRevision(),
    requestId,
  });
  const session = () => ({
    sessionId: state!.sessionId,
    expectedSessionVersion: state!.version,
  });
  return {
    host,
    api,
    snapshot,
    source,
    args,
    session,
    ops,
    get state() {
      return state;
    },
  };
};
it.each([true, false])(
  "uses computed mesh state for the shared interactive mirror source (stored=%s)",
  async (stored) => {
    const h = setup(),
      entity = h.snapshot.entities[0];
    entity.indexedMesh = {
      vertices: entity.positions,
      triangles: new Uint32Array([0, 1, 2]),
      normals: new Float32Array(9).fill(2),
      ...(stored ? { geometryNormals: new Float32Array(9).fill(0.25) } : {}),
    };
    try {
      const result = await h.api.invoke("interactive_alignment_edit", {
        action: "begin",
        parallel: false,
        ...h.args("normal-begin"),
      });
      expect(result.ok).toBe(true);
      const backend = vi
        .mocked(h.host.installInteractiveMirror!)
        .mock.calls.at(-1)![0] as InteractiveMirrorBackend;
      const source = await backend.source(entity.id);
      expect(source.normals).toEqual(
        entity.indexedMesh.geometryNormals ?? noiseNormals(entity.indexedMesh),
      );
      expect(entity.indexedMesh.normals).toEqual(new Float32Array(9).fill(2));
    } finally {
      h.api.dispose();
    }
  },
);

it("publishes the shared Interactive session over MCP with revision/session/retry protection and one Apply history entry", async () => {
  const h = setup();
  try {
    const begin = await h.api.invoke("interactive_alignment_edit", {
      action: "begin",
      parallel: false,
      ...h.args("begin"),
    });
    expect(begin).toMatchObject({
      ok: true,
      result: { active: true, entityIds: ["scan"] },
    });
    const initial = h.api.currentRevision();
    vi.mocked(h.host.activity).mockClear();
    const request = {
      action: "step",
      kind: "translatePositive",
      axis: 0,
      value: 1,
      ...h.session(),
      ...h.args("step"),
    };
    const first = await h.api.invoke("interactive_alignment_edit", request);
    expect(first).toMatchObject({ ok: true });
    expect(await h.api.invoke("interactive_alignment_edit", request)).toEqual(
      first,
    );
    expect(h.state!.targets[0].matrix[3]).toBe(1);
    expect(h.api.currentRevision()).toBe(initial);
    expect(h.snapshot.history).toHaveLength(0);
    expect(h.source[0]).toBe(0);
    expect(h.host.activity).not.toHaveBeenCalled();
    expect(
      await h.api.invoke("interactive_alignment_edit", {
        ...request,
        requestId: "stale",
      }),
    ).toMatchObject({ ok: false });
    const applyRequest = {
      ...h.session(),
      ...h.args("apply"),
      parallel: false,
    };
    const applied = await h.api.invoke(
      "interactive_alignment_apply",
      applyRequest,
    );
    expect(applied.ok).toBe(true);
    const jobId = (applied as any).result.jobId;
    let job: any;
    for (let i = 0; i < 50; i++) {
      job = await h.api.invoke("job_get", { jobId });
      if (job.result?.status !== "running") break;
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(job).toMatchObject({
      ok: true,
      result: {
        status: "succeeded",
        result: { applied: true, geometryBakedOnce: true },
      },
    });
    expect(h.snapshot.history).toHaveLength(1);
    expect(
      await h.api.invoke("interactive_alignment_apply", applyRequest),
    ).toEqual(applied);
    expect(h.snapshot.history).toHaveLength(1);
    expect(h.snapshot.history[0].label).toBe("Interactive alignment");
    expect(h.source[0]).toBe(0);
    expect(h.snapshot.entities[0].positions[0]).toBe(1);
    expect(await h.api.invoke("interactive_alignment_get", {})).toMatchObject({
      ok: true,
      result: { active: false },
    });
  } finally {
    h.api.dispose();
  }
});
it.each(["GUI", "MCP"])(
  "applies a multi-scan rotation/translation through %s while viewport measurements change",
  async (caller) => {
    const h = setup();
    h.snapshot.entities = [0, 1, 2].map((i) => ({
      ...h.snapshot.entities[0],
      id: `scan-${i}`,
      positions: new Float32Array(h.source),
    }));
    h.snapshot.selectedIds = h.snapshot.entities.map((e) => e.id);
    h.snapshot.selectedId = "scan-0";
    h.snapshot.settings = {
      automaticGrid: true,
      gridSpacing: 10,
      effectiveGridSpacing: 10,
      scale: { distanceMm: 20, widthPx: 80, reference: "view-center" },
    };
    const editor = createInteractiveEditor(h.api, () => h.state);
    try {
      await editor.edit({ action: "begin", parallel: false });
      await editor.edit({
        action: "step",
        kind: "rotatePositive",
        axis: 2,
        value: 90,
      });
      await editor.edit({
        action: "step",
        kind: "translatePositive",
        axis: 0,
        value: 3,
      });
      const revision = h.api.currentRevision();
      vi.mocked(h.host.activity).mockImplementation((running) => {
        if (running) {
          h.snapshot.settings.effectiveGridSpacing = 20;
          h.snapshot.settings.scale = {
            distanceMm: 50,
            widthPx: 95,
            reference: "view-center",
          };
        }
      });
      if (caller === "GUI") {
        expect(await editor.apply()).toMatchObject({
          applied: true,
          geometryBakedOnce: true,
        });
      } else {
        const request = {
          ...h.session(),
          ...h.args("viewport-apply"),
          parallel: false,
        };
        const receipt = await h.api.invoke(
          "interactive_alignment_apply",
          request,
        );
        expect(receipt.ok).toBe(true);
        let job: any;
        for (let i = 0; i < 50; i++) {
          job = await h.api.invoke("job_get", {
            jobId: (receipt as any).result.jobId,
          });
          if (job.result?.status !== "running") break;
          await new Promise((r) => setTimeout(r, 0));
        }
        expect(job).toMatchObject({
          ok: true,
          result: {
            status: "succeeded",
            result: { applied: true, geometryBakedOnce: true },
          },
        });
        expect(
          await h.api.invoke("interactive_alignment_apply", request),
        ).toEqual(receipt);
      }
      expect(h.api.currentRevision()).toBe(revision + 1);
      expect(h.snapshot.history).toHaveLength(1);
      expect(h.state).toBe(null);
      for (const entity of h.snapshot.entities) {
        expect(entity.positions[0]).toBeCloseTo(3);
        expect(entity.positions[3]).toBeCloseTo(3);
        expect(entity.positions[4]).toBeCloseTo(1);
        expect(entity.positions[6]).toBeCloseTo(2);
      }
      expect(h.source[0]).toBe(0);
    } finally {
      h.api.dispose();
    }
  },
);
it("rejects actual settings changes during Apply and preserves the preview and committed geometry", async () => {
  const h = setup();
  const editor = createInteractiveEditor(h.api, () => h.state);
  try {
    await editor.edit({ action: "begin", parallel: false });
    await editor.edit({
      action: "step",
      kind: "translatePositive",
      axis: 0,
      value: 1,
    });
    vi.mocked(h.host.activity).mockImplementation((running) => {
      if (running) h.snapshot.settings.gridSpacing = 50;
    });
    await expect(editor.apply()).rejects.toThrow(
      "Workspace changed while operation ran",
    );
    expect(h.snapshot.history).toHaveLength(0);
    expect(h.snapshot.entities[0].positions).toBe(h.source);
    expect(h.state?.changed).toBe(true);
  } finally {
    h.api.dispose();
  }
});
it("cancels Interactive through preview_discard without invoking another GUI preview callback", async () => {
  const h = setup();
  try {
    expect(
      (
        await h.api.invoke("interactive_alignment_edit", {
          action: "begin",
          parallel: false,
          ...h.args("begin-cancel"),
        })
      ).ok,
    ).toBe(true);
    expect(
      await h.api.invoke("preview_discard", {
        target: "interactive",
        ...h.args("cancel"),
      }),
    ).toMatchObject({ ok: true, result: { committedGeometryPreserved: true } });
    expect(h.host.discardPreview).not.toHaveBeenCalled();
    expect(h.state).toBe(null);
    expect(h.snapshot.history).toHaveLength(0);
    expect(h.source[0]).toBe(0);
  } finally {
    h.api.dispose();
  }
});
it("rejects unrelated model selection, launchers and preview cancellation while Interactive owns the preview", async () => {
  const h = setup();
  try {
    expect(
      (
        await h.api.invoke("interactive_alignment_edit", {
          action: "begin",
          parallel: false,
          ...h.args("begin-owned"),
        })
      ).ok,
    ).toBe(true);
    for (const [command, args] of [
      ["object_select", {}],
      ["command_run", { name: "ribbon:delete" }],
      ["command_repeat", {}],
      ["preview_discard", { target: "scan" }],
    ] as const) {
      expect(
        await h.api.invoke(command, { ...args, ...h.args(command) }),
      ).toMatchObject({ ok: false, error: { code: "BUSY" } });
    }
  } finally {
    h.api.dispose();
  }
});
it("advertises strict action variants and rejects unused or missing action parameters", async () => {
  const h = setup();
  try {
    for (const args of [
      { action: "begin", value: 1 },
      { action: "step", axis: 0, value: 1 },
      { action: "configure", strength: 101 },
      { action: "drag", handle: 0, from: [0.1, 0.1], to: [0.5, 0.5] },
    ])
      expect(
        await h.api.invoke("interactive_alignment_edit", {
          ...args,
          ...h.args(JSON.stringify(args)),
        }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  } finally {
    h.api.dispose();
  }
});

import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { createAuthoringOperations } from "../src/automation/authoring-operations";
import {
  decodeProjectFile,
  encodeProjectFileLocally,
} from "../src/project-file";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
  vi.useRealTimers();
});
function setup() {
  const state: WorkspaceSnapshot = {
    name: "Construction",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const display = vi.fn();
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("No CAD required");
    },
    commit: (entities, label) => {
      state.history.push({ entities: state.entities, label });
      state.entities = entities;
      state.future = [];
    },
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    undo: () => {
      const row = state.history.pop()!;
      state.future.push({ entities: state.entities, label: row.label });
      state.entities = row.entities;
    },
    redo: () => {
      const row = state.future.pop()!;
      state.history.push({ entities: state.entities, label: row.label });
      state.entities = row.entities;
    },
    busy: () => false,
    activity: vi.fn(),
    showReferenceConstructionPreview: display,
    inspectApplication: () => ({ previews: {} }),
  };
  const api = new ApplicationApi(host, {
    ...createOperations(host),
    ...createAuthoringOperations(host),
  });
  apis.push(api);
  const edit = (args: Record<string, unknown>) =>
    api.invoke("reference_construct", {
      ...args,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { api, state, host, display, edit };
}
async function value(
  result: ReturnType<ApplicationApi["invoke"]>,
): Promise<any> {
  const reply = await result;
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  return (reply as { result: unknown }).result;
}
it.each(["create", "activate"])(
  "keeps the reference preview when sketch %s competes for the editor",
  async (action) => {
    const { api, host, edit } = setup();
    host.setAuthoring = vi.fn();
    const preview = await value(
      edit({ action: "preview", kind: "point", position: [1, 2, 3] }),
    );
    const result = await api.invoke("sketch_manage", {
      action,
      name: "Competing sketch",
      sketchId: "missing",
      expectedRevision: api.currentRevision(),
      requestId: `sketch-${action}`,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "BUSY" } });
    expect(host.setAuthoring).not.toHaveBeenCalled();
    expect(
      await value(api.invoke("reference_construction_get", {})),
    ).toMatchObject({
      active: true,
      sessionId: preview.sessionId,
      version: preview.version,
    });
  },
);
it("previews and publishes an exact numeric point once, and restores all history after reopen", async () => {
  const { api, state, edit, display } = setup();
  const preview = await value(
    edit({ action: "preview", kind: "point", position: [-0, 2, 3] }),
  );
  expect(state.entities).toHaveLength(0);
  expect(state.history).toHaveLength(0);
  expect(preview).toMatchObject({
    active: true,
    geometry: { kind: "point", position: [-0, 2, 3] },
    units: "mm",
  });
  expect(display).toHaveBeenCalledOnce();
  const args = {
    action: "apply",
    sessionId: preview.sessionId,
    version: preview.version,
    expectedRevision: api.currentRevision(),
    requestId: "apply-once",
  };
  const first = await value(api.invoke("reference_construct", args));
  expect(await value(api.invoke("reference_construct", args))).toEqual(first);
  expect(state.entities).toHaveLength(1);
  expect(state.history).toHaveLength(1);
  expect(state.entities[0].reference!.geometry).toEqual({
    kind: "point",
    position: [-0, 2, 3],
  });
  await value(
    api.invoke("history_undo", {
      expectedRevision: api.currentRevision(),
      requestId: "undo",
    }),
  );
  expect(state.entities).toHaveLength(0);
  const restored = await decodeProjectFile(
    await encodeProjectFileLocally({
      project: {
        format: "maliev-scanforge",
        version: 1,
        units: "mm",
        name: state.name,
        entities: state.entities,
      },
      history: state.history,
      future: state.future,
    }),
  );
  expect(restored.future[0].entities[0].reference!.geometry).toEqual({
    kind: "point",
    position: [-0, 2, 3],
  });
  await value(
    api.invoke("history_redo", {
      expectedRevision: api.currentRevision(),
      requestId: "redo",
    }),
  );
  expect(state.entities[0].id).toBe(first.entityId);
});
it("shares numeric line edits, rejects stale versions, and cancels without history", async () => {
  const { api, state, edit } = setup();
  const initial = await value(
    edit({ action: "preview", kind: "line", start: [1, 2, 3], end: [5, 2, 3] }),
  );
  const changed = await value(
    edit({
      action: "preview",
      sessionId: initial.sessionId,
      version: initial.version,
      kind: "line",
      start: [1, 2, 3],
      end: [7, 2, 3],
    }),
  );
  expect(changed.geometry).toEqual({
    kind: "line",
    start: [1, 2, 3],
    direction: [1, 0, 0],
    length: 6,
  });
  expect(
    (
      await edit({
        action: "apply",
        sessionId: initial.sessionId,
        version: initial.version,
      })
    ).ok,
  ).toBe(false);
  expect(state.history).toHaveLength(0);
  await value(
    edit({
      action: "cancel",
      sessionId: changed.sessionId,
      version: changed.version,
    }),
  );
  expect(
    await value(api.invoke("reference_construction_get", {})),
  ).toMatchObject({ active: false });
  expect(state.entities).toHaveLength(0);
});
it("rejects locked edits, malformed coordinates, and foreign cancellation atomically", async () => {
  const { state, edit } = setup();
  expect(
    (await edit({ action: "preview", kind: "point", position: [1, 2] })).ok,
  ).toBe(false);
  const initial = await value(
    edit({ action: "preview", kind: "point", position: [1, 2, 3] }),
  );
  expect(
    (await edit({ action: "cancel", sessionId: "foreign", version: 1 })).ok,
  ).toBe(false);
  await value(
    edit({
      action: "apply",
      sessionId: initial.sessionId,
      version: initial.version,
    }),
  );
  state.entities[0] = { ...state.entities[0], locked: true };
  expect(
    (
      await edit({
        action: "preview",
        kind: "point",
        entityId: state.entities[0].id,
        position: [3, 4, 5],
      })
    ).ok,
  ).toBe(false);
  expect(state.history).toHaveLength(1);
});
it("invalidates a preview on model changes and expires it without committing", async () => {
  vi.useFakeTimers();
  const { api, state, edit } = setup();
  const initial = await value(
    edit({ action: "preview", kind: "point", position: [1, 2, 3] }),
  );
  state.name = "Changed project";
  expect(
    (
      await edit({
        action: "apply",
        sessionId: initial.sessionId,
        version: initial.version,
      })
    ).ok,
  ).toBe(false);
  expect(
    await value(api.invoke("reference_construction_get", {})),
  ).toMatchObject({ active: false, reason: "stale" });
  await value(edit({ action: "preview", kind: "point", position: [4, 5, 6] }));
  await vi.advanceTimersByTimeAsync(60001);
  expect(
    await value(api.invoke("reference_construction_get", {})),
  ).toMatchObject({ active: false, reason: "expired" });
  expect(state.history).toHaveLength(0);
});
it("reports accepted geometry separately from failed display cleanup and retries owner cleanup", async () => {
  const { state, edit, display } = setup();
  const preview = await value(
    edit({ action: "preview", kind: "point", position: [1, 2, 3] }),
  );
  let failures = 2;
  display.mockImplementation((_owner, candidate) => {
    if (!candidate && failures-- > 0) throw Error("GPU cleanup");
  });
  expect(
    await value(
      edit({
        action: "apply",
        sessionId: preview.sessionId,
        version: preview.version,
      }),
    ),
  ).toMatchObject({ cleanupPending: true, cleanupError: "GPU cleanup" });
  expect(
    (
      await edit({
        action: "cancel",
        sessionId: preview.sessionId,
        version: preview.version,
      })
    ).ok,
  ).toBe(false);
  await value(
    edit({
      action: "cancel",
      sessionId: preview.sessionId,
      version: preview.version,
    }),
  );
  expect(state.entities).toHaveLength(1);
  expect(state.history).toHaveLength(1);
  expect(display.mock.calls.filter((row) => row[1] === null)).toHaveLength(3);
});
it("rejects ambiguous parameters and zero-length lines before preview allocation", async () => {
  const { state, display, edit } = setup();
  for (const args of [
    { kind: "point", position: [1, 2, 3], end: [4, 5, 6] },
    { kind: "line", start: [0, 0, 0], end: [0, 0, 0] },
    { kind: "point", position: [1e10, 2, 3] },
    { kind: "point", position: [1, 2, 3], version: 1 },
  ])
    expect((await edit({ action: "preview", ...args })).ok).toBe(false);
  expect(display).not.toHaveBeenCalled();
  expect(state.history).toHaveLength(0);
});
it("retains inactive line pick records when editing numeric endpoints", async () => {
  const { state, edit } = setup();
  const initial = await value(
    edit({
      action: "preview",
      kind: "line",
      start: [0, 0, 0],
      end: [10, 0, 0],
    }),
  );
  const accepted = await value(
    edit({
      action: "apply",
      sessionId: initial.sessionId,
      version: initial.version,
    }),
  );
  const entity = state.entities[0];
  if (entity.reference!.definition.kind !== "line")
    throw Error("Expected line");
  const records = [
    {
      entityId: "inactive",
      storage: "native-pick-record-f32" as const,
      coordinates: [-0, 2, 3] as const,
    },
  ];
  entity.reference!.definition = { ...entity.reference!.definition, records };
  const changed = await value(
    edit({
      action: "preview",
      kind: "line",
      entityId: accepted.entityId,
      start: [1, 0, 0],
      end: [11, 0, 0],
    }),
  );
  expect(changed.definition.records).toEqual(records);
  const updated = await value(
    edit({
      action: "preview",
      kind: "line",
      sessionId: changed.sessionId,
      version: changed.version,
      start: [2, 0, 0],
      end: [12, 0, 0],
    }),
  );
  await value(
    edit({
      action: "apply",
      sessionId: updated.sessionId,
      version: updated.version,
    }),
  );
  expect(state.entities[0].reference!.definition).toMatchObject({ records });
});

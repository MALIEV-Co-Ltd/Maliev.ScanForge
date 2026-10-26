import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import {
  assertReferenceWorkspaceAdmission,
  inspectReferenceEntity,
} from "../src/reference-entity";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";
import {
  serializeProject,
  serializeProjectBlob,
  parseProject,
} from "../src/io";
import type { Entity } from "../src/types";
import { objectContextActions } from "../src/ui/object-context-actions";

const apis: ApplicationApi[] = [];
afterEach(() => {
  for (const api of apis.splice(0)) api.dispose();
});
const line = (): Entity => ({
  id: "line",
  name: "Line",
  kind: "referenceLine",
  positions: [],
  color: "#ffffff",
  opacity: 1,
  visible: true,
  constructionOrderKey: "01".repeat(16),
  reference: {
    version: 1,
    definition: {
      version: 1,
      kind: "line",
      mode: "endpoints",
      start: [2, 4, 6],
      end: [10, 4, 6],
      sources: [],
      records: [],
    },
    geometry: {
      kind: "line",
      start: [2, 4, 6],
      direction: [1, 0, 0],
      length: 8,
    },
    evaluation: { completionWord: 0x100 },
  },
});
function setup(entities = [line()]) {
  const state: WorkspaceSnapshot = {
    name: "Midpoint",
    entities,
    history: [],
    future: [],
    authoring: {},
    settings: {},
    selectedId: null,
    selection: null,
  };
  const commit = vi.fn<WorkspaceHost["commit"]>((next, label) => {
    state.history.push({ entities: state.entities, label });
    state.entities = next;
    state.future = [];
  });
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => {
      throw Error("No kernel");
    },
    commit,
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
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
    showReferenceConstructionPreview: vi.fn(),
    inspectApplication: () => ({ previews: {} }),
  };
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  const command = (args: Record<string, unknown>) =>
    api.invoke("reference_construct", {
      ...args,
      expectedRevision: api.currentRevision(),
      requestId: crypto.randomUUID(),
    });
  return { state, host, api, command, commit };
}
async function value(
  promise: ReturnType<ApplicationApi["invoke"]>,
): Promise<any> {
  const reply = await promise;
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  if (!reply.ok) throw Error(reply.error.message);
  return reply.result;
}
async function createMidpoint(h: ReturnType<typeof setup>) {
  const preview = await value(
    h.command({
      action: "preview",
      kind: "point",
      mode: "midpoint",
      sourceEntityId: "line",
    }),
  );
  const result = await value(
    h.command({
      action: "apply",
      sessionId: preview.sessionId,
      version: preview.version,
    }),
  );
  return { preview, result };
}
it("disables unavailable reference duplication in the GUI and rejects it through MCP without changing history", async () => {
  const h = setup();
  await createMidpoint(h);
  h.commit.mockClear();
  const before = h.state.entities;
  const history = [...h.state.history];
  const revision = h.api.currentRevision();
  const handlers = {
    properties: vi.fn(),
    duplicate: vi.fn(),
    rename: vi.fn(),
    visibility: vi.fn(),
    selectable: vi.fn(),
    lock: vi.fn(),
    edit: vi.fn(),
    remove: vi.fn(),
  };
  for (const entity of before) {
    expect(
      await h.api.invoke("object_duplicate", {
        entityId: entity.id,
        expectedRevision: revision,
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({
      ok: false,
      revision,
      error: {
        code: "OPERATION_FAILED",
        message: "Reference construction duplication is not yet supported.",
      },
    });
    expect(
      objectContextActions(entity, false, handlers).find(
        (action) => action.label === "Duplicate",
      )?.disabled,
    ).toBe(true);
  }
  expect(h.state.entities).toBe(before);
  expect(h.state.history).toEqual(history);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.commit).not.toHaveBeenCalled();
});
it("publishes only a successful semantic-line midpoint with active provenance and no source migration", async () => {
  const h = setup();
  const source = h.state.entities[0];
  const { preview, result } = await createMidpoint(h);
  expect(preview).toMatchObject({
    geometry: { kind: "point", position: [6, 4, 6] },
    outcome: "updated",
    diagnostics: { reason: "center", sourceCount: 1 },
  });
  expect(result.assignedSources).toEqual([]);
  expect(h.state.entities[0]).toBe(source);
  const midpoint = h.state.entities.find((e) => e.id === result.entityId)!;
  expect(midpoint.reference).toMatchObject({
    definition: {
      mode: "center",
      sources: [
        { id: "line", constructionOrderKey: source.constructionOrderKey },
      ],
    },
    geometry: { position: [6, 4, 6] },
    evaluation: { completionWord: 0x100 },
  });
  expect(
    inspectReferenceEntity(midpoint, h.state.entities)?.reference
      .sourceBindings,
  ).toEqual([
    {
      id: "line",
      constructionOrderKey: source.constructionOrderKey,
      status: "identity-matched",
    },
  ]);
  expect(h.commit).toHaveBeenCalledOnce();
});
it("refreshes the dependent midpoint in the same numeric-line history step, with undo and redo", async () => {
  const h = setup();
  const { result } = await createMidpoint(h);
  const before = h.state.entities;
  const preview = await value(
    h.command({
      action: "preview",
      kind: "line",
      entityId: "line",
      start: [4, 4, 6],
      end: [20, 4, 6],
    }),
  );
  await value(
    h.command({
      action: "apply",
      sessionId: preview.sessionId,
      version: preview.version,
    }),
  );
  const after = h.state.entities;
  expect(
    after.find((e) => e.id === result.entityId)!.reference!.geometry,
  ).toEqual({ kind: "point", position: [12, 4, 6] });
  expect(h.state.history).toHaveLength(2);
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "undo",
    }),
  );
  expect(h.state.entities).toEqual(before);
  await value(
    h.api.invoke("history_redo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "redo",
    }),
  );
  expect(h.state.entities).toEqual(after);
});
it("persists the admitted midpoint recipe in current and undo/redo states through JSON and binary reopen", async () => {
  const h = setup();
  await createMidpoint(h);
  const project = {
    format: "maliev-scanforge" as const,
    version: 1 as const,
    name: "Midpoint",
    units: "mm" as const,
    entities: h.state.entities,
  };
  const session = {
    project,
    history: h.state.history,
    future: [{ entities: h.state.entities, label: "Retained" }],
  };
  expect(() => assertReferenceWorkspaceAdmission(session)).not.toThrow();
  for (const text of [
    serializeProject(project.name, project.entities),
    await (await serializeProjectBlob(project.name, project.entities)).text(),
  ]) {
    const reopened = parseProject(text);
    expect(reopened.entities).toEqual(project.entities);
    expect(() =>
      assertReferenceWorkspaceAdmission({
        project: reopened,
        history: [],
        future: [],
      }),
    ).not.toThrow();
  }
  const reopened = await decodeProjectContents(
    await encodeProjectFileLocally(session),
  );
  expect(() => assertReferenceWorkspaceAdmission(reopened)).not.toThrow();
  expect(reopened.project.entities).toEqual(session.project.entities);
  expect(reopened.history).toEqual(session.history);
  expect(reopened.future).toEqual(session.future);
});
it.each([
  { sourceEntityId: "missing" },
  { sourceEntityId: "line", position: [0, 0, 0] },
  { sourceEntityId: "line", start: [0, 0, 0] },
])(
  "rejects invalid midpoint selection without preview or mutation: %j",
  async (args) => {
    const h = setup();
    expect(
      await h.command({
        action: "preview",
        kind: "point",
        mode: "midpoint",
        ...args,
      }),
    ).toMatchObject({ ok: false });
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.host.showReferenceConstructionPreview).not.toHaveBeenCalled();
  },
);
it("rejects arbitrary fitted/CAD families and malformed semantic source keys", async () => {
  for (const entity of [
    {
      ...line(),
      id: "line",
      kind: "plane" as const,
      reference: undefined,
      planeFrame: {
        center: [0, 0, 0] as [number, number, number],
        normal: [0, 0, 1] as [number, number, number],
        tangent: [1, 0, 0] as [number, number, number],
      },
    },
    { ...line(), constructionOrderKey: undefined },
  ]) {
    const h = setup([entity]);
    expect(
      await h.command({
        action: "preview",
        kind: "point",
        mode: "midpoint",
        sourceEntityId: "line",
      }),
    ).toMatchObject({ ok: false });
    expect(h.commit).not.toHaveBeenCalled();
  }
});
it("rejects source edits atomically when their midpoint is locked and leaves the cached preview available", async () => {
  const h = setup();
  const { result } = await createMidpoint(h);
  h.state.entities = h.state.entities.map((e) =>
    e.id === result.entityId ? { ...e, locked: true } : e,
  );
  const before = h.state.entities;
  const preview = await value(
    h.command({
      action: "preview",
      kind: "line",
      entityId: "line",
      start: [0, 0, 0],
      end: [20, 0, 0],
    }),
  );
  expect(
    await h.command({
      action: "apply",
      sessionId: preview.sessionId,
      version: preview.version,
    }),
  ).toMatchObject({ ok: false });
  expect(h.state.entities).toBe(before);
  expect(h.commit).toHaveBeenCalledOnce();
  expect(
    await value(h.api.invoke("reference_construction_get", {})),
  ).toMatchObject({ active: true, sessionId: preview.sessionId });
});
it("rejects deletion of a line with surviving midpoint dependents explicitly", async () => {
  const h = setup();
  await createMidpoint(h);
  const before = h.state.entities;
  const revision = h.api.currentRevision();
  const reply = await h.api.invoke("object_delete", {
    entityId: "line",
    expectedRevision: h.api.currentRevision(),
    requestId: "delete-line",
  });
  expect(reply).toMatchObject({
    ok: false,
    error: { message: expect.stringMatching(/dependent/i) },
  });
  expect(h.state.entities).toBe(before);
  expect(h.api.currentRevision()).toBe(revision);
  expect(h.commit).toHaveBeenCalledOnce();
});
it("deletes a leaf midpoint and then its source as separate reversible model edits", async () => {
  const h = setup();
  const { result } = await createMidpoint(h);
  const before = h.state.entities;
  const midpoint = before.find((entity) => entity.id === result.entityId)!;
  const source = before.find((entity) => entity.id === "line")!;
  await value(
    h.api.invoke("object_delete", {
      entityId: midpoint.id,
      expectedRevision: h.api.currentRevision(),
      requestId: "delete-leaf",
    }),
  );
  expect(h.state.entities).toEqual([source]);
  expect(h.state.entities[0]).toBe(source);
  expect(h.commit).toHaveBeenCalledTimes(2);
  const after = h.state.entities;
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "undo-delete-leaf",
    }),
  );
  expect(h.state.entities).toBe(before);
  expect(h.state.entities.find((entity) => entity.id === midpoint.id)).toBe(
    midpoint,
  );
  await value(
    h.api.invoke("history_redo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "redo-delete-leaf",
    }),
  );
  expect(h.state.entities).toBe(after);
  await value(
    h.api.invoke("object_delete", {
      entityId: source.id,
      expectedRevision: h.api.currentRevision(),
      requestId: "delete-orphan-source",
    }),
  );
  expect(h.state.entities).toEqual([]);
  expect(h.commit).toHaveBeenCalledTimes(3);
});
it("deletes a source and its midpoint atomically with exact model undo/redo and one retry receipt", async () => {
  const h = setup();
  const { result } = await createMidpoint(h);
  const before = h.state.entities;
  const args = {
    entityIds: ["line", result.entityId],
    expectedRevision: h.api.currentRevision(),
    requestId: "delete-reference-family",
  };
  const removed = await value(h.api.invoke("object_delete", args));
  expect(removed.entityIds).toEqual(args.entityIds);
  expect(h.state.entities).toEqual([]);
  expect(h.state.history).toHaveLength(2);
  const after = h.state.entities;
  expect(await value(h.api.invoke("object_delete", args))).toEqual(removed);
  expect(h.commit).toHaveBeenCalledTimes(2);
  await value(
    h.api.invoke("history_undo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "undo-delete-family",
    }),
  );
  expect(h.state.entities).toBe(before);
  for (const entity of before) {
    expect(h.state.entities.find((item) => item.id === entity.id)).toBe(entity);
    expect(
      h.state.entities.find((item) => item.id === entity.id)!.reference,
    ).toBe(entity.reference);
  }
  await value(
    h.api.invoke("history_redo", {
      expectedRevision: h.api.currentRevision(),
      requestId: "redo-delete-family",
    }),
  );
  expect(h.state.entities).toBe(after);
});
it.each(["source", "midpoint"])(
  "rejects family deletion atomically when the %s is locked",
  async (locked) => {
    const h = setup();
    const { result } = await createMidpoint(h);
    const lockedId = locked === "source" ? "line" : result.entityId;
    h.state.entities = h.state.entities.map((entity) =>
      entity.id === lockedId ? { ...entity, locked: true } : entity,
    );
    const before = h.state.entities;
    const revision = h.api.currentRevision();
    expect(
      await h.api.invoke("object_delete", {
        entityIds: ["line", result.entityId],
        expectedRevision: revision,
        requestId: `delete-locked-${locked}`,
      }),
    ).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/locked/i) },
    });
    expect(h.state.entities).toBe(before);
    expect(h.api.currentRevision()).toBe(revision);
    expect(h.state.history).toHaveLength(1);
    expect(h.commit).toHaveBeenCalledOnce();
  },
);
it("unlinks a midpoint switched to coordinates so later source edits preserve it", async () => {
  const h = setup();
  const { result } = await createMidpoint(h);
  const point = await value(
    h.command({
      action: "preview",
      kind: "point",
      entityId: result.entityId,
      position: [9, 8, 7],
    }),
  );
  await value(
    h.command({
      action: "apply",
      sessionId: point.sessionId,
      version: point.version,
    }),
  );
  const root = await value(
    h.command({
      action: "preview",
      kind: "line",
      entityId: "line",
      start: [0, 0, 0],
      end: [20, 0, 0],
    }),
  );
  await value(
    h.command({
      action: "apply",
      sessionId: root.sessionId,
      version: root.version,
    }),
  );
  expect(
    h.state.entities.find((e) => e.id === result.entityId)!.reference,
  ).toMatchObject({
    definition: { mode: "coordinates", sources: [] },
    geometry: { position: [9, 8, 7] },
  });
});
it("keeps retry receipts, cancellation and non-preview source-field rejection in the shared lifecycle", async () => {
  const h = setup();
  const preview = await value(
    h.command({
      action: "preview",
      kind: "point",
      mode: "midpoint",
      sourceEntityId: "line",
    }),
  );
  expect(
    await h.command({
      action: "apply",
      sessionId: preview.sessionId,
      version: preview.version,
      sourceEntityId: "line",
    }),
  ).toMatchObject({ ok: false });
  await value(
    h.command({
      action: "cancel",
      sessionId: preview.sessionId,
      version: preview.version,
    }),
  );
  expect(h.commit).not.toHaveBeenCalled();
  const next = await value(
    h.command({
      action: "preview",
      kind: "point",
      mode: "midpoint",
      sourceEntityId: "line",
    }),
  );
  const args = {
    action: "apply",
    sessionId: next.sessionId,
    version: next.version,
    expectedRevision: h.api.currentRevision(),
    requestId: "midpoint-once",
  };
  const first = await value(h.api.invoke("reference_construct", args));
  expect(await value(h.api.invoke("reference_construct", args))).toEqual(first);
  expect(h.commit).toHaveBeenCalledOnce();
});
it("invalidates a captured midpoint when its source changes and rejects self/cross-family selections", async () => {
  const h = setup();
  const preview = await value(
    h.command({
      action: "preview",
      kind: "point",
      mode: "midpoint",
      sourceEntityId: "line",
    }),
  );
  h.state.entities = [{ ...line(), name: "Changed source" }];
  expect(
    await h.command({
      action: "apply",
      sessionId: preview.sessionId,
      version: preview.version,
    }),
  ).toMatchObject({ ok: false });
  expect(h.commit).not.toHaveBeenCalled();
  expect(
    await h.command({
      action: "preview",
      kind: "line",
      mode: "midpoint",
      sourceEntityId: "line",
    }),
  ).toMatchObject({ ok: false });
});
it("rebinds a midpoint to a different stored line without copying its source key", async () => {
  const first = line(),
    second = { ...line(), id: "second", constructionOrderKey: "03".repeat(16) };
  second.reference = structuredClone(second.reference!);
  second.reference.geometry = {
    kind: "line",
    start: [10, 0, 0],
    direction: [1, 0, 0],
    length: 20,
  };
  const h = setup([first, second]);
  const { result } = await createMidpoint(h);
  const preview = await value(
    h.command({
      action: "preview",
      kind: "point",
      entityId: result.entityId,
      mode: "midpoint",
      sourceEntityId: "second",
    }),
  );
  await value(
    h.command({
      action: "apply",
      sessionId: preview.sessionId,
      version: preview.version,
    }),
  );
  const child = h.state.entities.find(
    (entity) => entity.id === result.entityId,
  )!;
  expect(child.reference).toMatchObject({
    definition: {
      sources: [
        { id: "second", constructionOrderKey: second.constructionOrderKey },
      ],
    },
    geometry: { position: [20, 0, 0] },
  });
  expect(child.constructionOrderKey).not.toBe(second.constructionOrderKey);
});
it("preserves numeric Apply in scenes with more than 10000 unrelated objects", async () => {
  const entities: Entity[] = Array.from({ length: 10001 }, (_, index) => ({
    id: `unrelated-${index}`,
    name: "Unrelated",
    kind: "mesh",
    positions: [],
    color: "#ffffff",
    opacity: 1,
    visible: true,
  }));
  const h = setup(entities);
  const preview = await value(
    h.command({ action: "preview", kind: "point", position: [1, 2, 3] }),
  );
  const result = await value(
    h.command({
      action: "apply",
      sessionId: preview.sessionId,
      version: preview.version,
    }),
  );
  expect(result.refreshedEntityIds).toEqual([]);
  expect(h.state.entities).toHaveLength(10002);
  expect(h.state.entities.slice(0, 10001)).toEqual(entities);
  expect(h.commit).toHaveBeenCalledOnce();
});
it.each([9999, 10000])(
  "admits midpoint creation by prospective scene size from %i existing objects",
  async (count) => {
    const unrelated: Entity[] = Array.from(
      { length: count - 1 },
      (_, index) => ({
        id: `mesh-${index}`,
        name: "Unrelated",
        kind: "mesh",
        positions: [],
        color: "#ffffff",
        opacity: 1,
        visible: true,
      }),
    );
    const h = setup([line(), ...unrelated]);
    if (count === 10000) {
      expect(
        await h.command({
          action: "preview",
          kind: "point",
          mode: "midpoint",
          sourceEntityId: "line",
        }),
      ).toMatchObject({
        ok: false,
        error: { message: expect.stringMatching(/scene limit/i) },
      });
      expect(h.host.showReferenceConstructionPreview).not.toHaveBeenCalled();
      expect(h.commit).not.toHaveBeenCalled();
      expect(h.state.entities).toHaveLength(count);
      return;
    }
    const { result } = await createMidpoint(h);
    expect(h.state.entities).toHaveLength(10000);
    const preview = await value(
      h.command({
        action: "preview",
        kind: "line",
        entityId: "line",
        start: [0, 0, 0],
        end: [20, 0, 0],
      }),
    );
    const edit = await value(
      h.command({
        action: "apply",
        sessionId: preview.sessionId,
        version: preview.version,
      }),
    );
    expect(edit.refreshedEntityIds).toEqual([result.entityId]);
    expect(
      h.state.entities.find((entity) => entity.id === result.entityId)!
        .reference!.geometry,
    ).toEqual({ kind: "point", position: [10, 0, 0] });
  },
);
it("keeps a numeric preview when switching a new destination to midpoint would exceed the scene limit", async () => {
  const unrelated: Entity[] = Array.from({ length: 9999 }, (_, index) => ({
    id: `mesh-${index}`,
    name: "Unrelated",
    kind: "mesh",
    positions: [],
    color: "#ffffff",
    opacity: 1,
    visible: true,
  }));
  const h = setup([line(), ...unrelated]);
  const preview = await value(
    h.command({ action: "preview", kind: "point", position: [1, 2, 3] }),
  );
  expect(
    await h.command({
      action: "preview",
      kind: "point",
      mode: "midpoint",
      sourceEntityId: "line",
      sessionId: preview.sessionId,
      version: preview.version,
    }),
  ).toMatchObject({ ok: false });
  expect(
    await value(h.api.invoke("reference_construction_get", {})),
  ).toMatchObject({
    active: true,
    sessionId: preview.sessionId,
    version: preview.version,
    definition: { mode: "coordinates" },
  });
  expect(h.commit).not.toHaveBeenCalled();
});

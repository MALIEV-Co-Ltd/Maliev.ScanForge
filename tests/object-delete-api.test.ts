import { afterEach, expect, it } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import {
  resolveKeyboardShortcut,
  type ShortcutActionId,
  type ShortcutContext,
} from "../src/keyboard-shortcuts";
import { shortcutReference } from "../src/ui/shortcut-reference";

const apis: ApplicationApi[] = [];
afterEach(() => apis.splice(0).forEach((api) => api.dispose()));

it("preserves retained dependent features without partially deleting the batch", async () => {
  const { api, state } = setup();
  state.entities[0].parametric = {
    output: 0,
    feature: {
      id: "source",
      name: "Source",
      recipe: { kind: "importBrep", brep: "fixture" },
    },
  };
  state.entities[2].parametric = {
    output: 0,
    feature: {
      id: "dependent",
      name: "Dependent",
      recipe: {
        kind: "transform",
        source: { featureId: "source" },
        translation: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
      },
    },
  };
  const original = state.entities;
  expect(
    await api.invoke("object_delete", {
      expectedRevision: 0,
      requestId: "dependent",
    }),
  ).toMatchObject({ ok: false });
  expect(state.entities).toBe(original);
  expect(state.history).toHaveLength(0);
  expect(
    await api.invoke("object_delete", {
      entityIds: ["a", "b", "c"],
      expectedRevision: 0,
      requestId: "whole-dependency-set",
    }),
  ).toMatchObject({ ok: true });
  expect(state.entities).toEqual([]);
  expect(state.history).toHaveLength(1);
});
function setup() {
  const state: WorkspaceSnapshot = {
    name: "Delete",
    entities: ["a", "b", "c"].map((id) => ({
      id,
      name: id,
      kind: "mesh",
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      visible: true,
      color: "#ffffff",
      opacity: 1,
    })),
    selectedId: "b",
    selectedIds: ["a", "b"],
    history: [],
    future: [],
    authoring: {},
    selection: null,
    settings: {},
  };
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => ({}) as CadClient,
    commit: (entities, label) => {
      state.history.push({ entities: state.entities, label });
      state.entities = entities;
      state.future = [];
    },
    undo: () => {
      const previous = state.history.pop();
      if (previous) {
        state.future.unshift({
          entities: state.entities,
          label: previous.label,
        });
        state.entities = previous.entities;
      }
    },
    redo: () => {},
    replace: () => {},
    select: () => {},
    setSelection: () => {},
    setSketch: () => {},
    view: () => {},
    settings: () => {},
    busy: () => false,
    activity: () => {},
  };
  const api = new ApplicationApi(host, createOperations(host));
  apis.push(api);
  return { api, state, host };
}

it("registers Delete for object selection, with the shared reference and typing/dialog safeguards", () => {
  const context: ShortcutContext = {
    mode: "main",
    allowExtensions: true,
    availableActions: new Set(["delete-objects"] as ShortcutActionId[]),
  };
  expect(resolveKeyboardShortcut({ key: "Delete" }, context)).toEqual({
    id: "delete-objects",
  });
  expect(shortcutReference(context)).toContainEqual(
    expect.objectContaining({
      label: "Delete selected objects",
      keys: ["Delete"],
      enabled: true,
    }),
  );
  for (const blocked of [
    { textEditing: true },
    { modalOpen: true },
    { busy: true },
    { mode: "sketch" as const },
    { mode: "selection" as const },
    { availableActions: new Set<ShortcutActionId>() },
  ])
    expect(
      resolveKeyboardShortcut({ key: "Delete" }, { ...context, ...blocked }),
    ).toBeNull();
  for (const event of [
    { key: "Delete", repeat: true },
    { key: "Delete", ctrlKey: true },
    { key: "Backspace" },
  ])
    expect(resolveKeyboardShortcut(event, context)).toBeNull();
});

it("deletes the complete selection atomically through MCP, retries once and undoes in one step", async () => {
  const { api, state } = setup();
  const original = state.entities;
  const args = {
    expectedRevision: api.currentRevision(),
    requestId: "delete-selected",
  };
  const result = await api.invoke("object_delete", args);
  expect(result).toMatchObject({ ok: true, result: { entityIds: ["a", "b"] } });
  expect(state.entities.map((e) => e.id)).toEqual(["c"]);
  expect(state.entities[0]).toBe(original[2]);
  expect(state.history).toHaveLength(1);
  expect(await api.invoke("object_delete", args)).toEqual(result);
  expect(state.history).toHaveLength(1);
  expect(
    await api.invoke("history_undo", {
      expectedRevision: api.currentRevision(),
      requestId: "undo-delete",
    }),
  ).toMatchObject({ ok: true });
  expect(state.entities).toBe(original);
});

it.each([{ entityId: "a" }, { entityIds: ["a"] }])(
  "retains explicit single-object deletion: %j",
  async (target) => {
    const { api, state } = setup();
    expect(
      await api.invoke("object_delete", {
        ...target,
        expectedRevision: 0,
        requestId: "single",
      }),
    ).toMatchObject({ ok: true, result: { entityId: "a", entityIds: ["a"] } });
    expect(state.entities.map((e) => e.id)).toEqual(["b", "c"]);
  },
);

it.each([
  { entityIds: [] },
  { entityIds: ["a", "missing"] },
  { entityIds: ["a", "a"] },
  { entityIds: ["a"], entityId: "b" },
])("rejects invalid batches without partial deletion: %j", async (target) => {
  const { api, state } = setup();
  const original = state.entities;
  expect(
    await api.invoke("object_delete", {
      ...target,
      expectedRevision: 0,
      requestId: "invalid",
    }),
  ).toMatchObject({ ok: false });
  expect(state.entities).toBe(original);
  expect(state.history).toHaveLength(0);
});

it.each(["locked", "stale", "busy", "empty"])(
  "rejects %s selection deletion without mutation",
  async (reason) => {
    const { api, state, host } = setup();
    const original = state.entities;
    if (reason === "locked") state.entities[1].locked = true;
    if (reason === "busy") host.busy = () => true;
    if (reason === "empty") {
      state.selectedIds = [];
      state.selectedId = null;
    }
    expect(
      await api.invoke("object_delete", {
        expectedRevision: reason === "stale" ? 999 : 0,
        requestId: "blocked",
      }),
    ).toMatchObject({ ok: false });
    expect(state.entities).toBe(original);
    expect(state.history).toHaveLength(0);
  },
);

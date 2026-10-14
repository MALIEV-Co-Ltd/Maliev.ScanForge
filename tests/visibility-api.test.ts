import { expect, it } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import { modelChanged } from "../src/history";

it("publishes selected-object visibility through MCP with existing display-history semantics and idempotent retry", async () => {
  const state: WorkspaceSnapshot = {
    name: "Visibility",
    entities: ["a", "b"].map((id) => ({
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
      if (modelChanged(state.entities, entities))
        state.history.push({ entities: state.entities, label });
      state.entities = entities;
    },
    replace: () => {},
    select: () => {},
    setSelection: () => {},
    setSketch: () => {},
    undo: () => {},
    redo: () => {},
    view: () => {},
    settings: () => {},
    busy: () => false,
    activity: () => {},
  };
  const api = new ApplicationApi(host, createOperations(host));
  try {
    const args = {
      expectedRevision: api.currentRevision(),
      requestId: "toggle-once",
    };
    const first = await api.invoke("object_visibility_toggle", args);
    expect(first).toMatchObject({
      ok: true,
      result: {
        objects: [
          { entityId: "a", visible: false },
          { entityId: "b", visible: false },
        ],
      },
    });
    expect(await api.invoke("object_visibility_toggle", args)).toEqual(first);
    expect(state.history).toHaveLength(0);
    expect(state.selectedIds).toEqual(["a", "b"]);
    expect(
      await api.invoke("object_visibility_toggle", {
        expectedRevision: api.currentRevision(),
        requestId: "bad-target",
        entityIds: ["missing"],
      }),
    ).toMatchObject({ ok: false });
    expect(state.history).toHaveLength(0);
  } finally {
    api.dispose();
  }
});

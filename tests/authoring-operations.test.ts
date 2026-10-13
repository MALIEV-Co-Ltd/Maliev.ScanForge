import { it, expect, vi } from "vitest";
import { createAuthoringOperations } from "../src/automation/authoring-operations";
import { createGridPatch, evaluatePatch } from "../src/surfaces";
import type {
  WorkspaceSnapshot,
  WorkspaceHost,
  CommandContext,
} from "../src/automation/api";
import type { CadClient } from "../src/cad/client";
function setup() {
  const patch = createGridPatch();
  const state: WorkspaceSnapshot = {
    name: "Test",
    entities: [
      {
        id: "surface",
        name: "Surface",
        kind: "mesh",
        color: "#ffffff",
        opacity: 1,
        visible: true,
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        surfacePatch: patch,
      },
    ],
    history: [],
    future: [],
    authoring: {},
    selectedId: "surface",
    selection: new Uint8Array([1]),
    settings: {},
  };
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => ({}) as CadClient,
    commit: (next) => {
      state.entities = next;
    },
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: (_id, mask) => {
      state.selection = mask;
    },
    setSketch: vi.fn(),
    setAuthoring: (authoring) => {
      state.authoring = authoring;
    },
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
  };
  const context: CommandContext = {
    signal: new AbortController().signal,
    progress: vi.fn(),
    check: vi.fn(),
    artifact: (_data, name, mime) => ({
      artifactId: "result",
      name,
      mime,
      bytes: 1,
    }),
    artifactBlob: () => new Blob(),
  };
  return { state, host, context, ops: createAuthoringOperations(host), patch };
}
it("requires explicit discard for a new project and prevents selecting locked objects", () => {
  const { ops, context, state, host } = setup();
  expect(() => ops.project_new({ discard: false }, context)).toThrow("discard");
  expect(host.replace).not.toHaveBeenCalled();
  state.entities[0].locked = true;
  expect(() => ops.object_select({ entityId: "surface" }, context)).toThrow(
    "cannot be selected",
  );
});
it("manages saved sketches in the same authoring collection without altering geometry", () => {
  const { ops, context, state } = setup(),
    geometry = state.entities;
  const created = ops.sketch_manage(
    { action: "create", name: "Section" },
    context,
  ) as { sketchId: string };
  expect(state.authoring.activeSketchId).toBe(created.sketchId);
  ops.sketch_manage(
    { action: "rename", sketchId: created.sketchId, name: "Fixture" },
    context,
  );
  expect(state.authoring.sketches?.[0].name).toBe("Fixture");
  ops.sketch_manage({ action: "delete", sketchId: created.sketchId }, context);
  expect(state.authoring.sketches).toEqual([]);
  expect(state.entities).toBe(geometry);
});
it("saves and restores triangle selections and rejects stale saved slots", () => {
  const { ops, context, state } = setup();
  const saved = ops.selection_saved(
    { entityId: "surface", action: "save", name: "Region" },
    context,
  ) as { selectionId: string };
  ops.selection_modify({ entityId: "surface", operation: "clear" }, context);
  expect(state.selection?.[0]).toBe(0);
  ops.selection_saved(
    { entityId: "surface", action: "load", selectionId: saved.selectionId },
    context,
  );
  expect(state.selection?.[0]).toBe(1);
  state.entities[0].meshSelection!.saved[0].triangles = [5];
  expect(() =>
    ops.selection_saved(
      { entityId: "surface", action: "load", selectionId: saved.selectionId },
      context,
    ),
  ).toThrow("stale");
});
it("uses exact knot insertion without changing surface shape", async () => {
  const { ops, context, state, patch } = setup();
  const expected = evaluatePatch(patch, 0.31, 0.62);
  await ops.surface_operation(
    { entityId: "surface", operation: "knot", axis: "u", parameter: 0.5 },
    context,
  );
  const result = state.entities[0].surfacePatch!;
  expect(result.countU).toBe(patch.countU + 1);
  evaluatePatch(result, 0.31, 0.62).forEach((v, i) =>
    expect(v).toBeCloseTo(expected[i], 8),
  );
});
it("rejects locked surface edits before changing the model", async () => {
  const { ops, context, state, patch } = setup();
  state.entities[0].locked = true;
  await expect(
    ops.surface_operation(
      { entityId: "surface", operation: "crease", axis: "u", parameter: 0.5 },
      context,
    ),
  ).rejects.toThrow("unlocked");
  expect(state.entities[0].surfacePatch).toBe(patch);
});
it("computes closed shell diagnostics from existing surface helpers with explicit budget", () => {
  const { ops, context } = setup();
  const result = ops.surface_shell(
    {
      width: 20,
      height: 10,
      depth: 5,
      options: { segments: 2, triangleBudget: 1000, weldTolerance: 0.001 },
    },
    context,
  ) as { diagnostics: { closed: boolean }; patches: unknown[] };
  expect(result.diagnostics.closed).toBe(true);
  expect(result.patches).toHaveLength(6);
  expect(() =>
    ops.surface_shell(
      {
        width: 20,
        height: 10,
        depth: 5,
        options: { segments: 128, triangleBudget: 10, weldTolerance: 0.001 },
      },
      context,
    ),
  ).toThrow("budget");
});

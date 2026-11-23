import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { bindReferenceConstructionWorkspace } from "../src/automation/reference-construction-binding";
import { ReferenceConstructionSession } from "../src/reference-construction-session";
import type { Entity } from "../src/types";

function setup() {
  const entity: Entity = {
    id: "scan",
    name: "Scan",
    kind: "mesh",
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    visible: true,
    color: "#fff",
    opacity: 1,
  };
  const state: WorkspaceSnapshot = {
    projectId: "project",
    name: "Project",
    entities: [entity],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  const snapshot = vi.fn(() => ({
    ...state,
    authoring: { ...state.authoring },
  }));
  const host = { snapshot } as unknown as WorkspaceHost;
  const binding = bindReferenceConstructionWorkspace(host);
  return { state, entity, host, binding, snapshot };
}

it("preserves a token across fresh snapshot wrappers and copied model lists", () => {
  const { state, binding } = setup();
  state.entities = [...state.entities];
  state.history = [];
  expect(binding.currentToken()).toBe(binding.token);
});

it("separates selection-only API revision changes from model staleness", () => {
  const { state, binding, host } = setup();
  const api = new ApplicationApi(host, {});
  try {
    const before = api.currentRevision();
    state.selectedId = "scan";
    state.selectedIds = ["scan"];
    state.selectionAnchorId = "scan";
    state.selection = new Uint8Array([1]);
    state.settings = { scale: 2, effectiveGridSpacing: 1 };
    expect(api.currentRevision()).not.toBe(before);
    expect(binding.currentToken()).toBe(binding.token);
  } finally {
    api.dispose();
  }
});

it("detects replacement of a geometry carrier even with identical coordinates", () => {
  const { state, entity, binding } = setup();
  state.entities = [
    { ...entity, positions: new Float32Array(entity.positions) },
  ];
  expect(binding.currentToken()).not.toBe(binding.token);
});

it("detects carrier replacement on the same entity object", () => {
  const { entity, binding } = setup();
  entity.positions = [1, 2, 3, 2, 2, 3, 1, 3, 3];
  expect(binding.currentToken()).not.toBe(binding.token);
});

it.each(["locked", "visible", "constructionOrderKey", "kernelId"] as const)(
  "detects source admission or identity change: %s",
  (field) => {
    const { entity, binding } = setup();
    Object.assign(entity, {
      [field]:
        field === "locked"
          ? true
          : field === "visible"
            ? false
            : field === "constructionOrderKey"
              ? "02".repeat(16)
              : "changed",
    });
    expect(binding.currentToken()).not.toBe(binding.token);
  },
);

it("detects exact reference recipe changes even if semantic geometry is unchanged", () => {
  const { state, entity, host } = setup();
  state.entities = [
    {
      ...entity,
      kind: "referencePoint",
      positions: [],
      constructionOrderKey: "01".repeat(16),
      reference: {
        version: 1,
        definition: {
          version: 1,
          kind: "point",
          mode: "coordinates",
          position: [-0, 0, 0],
          sources: [],
        },
        geometry: { kind: "point", position: [1, 2, 3] },
        evaluation: { completionWord: 256 },
      },
    },
  ];
  const binding = bindReferenceConstructionWorkspace(host);
  const definition = state.entities[0].reference!.definition;
  if (definition.kind !== "point" || definition.mode !== "coordinates")
    throw Error("Expected coordinates");
  Reflect.set(definition.position, 0, 0);
  expect(binding.currentToken()).not.toBe(binding.token);
});

it("detects fit metadata changes without touching scan buffers", () => {
  const { entity, host } = setup();
  entity.fit = {
    kind: "sphere",
    center: [0, 0, 0],
    axis: [0, 0, 1],
    radius: 1,
    rms: 0,
    maxError: 0,
  };
  const binding = bindReferenceConstructionWorkspace(host);
  entity.fit.center[0] = 3;
  expect(binding.currentToken()).not.toBe(binding.token);
});

it("binds history and project identity independently of current geometry", () => {
  const { state, entity, host, binding } = setup();
  state.history.push({ entities: [entity], label: "Earlier" });
  expect(binding.currentToken()).not.toBe(binding.token);
  const next = bindReferenceConstructionWorkspace(host);
  state.projectId = "another-project";
  expect(next.currentToken()).not.toBe(next.token);
});

it("keeps invalidation sticky after returning to the earlier geometry", () => {
  const { state, entity, binding } = setup();
  state.entities = [{ ...entity }];
  const stale = binding.currentToken();
  state.entities = [entity];
  expect(binding.currentToken()).toBe(stale);
  expect(stale).not.toBe(binding.token);
});

it("ignores active named-sketch selection while observing its stored geometry", () => {
  const { state, host } = setup();
  const sketch = {
    version: 1 as const,
    points: [],
    segments: [],
    constraints: [],
  };
  state.authoring = {
    sketches: [
      { id: "a", name: "A", sketch },
      { id: "b", name: "B", sketch },
    ],
    activeSketchId: "a",
    sketch,
  };
  const binding = bindReferenceConstructionWorkspace(host);
  state.authoring = {
    ...state.authoring,
    activeSketchId: "b",
    sketch: { ...sketch },
  };
  expect(binding.currentToken()).toBe(binding.token);
  state.authoring.sketches![0].sketch = { ...sketch };
  expect(binding.currentToken()).not.toBe(binding.token);
});

it("never reads the host again after disposal", () => {
  const { binding, snapshot } = setup();
  binding.dispose();
  const before = snapshot.mock.calls.length;
  expect(binding.currentToken()).not.toBe(binding.token);
  expect(snapshot).toHaveBeenCalledTimes(before);
});

it("prevents the cached session from applying after actual workspace changes", () => {
  const { state, entity, binding } = setup();
  const session = new ReferenceConstructionSession(
    binding.token,
    {
      geometry: { kind: "point", position: [0, 0, 0] },
      state: { completionWord: 0 },
    },
    {
      definition: {
        version: 1,
        kind: "point",
        mode: "coordinates",
        position: [1, 2, 3],
        sources: [],
      },
      writeNumericInputs: true,
      evaluationAllowed: true,
    },
  );
  state.selectedId = "scan";
  expect(session.inspect(binding.currentToken())).toMatchObject({
    active: true,
    version: 1,
  });
  state.entities = [{ ...entity, positions: [4, 5, 6, 5, 5, 6, 4, 6, 6] }];
  const publish = vi.fn();
  expect(() => session.apply(1, binding.currentToken(), publish)).toThrow(
    /stale/,
  );
  expect(publish).not.toHaveBeenCalled();
});

it("does not traverse scan coordinate or hidden-triangle buffers", () => {
  const { entity, host } = setup();
  const guarded = (values: number[]) =>
    new Proxy(values, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key))
          throw Error("Geometry buffer was traversed");
        return Reflect.get(target, key, receiver);
      },
    });
  entity.positions = guarded([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  entity.meshSelection = { hidden: guarded([0]), saved: [] };
  const binding = bindReferenceConstructionWorkspace(host);
  expect(binding.currentToken()).toBe(binding.token);
});

import { expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import type { CadClient } from "../src/cad/client";
import { separatedPatch } from "./fixtures/discontinuous-patch";

function setup() {
  const state: WorkspaceSnapshot = {
    name: "Discontinuous patch",
    entities: [],
    history: [],
    future: [],
    authoring: {},
    selectedId: null,
    selection: null,
    settings: {},
  };
  const host: WorkspaceHost = {
    snapshot: () => ({ ...state }),
    cad: () => ({}) as CadClient,
    commit: vi.fn((entities, label) => {
      state.history = [...state.history, { entities: state.entities, label }];
      state.entities = entities;
    }),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn(),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    activity: vi.fn(),
    busy: () => false,
  };
  return { state, host, api: new ApplicationApi(host, createOperations(host)) };
}

it("publishes all disconnected strips through shared surface_set in one retry-safe transaction", async () => {
  const { state, host, api } = setup();
  const patch = separatedPatch();
  const original = JSON.stringify(patch);
  const request = {
    patch,
    name: "Two strips",
    expectedRevision: api.currentRevision(),
    requestId: "split-patch-create",
  };
  const result = await api.invoke("surface_set", request);
  expect(result.ok).toBe(true); // Valid discontinuity support is required, not rejection.
  expect(host.commit).toHaveBeenCalledTimes(1);
  expect(state.history).toHaveLength(1);
  expect(state.entities).toHaveLength(1);
  const entity = state.entities[0];
  expect(entity.surfacePatch).toEqual(patch);
  expect(entity.surfacePatch).not.toBe(patch);
  for (let at = 0; at < entity.positions.length; at += 9) {
    const x = [
      entity.positions[at],
      entity.positions[at + 3],
      entity.positions[at + 6],
    ];
    expect(
      x.every((value) => value >= 0 && value <= 1) ||
        x.every((value) => value >= 10 && value <= 11),
    ).toBe(true);
  }
  expect(
    Array.from(entity.positions).some(
      (value, index) => index % 3 === 0 && value === 1,
    ),
  ).toBe(true);
  expect(await api.invoke("surface_set", request)).toEqual(result);
  expect(host.commit).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(patch)).toBe(original);
});

it("keeps prior disconnected geometry/history atomic when a later invalid update fails", async () => {
  const { state, host, api } = setup();
  expect(
    (
      await api.invoke("surface_set", {
        patch: separatedPatch(false, true),
        expectedRevision: api.currentRevision(),
        requestId: "split-v-create",
      })
    ).ok,
  ).toBe(true);
  const entities = state.entities,
    history = state.history,
    revision = api.currentRevision();
  const invalid = separatedPatch(false, true);
  invalid.weights[0] = 0;
  expect(
    (
      await api.invoke("surface_set", {
        entityId: entities[0].id,
        patch: invalid,
        expectedRevision: revision,
        requestId: "invalid-update",
      })
    ).ok,
  ).toBe(false);
  expect(state.entities).toBe(entities);
  expect(state.history).toBe(history);
  expect(api.currentRevision()).toBe(revision);
  expect(host.commit).toHaveBeenCalledTimes(1);
});

it("retains an explicit scan association for GUI and MCP patch creation", async () => {
  const { state, host, api } = setup();
  state.entities = [
    {
      id: "scan",
      name: "Scan",
      kind: "mesh",
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      color: "#fff",
      visible: true,
      opacity: 1,
    },
  ];
  const response = await api.invoke("surface_set", {
    patch: separatedPatch(),
    scanId: "scan",
    expectedRevision: api.currentRevision(),
    requestId: "with-source",
  });
  expect(response.ok).toBe(true);
  expect(state.entities[1].surfaceScanId).toBe("scan");
  expect(host.commit).toHaveBeenCalledTimes(1);
  const revision = api.currentRevision();
  const rejected = await api.invoke("surface_set", {
    patch: separatedPatch(),
    scanId: "missing",
    expectedRevision: revision,
    requestId: "missing-source",
  });
  expect(rejected.ok).toBe(false);
  expect(api.currentRevision()).toBe(revision);
  expect(host.commit).toHaveBeenCalledTimes(1);
  api.dispose();
});

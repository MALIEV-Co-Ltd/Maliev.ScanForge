import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { modelChanged } from "../src/history";
import { parseProject, serializeProject } from "../src/io";
import {
  getRibbonToolMetadata,
  ribbonToolAvailability,
} from "../src/ui/ribbon-model";
import type { CadClient } from "../src/cad/client";

const apis: ApplicationApi[] = [];
afterEach(() => apis.splice(0).forEach((api) => api.dispose()));

it("reveals assigned colors by disabling Normals view through the shared operation, including repeat clicks", async () => {
  const { state, host, run } = setup();
  state.settings.normalsDisplay = true;
  host.settings = (patch) => Object.assign(state.settings, patch);
  expect(await run()).toMatchObject({
    ok: true,
    result: { normalsDisplay: false },
  });
  expect(state.settings.normalsDisplay).toBe(false);
  state.settings.normalsDisplay = true;
  expect(await run("show-colors-again")).toMatchObject({
    ok: true,
    result: { changed: 0, normalsDisplay: false },
  });
  expect(state.settings.normalsDisplay).toBe(false);
});
function setup(count = 3) {
  const state: WorkspaceSnapshot = {
    name: "Auto color",
    entities: Array.from({ length: count }, (_, i) => ({
      id: `object-${i}`,
      name: `Part ${i}`,
      kind: "mesh",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      color: "#a6a6a6",
      opacity: 0.75,
      visible: i !== 1,
      locked: i === 2,
    })),
    selectedId: count ? "object-0" : null,
    selectedIds: count ? ["object-0"] : [],
    history: [],
    future: [],
    authoring: {},
    selection: null,
    settings: {},
  };
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => ({}) as CadClient,
    commit: vi.fn((entities, label) => {
      if (modelChanged(state.entities, entities))
        state.history.push({ entities: state.entities, label });
      state.entities = entities;
    }),
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
  apis.push(api);
  return {
    state,
    host,
    api,
    run: (requestId = "auto-color", expectedRevision = api.currentRevision()) =>
      api.invoke("scene_auto_color", { requestId, expectedRevision }),
  };
}

it("enables Auto colorize for the whole scene without requiring object selection", () => {
  const tool = getRibbonToolMetadata("autoColorize")!;
  expect(tool.action).toBe("autoColorize");
  expect(
    ribbonToolAvailability(
      tool,
      { disabled: false, hasSelection: false, canUndo: false, canRedo: false },
      { autoColorize: vi.fn() },
    ).available,
  ).toBe(true);
  expect(
    ribbonToolAvailability(
      tool,
      { disabled: true, hasSelection: true, canUndo: false, canRedo: false },
      { autoColorize: vi.fn() },
    ).available,
  ).toBe(false);
});

it("colors every scene object including hidden and locked objects through MCP while preserving geometry and selection", async () => {
  const { state, api, run } = setup();
  const before = state.entities;
  const result = await run();
  expect(result).toMatchObject({
    ok: true,
    result: { changed: 3, objects: before.map((e) => ({ entityId: e.id })) },
  });
  const colors = state.entities.map((e) => e.color);
  expect(new Set(colors).size).toBe(3);
  for (const [i, e] of state.entities.entries()) {
    expect(e.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(e.positions).toBe(before[i].positions);
    expect({ ...e, color: before[i].color }).toEqual(before[i]);
    expect(await api.invoke("object_get", { entityId: e.id })).toMatchObject({
      ok: true,
      result: { color: e.color },
    });
  }
  expect(state.selectedIds).toEqual(["object-0"]);
  expect(state.history).toHaveLength(0);
  expect(
    parseProject(serializeProject("Auto color", state.entities)).entities.map(
      (e) => e.color,
    ),
  ).toEqual(colors);
});

it("keeps colors deterministic and repeat clicks do not churn entities or commit again", async () => {
  const { state, host, run } = setup(32);
  const first = await run();
  expect(first).toMatchObject({ ok: true });
  const colored = state.entities;
  expect(await run("auto-color", 0)).toEqual(first);
  expect(await run("repeat")).toMatchObject({
    ok: true,
    result: { changed: 0 },
  });
  expect(state.entities).toBe(colored);
  expect(host.commit).toHaveBeenCalledTimes(1);
  const second = setup(32);
  await second.run();
  expect(second.state.entities.map((e) => e.color)).toEqual(
    colored.map((e) => e.color),
  );
});

it("extends the palette without repeating RGB colors for 10,000 objects", async () => {
  const { state, run } = setup(10000);
  expect(await run()).toMatchObject({ ok: true, result: { changed: 10000 } });
  expect(new Set(state.entities.map((e) => e.color)).size).toBe(10000);
  expect(state.entities.every((e) => /^#[0-9a-f]{6}$/.test(e.color))).toBe(
    true,
  );
});

it.each(["busy", "stale", "empty", "oversized"])(
  "rejects %s scenes without mutation",
  async (reason) => {
    const { state, host, run } = setup(
      reason === "empty" ? 0 : reason === "oversized" ? 10001 : 3,
    );
    if (reason === "busy") host.busy = () => true;
    const before = state.entities;
    expect(await run("rejected", reason === "stale" ? 999 : 0)).toMatchObject({
      ok: false,
    });
    expect(state.entities).toBe(before);
    expect(host.commit).not.toHaveBeenCalled();
  },
);

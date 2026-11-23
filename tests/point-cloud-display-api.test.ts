import { afterEach, expect, it, vi } from "vitest";
import {
  ApplicationApi,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import { createOperations } from "../src/automation/operations";
import { restoreModelDisplay, modelChanged } from "../src/history";
import { parseProject, serializeProject } from "../src/io";

let api: ApplicationApi;
afterEach(() => api?.dispose());
function setup() {
  const state: WorkspaceSnapshot = {
    name: "Points",
    entities: [
      {
        id: "cloud",
        name: "scan.asc",
        kind: "pointcloud",
        positions: Float32Array.of(0, 0, 0),
        pointColors: Uint8Array.of(255, 255, 255, 255),
        color: "#aaff00",
        opacity: 1,
        visible: true,
      },
    ],
    selectedId: "cloud",
    history: [],
    future: [],
    authoring: {},
    selection: null,
    settings: {},
  };
  const host = {
    snapshot: () => state,
    commit: vi.fn((entities) => {
      state.entities = entities;
    }),
    busy: () => false,
    activity: () => {},
  } as unknown as WorkspaceHost;
  api = new ApplicationApi(host, createOperations(host));
  const update = (
    patch: object,
    requestId: string = crypto.randomUUID(),
    expectedRevision = api.currentRevision(),
  ) =>
    api.invoke("object_update", {
      entityId: "cloud",
      patch,
      requestId,
      expectedRevision,
    });
  return { state, host, update };
}

it("exposes effective defaults, applies display options, protects revisions and retries, and retains display across modeling undo", async () => {
  const { state, host, update } = setup();
  expect(await api.invoke("object_get", { entityId: "cloud" })).toMatchObject({
    ok: true,
    result: {
      pointSize: 1,
      pointColorMode: "source",
      pointAutoDensity: true,
      pointDensity: 100,
    },
  });
  const before = state.entities;
  const patch = {
    pointSize: 2.5,
    pointColorMode: "solid",
    color: "#aaff00",
    pointAutoDensity: false,
    pointDensity: 20,
  };
  const revision = api.currentRevision();
  const receipt = await update(patch, "display", revision);
  expect(receipt, JSON.stringify(receipt)).toMatchObject({ ok: true });
  expect(await update(patch, "display", revision)).toEqual(receipt);
  expect(host.commit).toHaveBeenCalledTimes(1);
  expect(api.currentRevision()).toBeGreaterThan(revision);
  expect(await update({ pointSize: 5 }, "stale", revision)).toMatchObject({
    ok: false,
  });
  expect(await api.invoke("object_get", { entityId: "cloud" })).toMatchObject({
    ok: true,
    result: patch,
  });
  expect(state.entities[0].pointColors).toBe(before[0].pointColors);
  expect(state.entities[0].positions).toBe(before[0].positions);
  expect(modelChanged(before, state.entities)).toBe(false);
  expect(restoreModelDisplay(before, state.entities)[0]).toMatchObject(patch);
  expect(
    parseProject(serializeProject("Points", state.entities)).entities[0],
  ).toMatchObject(patch);
});

it("rejects invalid options atomically and rejects point options for meshes", async () => {
  const { state, host, update } = setup();
  for (const patch of [
    { pointSize: 0 },
    { pointSize: 11 },
    { pointSize: null },
    { pointDensity: 9 },
    { pointDensity: 101 },
    { pointAutoDensity: "true" },
    { pointColorMode: "rainbow" },
  ])
    expect(await update(patch)).toMatchObject({ ok: false });
  state.entities[0] = { ...state.entities[0], kind: "mesh" };
  expect(await update({ pointSize: 2 })).toMatchObject({ ok: false });
  expect(host.commit).not.toHaveBeenCalled();
});

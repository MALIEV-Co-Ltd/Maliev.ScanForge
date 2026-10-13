import { beforeEach, expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import { editPointCloud } from "../src/point-cloud-processing";
import { processMesh } from "../src/processing-client";
import {
  validateInput,
  type WorkspaceHost,
  type CommandContext,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import catalog from "../src/automation/catalog.json";
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
function setup() {
  const cloud = {
    id: "cloud",
    kind: "pointcloud" as const,
    name: "scan",
    positions: new Float32Array([0, 0, 0, 0.1, 0, 0, 2, 0, 0]),
    normals: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    visible: true,
    color: "#fff",
    opacity: 1,
  };
  const state = {
    entities: [cloud],
    history: [],
    future: [],
    authoring: {},
    selectedId: "cloud",
    selection: Uint8Array.from([1, 0, 0]),
  } as unknown as WorkspaceSnapshot;
  const host = {
    snapshot: () => state,
    commit: vi.fn((entities) => (state.entities = entities)),
    setSelection: vi.fn((id, mask) => {
      state.selectedId = id;
      state.selection = mask;
    }),
  } as unknown as WorkspaceHost;
  const context = {
    signal: new AbortController().signal,
    check: vi.fn(),
    progress: vi.fn(),
    artifact: vi.fn(() => ({ artifactId: "mask" })),
  } as unknown as CommandContext;
  return { state, host, context, operations: createOperations(host) };
}
beforeEach(() => {
  vi.mocked(processMesh).mockImplementation(async (request) => {
    if (request.kind !== "pointCloudEdit") throw Error("Unexpected request");
    const result = editPointCloud(request);
    return {
      kind: request.kind,
      pointCloudEdit: result,
      diagnostics: result.diagnostics,
    };
  });
});
it("discovers and validates explicit point index selection and point processing", () => {
  const schema = catalog.find(
    (row) => row.name === "selection_set",
  )!.inputSchema;
  expect(() =>
    validateInput(schema, {
      entityId: "cloud",
      points: [1, 2],
      expectedRevision: 0,
      requestId: "s",
    }),
  ).not.toThrow();
  expect(() =>
    validateInput(schema, {
      entityId: "cloud",
      triangles: [1],
      expectedRevision: 0,
      requestId: "s",
    }),
  ).not.toThrow();
  expect(() =>
    validateInput(schema, {
      entityId: "cloud",
      points: [-1],
      expectedRevision: 0,
      requestId: "s",
    }),
  ).toThrow();
  expect(() =>
    validateInput(schema, {
      entityId: "cloud",
      points: [1],
      triangles: [1],
      expectedRevision: 0,
      requestId: "s",
    }),
  ).toThrow();
  const processing = catalog.find(
    (row) => row.name === "mesh_process",
  )!.inputSchema;
  expect(() =>
    validateInput(processing, {
      entityId: "cloud",
      operation: { kind: "pointCloudEdit", action: "voxel", cellSize: 0.5 },
      expectedRevision: 0,
      requestId: "p",
    }),
  ).not.toThrow();
});
it("sets and reads point selections and rejects triangle indices for clouds", () => {
  const { operations, context, state } = setup();
  operations.selection_set({ entityId: "cloud", points: [1, 2] }, context);
  expect(Array.from(state.selection!)).toEqual([0, 1, 1]);
  expect(
    operations.selection_get({ entityId: "cloud" }, context),
  ).toMatchObject({ elementKind: "points", count: 2 });
  expect(() =>
    operations.selection_set({ entityId: "cloud", triangles: [0] }, context),
  ).toThrow("Provide points");
});
it.each(["copy", "cut", "delete"])(
  "%s preserves point-cloud identity, normals and point counts",
  (operation) => {
    const { operations, context, state } = setup();
    const result = operations.selection_edit(
      { entityId: "cloud", operation },
      context,
    );
    expect(result).toMatchObject({ points: 1 });
    expect(state.entities.every((entity) => entity.kind === "pointcloud")).toBe(
      true,
    );
    if (operation !== "delete")
      expect(state.entities.at(-1)!.normals).toEqual([1, 0, 0]);
    if (operation !== "copy")
      expect(state.entities[0].normals).toEqual([0, 1, 0, 0, 0, 1]);
  },
);
it("runs voxel editing and connected point selection through the shared worker contract", async () => {
  const { operations, context, state, host } = setup();
  await operations.mesh_process(
    {
      entityId: "cloud",
      operation: {
        kind: "pointCloudEdit",
        action: "connectedSelection",
        neighborRadius: 0.2,
      },
    },
    context,
  );
  expect(Array.from(state.selection!)).toEqual([1, 1, 0]);
  expect(host.commit).not.toHaveBeenCalled();
  await operations.mesh_process(
    {
      entityId: "cloud",
      operation: { kind: "pointCloudEdit", action: "voxel", cellSize: 0.5 },
    },
    context,
  );
  expect(state.entities[0].positions).toHaveLength(6);
  expect(state.entities[0].normals).toEqual([1, 0, 0, 0, 0, 1]);
});
it("rejects locked point edits and deletes the object when every point is selected", async () => {
  const { operations, context, state } = setup();
  state.entities[0].locked = true;
  await expect(
    operations.mesh_process(
      {
        entityId: "cloud",
        operation: { kind: "pointCloudEdit", action: "smooth" },
      },
      context,
    ),
  ).rejects.toThrow("locked");
  state.entities[0].locked = false;
  state.selection = new Uint8Array(3).fill(1);
  operations.selection_edit(
    { entityId: "cloud", operation: "delete" },
    context,
  );
  expect(state.entities).toHaveLength(0);
});

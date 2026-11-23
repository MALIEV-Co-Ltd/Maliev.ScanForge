import { beforeEach, expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import { meshPointCloud } from "../src/point-cloud-meshing";
import { processMesh } from "../src/processing-client";
import {
  validateInput,
  type WorkspaceHost,
  type WorkspaceSnapshot,
  type CommandContext,
} from "../src/automation/api";
import catalog from "../src/automation/catalog.json";

vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
beforeEach(() => {
  vi.mocked(processMesh).mockImplementation(async (request) => {
    if (request.kind !== "pointCloudMesh") throw Error("Unexpected request");
    return { kind: request.kind, ...meshPointCloud(request) };
  });
});
function fixture() {
  const source = {
    id: "cloud",
    name: "surface",
    kind: "pointcloud" as const,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    color: "#abc",
    opacity: 1,
    visible: true,
  };
  const state = {
    entities: [source],
    selectedId: source.id,
    history: [],
    future: [],
  } as unknown as WorkspaceSnapshot;
  const host = {
    snapshot: () => state,
    commit: vi.fn((entities) => {
      state.history.push({} as never);
      state.entities = entities;
    }),
    select: vi.fn(),
  } as unknown as WorkspaceHost;
  const context = {
    signal: new AbortController().signal,
    check: vi.fn(),
    progress: vi.fn(),
  } as unknown as CommandContext;
  return {
    source,
    state,
    host,
    context,
    operation: createOperations(host).mesh_process,
  };
}
it("publishes a distinct mesh while preserving the cloud and one history entry", async () => {
  const { source, state, host, context, operation } = fixture();
  const before = source.positions.slice();
  const result = (await operation(
    {
      entityId: source.id,
      operation: { kind: "pointCloudMesh", plane: "xy", maxEdgeLength: 2 },
    },
    context,
  )) as { entityIds: string[] };
  expect(state.entities).toHaveLength(2);
  expect(state.entities[0]).toBe(source);
  expect(source.positions).toEqual(before);
  const mesh = state.entities[1];
  expect(mesh.kind).toBe("mesh");
  expect(mesh.id).not.toBe(source.id);
  expect(mesh.indexedMesh?.triangles.length).toBe(6);
  expect(result.entityIds).toEqual([mesh.id]);
  expect(host.select).toHaveBeenCalledWith(mesh.id);
  expect(host.commit).toHaveBeenCalledTimes(1);
  expect(state.history).toHaveLength(1);
});
it("refuses hidden, selected-only, locked, and replacement requests before mutation", async () => {
  for (const extra of [
    { selectionOnly: true },
    { selectionOnly: false },
    { createNew: false },
    { targetId: "other" },
  ]) {
    const { source, host, context, operation } = fixture();
    await expect(
      operation(
        {
          entityId: source.id,
          operation: { kind: "pointCloudMesh", plane: "xy" },
          ...extra,
        },
        context,
      ),
    ).rejects.toThrow(/whole cloud|creates a new mesh/i);
    expect(host.commit).not.toHaveBeenCalled();
  }
  for (const patch of [
    { locked: true },
    { visible: false },
    { meshSelection: { hidden: [0], saved: [] } },
  ]) {
    const { source, host, context, operation } = fixture();
    Object.assign(source, patch);
    await expect(
      operation(
        {
          entityId: source.id,
          operation: { kind: "pointCloudMesh", plane: "xy" },
        },
        context,
      ),
    ).rejects.toThrow();
    expect(host.commit).not.toHaveBeenCalled();
  }
});
it("discovers explicit plane/edge options and rejects agent-supplied geometry", () => {
  const tool = catalog.find((tool) => tool.name === "mesh_process")!;
  const args = {
    entityId: "cloud",
    expectedRevision: 0,
    requestId: "mesh",
    operation: { kind: "pointCloudMesh", plane: "xy" },
  };
  expect(() => validateInput(tool.inputSchema, args)).not.toThrow();
  for (const patch of [
    { plane: "auto" },
    { maxEdgeLength: -1 },
    { positions: [0, 0, 0] },
  ])
    expect(() =>
      validateInput(tool.inputSchema, {
        ...args,
        operation: { ...args.operation, ...patch },
      }),
    ).toThrow();
});

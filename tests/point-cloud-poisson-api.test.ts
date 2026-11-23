import { beforeEach, expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import { processMesh } from "../src/processing-client";
import {
  validateInput,
  type CommandContext,
  type WorkspaceHost,
  type WorkspaceSnapshot,
} from "../src/automation/api";
import catalog from "../src/automation/catalog.json";

vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
beforeEach(() => {
  vi.mocked(processMesh).mockReset();
  vi.mocked(processMesh).mockImplementation(async (request) => ({
    kind: request.kind,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indexedMesh: {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triangles: new Uint32Array([0, 1, 2]),
    },
    diagnostics: { algorithm: "screened-poisson", triangles: 1 },
  }));
});
function fixture() {
  const source = {
    id: "cloud",
    name: "scan",
    kind: "pointcloud" as const,
    visible: true,
    color: "#abc",
    opacity: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  };
  const state = {
    entities: [source],
    history: [],
    future: [],
    selectedId: source.id,
  } as unknown as WorkspaceSnapshot;
  const host = {
    snapshot: () => state,
    commit: vi.fn((entities) => {
      state.entities = entities;
      state.history.push({} as never);
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
    invoke: createOperations(host).mesh_process,
  };
}
it("discovers actual 3D Poisson options and refuses supplied geometry and invalid bounds", () => {
  const schema = catalog.find(
    (tool) => tool.name === "mesh_process",
  )!.inputSchema;
  const args = {
    entityId: "cloud",
    expectedRevision: 0,
    requestId: "poisson",
    operation: { kind: "pointCloudPoisson", normalMode: "provided" },
  };
  expect(() => validateInput(schema, args)).not.toThrow();
  for (const patch of [
    { depth: 11 },
    { depth: 5 },
    { normalNeighbors: 49 },
    { densityThreshold: -1 },
    { pointWeight: -1 },
    { samplesPerNode: 0 },
    { normals: [0, 0, 1] },
    { positions: [0, 0, 0] },
  ])
    expect(() =>
      validateInput(schema, {
        ...args,
        operation: { ...args.operation, ...patch },
      }),
    ).toThrow();
});
it("binds world normals internally and publishes one new selected mesh without replacing the cloud", async () => {
  const { source, state, host, context, invoke } = fixture();
  const positions = source.positions.slice(),
    normals = source.normals.slice();
  const output = (await invoke(
    {
      entityId: source.id,
      operation: {
        kind: "pointCloudPoisson",
        normalMode: "provided",
        depth: 8,
      },
    },
    context,
  )) as { entityIds: string[] };
  expect(processMesh).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "pointCloudPoisson",
      positions: source.positions,
      normals: source.normals,
    }),
    expect.anything(),
  );
  expect(state.entities).toHaveLength(2);
  expect(state.entities[0]).toBe(source);
  expect(source.positions).toEqual(positions);
  expect(source.normals).toEqual(normals);
  expect(state.entities[1].kind).toBe("mesh");
  expect(state.entities[1].name).toBe("scan - Poisson mesh");
  expect(output.entityIds).toEqual([state.entities[1].id]);
  expect(host.select).toHaveBeenCalledWith(state.entities[1].id);
  expect(host.commit).toHaveBeenCalledTimes(1);
});
it("refuses replacement, hidden, locked, target and selection requests before worker publication", async () => {
  for (const args of [
    { createNew: false },
    { selectionOnly: false },
    { selectionOnly: true },
    { targetId: "other" },
    { targetIds: [] },
  ]) {
    const { source, host, context, invoke } = fixture();
    await expect(
      invoke(
        {
          entityId: source.id,
          operation: { kind: "pointCloudPoisson" },
          ...args,
        },
        context,
      ),
    ).rejects.toThrow();
    expect(host.commit).not.toHaveBeenCalled();
  }
  for (const patch of [
    { locked: true },
    { visible: false },
    { meshSelection: { hidden: [0], saved: [] } },
  ]) {
    const { source, host, context, invoke } = fixture();
    Object.assign(source, patch);
    await expect(
      invoke(
        { entityId: source.id, operation: { kind: "pointCloudPoisson" } },
        context,
      ),
    ).rejects.toThrow();
    expect(host.commit).not.toHaveBeenCalled();
  }
});
it("worker failure publishes neither geometry nor history", async () => {
  const { source, state, host, context, invoke } = fixture();
  vi.mocked(processMesh).mockRejectedValueOnce(
    new Error("Poisson memory limit"),
  );
  await expect(
    invoke(
      { entityId: source.id, operation: { kind: "pointCloudPoisson" } },
      context,
    ),
  ).rejects.toThrow(/memory/);
  expect(state.entities).toEqual([source]);
  expect(host.commit).not.toHaveBeenCalled();
});

it("refuses a late worker result after cancellation or revision conflict", async () => {
  for (const message of [
    "cancelled",
    "Workspace changed while operation ran",
  ]) {
    const { source, state, host, context, invoke } = fixture();
    let finish!: (result: Awaited<ReturnType<typeof processMesh>>) => void;
    vi.mocked(processMesh).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = invoke(
      { entityId: source.id, operation: { kind: "pointCloudPoisson" } },
      context,
    );
    vi.mocked(context.check).mockImplementation(() => {
      throw new Error(message);
    });
    finish({
      kind: "pointCloudPoisson",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      diagnostics: {},
    });
    await expect(pending).rejects.toThrow(message);
    expect(state.entities).toEqual([source]);
    expect(host.commit).not.toHaveBeenCalled();
  }
});

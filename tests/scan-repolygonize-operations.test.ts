import { expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import type {
  WorkspaceHost,
  WorkspaceSnapshot,
  CommandContext,
} from "../src/automation/api";
import type { Entity } from "../src/types";
import { processMesh } from "../src/processing-client";
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
const triangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
function harness() {
  const mesh = (id: string): Entity => ({
    id,
    name: id,
    kind: "mesh",
    positions: triangle.slice(),
    color: "#fff",
    opacity: 1,
    visible: true,
    indexedMesh: {
      vertices: triangle.slice(),
      triangles: new Uint32Array([0, 1, 2]),
    },
  });
  const first = mesh("first"),
    source = mesh("source");
  const state: WorkspaceSnapshot = {
    name: "test",
    entities: [first, source],
    selectedId: source.id,
    selection: new Uint8Array(1),
    history: [],
    future: [],
    settings: {},
    authoring: {},
  };
  const host = {
    snapshot: () => state,
    commit: vi.fn((next: Entity[], label: string) => {
      state.history.push({ entities: state.entities, label });
      state.entities = next;
    }),
    select: vi.fn(),
  } as unknown as WorkspaceHost;
  const context = {
    signal: new AbortController().signal,
    check: vi.fn(),
    progress: vi.fn(),
  } as unknown as CommandContext;
  vi.mocked(processMesh)
    .mockReset()
    .mockResolvedValue({
      kind: "scanTools",
      positions: triangle.slice(),
      diagnostics: { summary: "reconstructed" },
    });
  return {
    first,
    source,
    state,
    host,
    context,
    execute: createOperations(host).mesh_process,
  };
}
it("uses visible scene order and preserves hidden originals when publishing a native reconstruction owner", async () => {
  const h = harness();
  const result = (await h.execute(
    {
      entityId: "source",
      operation: {
        kind: "scanTools",
        operation: { kind: "repolygonize", resolution: 0.5 },
      },
    },
    h.context,
  )) as { entityIds: string[] };
  const request = vi.mocked(processMesh).mock.calls[0][0];
  expect(request.positions).toBe(h.first.positions);
  expect(request).toMatchObject({
    operation: {
      sourceTopology: h.first.indexedMesh,
      targetTopology: [h.source.indexedMesh],
      targets: [h.source.positions],
    },
  });
  expect(h.state.entities).toHaveLength(3);
  expect(h.state.entities[0]).toMatchObject({
    id: "first",
    visible: false,
    positions: h.first.positions,
  });
  expect(h.state.entities[1]).toMatchObject({
    id: "source",
    visible: false,
    positions: h.source.positions,
  });
  expect(h.state.entities[2].name).toBe("Polygonized 0.500 mm");
  expect(h.state.history).toHaveLength(1);
  expect(h.host.commit).toHaveBeenCalledWith(
    expect.any(Array),
    "Mesh scanTools",
    { modelVisibilityFor: ["first", "source"] },
  );
  expect(h.host.select).toHaveBeenCalledWith(result.entityIds[0]);
});
it("retains explicit replacement and the existing voxel method's owner semantics", async () => {
  for (const extra of [
    { createNew: false },
    {
      operation: {
        kind: "scanTools",
        operation: { kind: "repolygonize", resolution: 0.5, method: "voxel" },
      },
    },
  ]) {
    const h = harness();
    await h.execute(
      {
        entityId: "source",
        operation: {
          kind: "scanTools",
          operation: { kind: "repolygonize", resolution: 0.5 },
        },
        ...extra,
      },
      h.context,
    );
    expect(h.state.entities).toHaveLength(2);
    expect(h.state.entities[0]).toBe(h.first);
    expect(h.state.entities[1].id).toBe("source");
    expect(h.state.entities[1].positions).not.toBe(h.source.positions);
  }
});

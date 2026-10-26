import { expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import type {
  WorkspaceHost,
  WorkspaceSnapshot,
  CommandContext,
} from "../src/automation/api";
import type { Entity } from "../src/types";
import { processMesh } from "../src/processing-client";
import { scanToolRequest } from "../src/ui/scan-tool-request";
import { resolveConstructionIdentities } from "../src/reference-construction-identity";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";
import { seekModelRevision } from "../src/history";
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
const triangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
function harness() {
  const mesh = (id: string): Entity => ({
    id,
    name: id,
    kind: "mesh",
    positions: triangle.slice(),
    color: "#ffffff",
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
    commit: vi.fn(
      (
        next: Entity[],
        label: string,
        policy?: import("../src/object-operations").ModelCommitPolicy,
      ) => {
        state.history.push({
          entities: state.entities,
          label,
          ...(policy?.modelVisibilityFor
            ? { restoreVisibilityFor: [...policy.modelVisibilityFor] }
            : {}),
        });
        state.entities = next;
      },
    ),
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

it("binds the same scene-first native source for the GUI request helper", () => {
  const h = harness();
  const request = scanToolRequest(
    h.source,
    { kind: "repolygonize", resolution: 0.5 },
    h.state.entities,
  );
  expect(request.positions).toBe(h.first.positions);
  expect(request.operation).toMatchObject({
    method: "native",
    sourceTopology: h.first.indexedMesh,
  });
});

it("retains mixed-point voxel defaults and rejects an explicit unsupported native method", async () => {
  const h = harness();
  const cloud: Entity = {
    ...h.first,
    id: "points",
    kind: "pointcloud",
    positions: new Float32Array([0, 0, 0, 1, 1, 1]),
    indexedMesh: undefined,
  };
  h.state.entities.push(cloud);
  const args = {
    entityId: h.source.id,
    targetIds: [cloud.id],
    operation: { kind: "scanTools", operation: { kind: "repolygonize" } },
  };
  await h.execute(args, h.context);
  expect(vi.mocked(processMesh).mock.calls[0][0]).toMatchObject({
    operation: {
      method: "voxel",
      inputKind: "triangles",
      targetInputs: [{ kind: "points", positions: cloud.positions }],
    },
  });
  expect(h.state.entities).toHaveLength(3);
  await expect(
    h.execute(
      {
        ...args,
        operation: {
          kind: "scanTools",
          operation: { kind: "repolygonize", method: "native" },
        },
      },
      h.context,
    ),
  ).rejects.toThrow(/triangle meshes/);
  expect(processMesh).toHaveBeenCalledOnce();
});

it("does not hide a locked native input and retains explicit empty-list semantics", async () => {
  const h = harness();
  h.first.locked = true;
  const operation = {
    kind: "scanTools",
    operation: { kind: "repolygonize", method: "native" },
  };
  await expect(
    h.execute({ entityId: h.source.id, operation }, h.context),
  ).rejects.toThrow(/locked/);
  expect(processMesh).not.toHaveBeenCalled();
  await h.execute(
    { entityId: h.source.id, targetIds: [], operation },
    h.context,
  );
  expect(vi.mocked(processMesh).mock.calls[0][0].positions).toBe(
    h.source.positions,
  );
  expect(h.first.visible).toBe(true);
  await expect(
    h.execute(
      {
        entityId: h.source.id,
        targetIds: [],
        operation: {
          kind: "scanTools",
          operation: { kind: "repolygonize", method: "voxel" },
        },
      },
      h.context,
    ),
  ).rejects.toThrow(/targetIds/);
});

it("gives a native output its own construction identity without changing the inputs", async () => {
  const h = harness();
  h.first.constructionOrderKey = "f".repeat(32);
  h.source.constructionOrderKey = "a".repeat(32);
  await h.execute(
    {
      entityId: h.source.id,
      operation: { kind: "scanTools", operation: { kind: "repolygonize" } },
    },
    h.context,
  );
  const output = h.state.entities[2];
  expect(output.constructionOrderKey).toMatch(/^[0-9a-f]{32}$/);
  expect(output.constructionOrderKey).not.toBe(h.source.constructionOrderKey);
  expect(h.state.entities[1].constructionOrderKey).toBe(
    h.source.constructionOrderKey,
  );
  expect(vi.mocked(processMesh).mock.calls[0][0].positions).toBe(
    h.first.positions,
  );
  expect(() =>
    resolveConstructionIdentities(h.state.entities, []),
  ).not.toThrow();
  const saved = await encodeProjectFileLocally({
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "Native keys",
      entities: h.state.entities,
    },
    history: h.state.history,
    future: [],
  });
  const reopened = await decodeProjectContents(saved);
  expect(reopened.project.entities.map((e) => e.constructionOrderKey)).toEqual(
    h.state.entities.map((e) => e.constructionOrderKey),
  );
  const undo = seekModelRevision(
    reopened.history,
    reopened.project.entities,
    reopened.future,
    0,
  );
  expect(undo.entities.map((e) => [e.constructionOrderKey, e.visible])).toEqual(
    [
      ["f".repeat(32), true],
      ["a".repeat(32), true],
    ],
  );
  const redo = seekModelRevision(undo.history, undo.entities, undo.future, 1);
  expect(redo.entities.map((e) => [e.constructionOrderKey, e.visible])).toEqual(
    h.state.entities.map((e) => [e.constructionOrderKey, e.visible]),
  );
});

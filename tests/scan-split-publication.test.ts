import { expect, it, vi, beforeEach } from "vitest";
import { createOperations } from "../src/automation/operations";
import type {
  WorkspaceHost,
  WorkspaceSnapshot,
  CommandContext,
} from "../src/automation/api";
import type { CadClient } from "../src/cad/client";
import type { Entity } from "../src/types";
import { processMesh } from "../src/processing-client";
import { runScanEdit } from "../src/scan-edit";
import { seekModelRevision } from "../src/history";
import { prepareModelSketchPublication } from "../src/model-sketch-history";
import { runFiniteSplitCandidate } from "../src/scan-split-finite-candidate";
import { indexedMeshMatches } from "../src/indexed-mesh";
import {
  encodeProjectFileLocally,
  decodeProjectFile,
} from "../src/project-file";
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
const triangle = [0, 0, 1, 1, 0, 1, 0, 1, 1];
function entity(patch: Partial<Entity> = {}): Entity {
  return {
    id: "mesh",
    name: "Scan",
    kind: "mesh",
    positions: new Float32Array([...triangle, ...triangle.map((v) => v + 3)]),
    color: "#ffffff",
    visible: true,
    opacity: 1,
    ...patch,
  };
}
function harness(entities: Entity[] = [entity()]) {
  let sequence = 0;
  const cad = {
    alignmentReferences: vi.fn(),
    primitive: vi.fn(async () => ({
      kernelId: `native-${++sequence}`,
      positions: [...triangle],
      brep: "BREP",
    })),
    release: vi.fn(async () => {}),
  } as unknown as CadClient;
  const state: WorkspaceSnapshot = {
    name: "Test",
    entities,
    history: [],
    future: [],
    authoring: {},
    selectedId: "mesh",
    selection: new Uint8Array([1, 0]),
    settings: {},
  };
  const host: WorkspaceHost = {
    snapshot: () => state,
    cad: () => cad,
    commit: vi.fn((next, label, policy) => {
      const publication = policy?.newModelSketches?.length
        ? prepareModelSketchPublication(
            state.authoring,
            policy.newModelSketches,
          )
        : undefined;
      state.history.push({
        entities: state.entities,
        label,
        ...(publication ? { sketchChanges: publication.changes } : {}),
        ...(policy?.modelVisibilityFor?.length
          ? { restoreVisibilityFor: [...policy.modelVisibilityFor] }
          : {}),
      });
      if (publication) state.authoring = publication.authoring;
      state.entities = next;
    }),
    replace: vi.fn(),
    select: vi.fn(),
    setSelection: vi.fn((entityId, mask) => {
      state.selectedId = entityId;
      state.selection = mask;
    }),
    setSketch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    view: vi.fn(),
    settings: vi.fn(),
    busy: () => false,
    activity: vi.fn(),
  };
  const controller = new AbortController();
  const context: CommandContext = {
    signal: controller.signal,
    progress: vi.fn(),
    check: () => {
      if (controller.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
    },
    artifact: vi.fn((_data, name, mime) => ({
      artifactId: "artifact",
      name,
      mime,
      bytes: 1,
    })),
    artifactBlob: vi.fn(),
  };
  return { host, state, cad, context, controller, ops: createOperations(host) };
}

const source = entity({
  positions: new Float32Array([-1, 4, 0, 1, 4, 0, 0, 5, 0]),
});
const cutter = entity({
  id: "cutter",
  name: "Bounded plane display",
  kind: "plane",
  positions: new Float32Array([
    0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1,
  ]),
  fit: {
    kind: "plane",
    center: [0, 0, 0],
    axis: [1, 0, 0],
    rms: 0,
    maxError: 0,
  },
});
beforeEach(() => {
  vi.mocked(processMesh)
    .mockReset()
    .mockImplementation(async (request) => {
      if (request.kind !== "scanEdit") throw Error("Expected shared scan edit");
      return {
        kind: "scanEdit",
        diagnostics: {},
        scanEdit: runScanEdit(request),
      };
    });
});
it("publishes a precise single-mesh split as an update to the source", async () => {
  const mesh = entity({
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
  });
  const target = entity({
    id: "cut",
    positions: new Float32Array([1, -2, -1, 1, 4, -1, 1, -2, 3]),
  });
  const original = mesh.positions.slice();
  const h = harness([mesh, target]);
  const candidate = runFiniteSplitCandidate(
    mesh.positions,
    target.positions,
    undefined,
    {
      preciseCoordinates: true,
      outputMode: "single-mesh",
    },
  );
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "scanEdit",
    diagnostics: candidate.diagnostics,
    scanEdit: {
      positions: candidate.mesh.positions,
      diagnostics: candidate.diagnostics,
    },
    indexedMesh: candidate.mesh.indexedMesh,
  });
  await h.ops.mesh_process(
    {
      entityId: mesh.id,
      targetId: target.id,
      operation: { kind: "scanEdit", action: "split" },
    },
    h.context,
  );
  expect(h.state.entities).toHaveLength(2);
  const updated = h.state.entities.find((e) => e.id === mesh.id)!;
  expect(updated.visible).toBe(true);
  expect(indexedMeshMatches(updated.indexedMesh, updated.positions)).toBe(true);
  expect(updated.indexedMesh).toBe(candidate.mesh.indexedMesh);
  expect(h.state.entities.find((e) => e.id === target.id)).toBe(target);
  expect(h.state.history.at(-1)!.entities[0].positions).toEqual(original);
});
it("publishes indexed split segments through the shared operation", async () => {
  const h = harness([source, cutter]);
  const positions = new Float32Array(triangle);
  const indexed = {
    vertices: positions.slice(),
    triangles: new Uint32Array([0, 1, 2]),
  };
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "scanEdit",
    diagnostics: {},
    scanEdit: {
      segments: [positions],
      segmentIndexedMeshes: [indexed],
      diagnostics: {},
    },
  });
  const result = (await h.ops.mesh_process(
    {
      entityId: source.id,
      targetId: cutter.id,
      operation: { kind: "scanEdit", action: "split" },
    },
    h.context,
  )) as { entityIds: string[] };
  const part = h.state.entities.find((e) => e.id === result.entityIds[0])!;
  expect(part.positions).toBe(positions);
  expect(part.indexedMesh).toBe(indexed);
  expect(h.state.entities.find((e) => e.id === source.id)!.visible).toBe(false);
});
it("publishes a higher-precision indexed segment through the shared operation", async () => {
  const h = harness([source, cutter]);
  const positions = [100000000, 0, 0, 100000004, 4, 0, 99999992, 16, 0];
  const indexed = {
    vertices: [...positions],
    triangles: new Uint32Array([0, 1, 2]),
  };
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "scanEdit",
    diagnostics: {},
    scanEdit: {
      segments: [positions],
      segmentIndexedMeshes: [indexed],
      diagnostics: {},
    },
  });
  const result = (await h.ops.mesh_process(
    {
      entityId: source.id,
      targetId: cutter.id,
      operation: { kind: "scanEdit", action: "split" },
    },
    h.context,
  )) as { entityIds: string[] };
  const part = h.state.entities.find((e) => e.id === result.entityIds[0])!;
  expect(part.positions[3]).toBe(100000004);
  expect(part.indexedMesh!.vertices[3]).toBe(100000004);
});
it("publishes and reopens an actual precise candidate through the shared operation", async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const mesh = entity({
    positions,
    indexedMesh: {
      vertices: positions.slice(),
      triangles: new Uint32Array([0, 1, 2]),
    },
  });
  const tool = entity({
    id: "finite-cutter",
    kind: "mesh",
    positions: new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]),
  });
  const h = harness([mesh, tool]);
  vi.mocked(processMesh).mockImplementationOnce(async (request) => {
    if (
      request.kind !== "scanEdit" ||
      !(request.positions instanceof Float32Array) ||
      !(request.target instanceof Float32Array)
    )
      throw Error("Expected finite indexed request");
    const scanEdit = runFiniteSplitCandidate(
      request.positions,
      request.target,
      request.sourceIndexed as {
        vertices: Float32Array;
        triangles: Uint32Array;
      },
      { preciseCoordinates: true },
    );
    return { kind: "scanEdit", diagnostics: scanEdit.diagnostics, scanEdit };
  });
  const result = (await h.ops.mesh_process(
    {
      entityId: mesh.id,
      targetId: tool.id,
      operation: { kind: "scanEdit", action: "split" },
    },
    h.context,
  )) as { entityIds: string[] };
  expect(result.entityIds).toHaveLength(1);
  const part = h.state.entities.find(
    (item) => item.id === result.entityIds[0],
  )!;
  expect(Array.isArray(part.positions)).toBe(true);
  expect(indexedMeshMatches(part.indexedMesh, part.positions)).toBe(true);
  expect(h.state.history).toHaveLength(1);
  expect(mesh.positions).toBe(positions);
  const reopened = await decodeProjectFile(
    await encodeProjectFileLocally({
      project: {
        format: "maliev-scanforge",
        version: 1,
        name: "precise split",
        units: "mm",
        entities: h.state.entities,
      },
      history: h.state.history,
      future: [],
    }),
  );
  const savedPart = reopened.project.entities.find(
    (item) => item.id === part.id,
  )!;
  expect(indexedMeshMatches(savedPart.indexedMesh, savedPart.positions)).toBe(
    true,
  );
  expect(savedPart.positions).toEqual(part.positions);
  expect([...savedPart.indexedMesh!.triangles]).toEqual([
    ...part.indexedMesh!.triangles,
  ]);
});

it("does not publish a completed precise candidate after cancellation", async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const mesh = entity({ positions });
  const tool = entity({
    id: "finite-cutter",
    kind: "mesh",
    positions: new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]),
  });
  const h = harness([mesh, tool]);
  vi.mocked(processMesh).mockImplementationOnce(async (request) => {
    if (
      request.kind !== "scanEdit" ||
      !(request.positions instanceof Float32Array) ||
      !(request.target instanceof Float32Array)
    )
      throw Error("Expected finite request");
    const scanEdit = runFiniteSplitCandidate(
      request.positions,
      request.target,
      undefined,
      { preciseCoordinates: true },
    );
    h.controller.abort();
    return { kind: "scanEdit", diagnostics: scanEdit.diagnostics, scanEdit };
  });
  await expect(
    h.ops.mesh_process(
      {
        entityId: mesh.id,
        targetId: tool.id,
        operation: { kind: "scanEdit", action: "split" },
      },
      h.context,
    ),
  ).rejects.toThrow(/cancel/i);
  expect(h.state.entities).toEqual([mesh, tool]);
  expect(h.state.history).toHaveLength(0);
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(mesh.visible).toBe(true);
});
it("binds a sampled CAD cutter to the segment route through MCP", async () => {
  const mesh = entity({
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
  });
  const tool = entity({
    id: "cad-cutter",
    kind: "cad",
    kernelId: "cad-cutter-kernel",
    positions: new Float32Array([1, -2, -1, 1, 4, -1, 1, -2, 3]),
  });
  const h = harness([mesh, tool]);
  const result = (await h.ops.mesh_process(
    {
      entityId: mesh.id,
      targetId: tool.id,
      operation: { kind: "scanEdit", action: "split" },
    },
    h.context,
  )) as { entityIds: string[] };
  expect(vi.mocked(processMesh).mock.calls[0][0]).toMatchObject({
    target: tool.positions,
    targetIsNonMesh: true,
  });
  expect(result.entityIds).toHaveLength(2);
  expect(h.state.entities.find((e) => e.id === mesh.id)!.visible).toBe(false);
  expect(h.state.entities.find((e) => e.id === tool.id)).toBe(tool);
});
it("binds a fitted plane cutter as the same infinite plane used by the GUI", async () => {
  const h = harness([source, cutter]);
  const expected = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source.positions,
    plane: { origin: cutter.fit!.center, normal: cutter.fit!.axis },
  }).segments!;
  const result = (await h.ops.mesh_process(
    {
      entityId: source.id,
      targetId: cutter.id,
      operation: { kind: "scanEdit", action: "split" },
    },
    h.context,
  )) as { entityIds: string[] };
  expect(result.entityIds).toHaveLength(2);
  expect(
    result.entityIds.map(
      (id) => h.state.entities.find((e) => e.id === id)!.positions,
    ),
  ).toEqual(expected);
  expect(h.state.entities.find((e) => e.id === source.id)!.positions).toBe(
    source.positions,
  );
  expect(h.state.entities.find((e) => e.id === cutter.id)!.positions).toBe(
    cutter.positions,
  );
  expect(h.state.entities.find((e) => e.id === source.id)!.visible).toBe(false);
  expect(h.state.entities.find((e) => e.id === cutter.id)!.visible).toBe(true);
  expect(h.host.select).toHaveBeenCalledWith(result.entityIds[0]);
  expect(h.host.commit).toHaveBeenCalledOnce();
});
it("keeps an ordinary planar mesh cutter finite even when it has a plane fit", async () => {
  const target = { ...cutter, kind: "mesh" as const };
  const h = harness([source, target]);
  const result = (await h.ops.mesh_process(
    {
      entityId: source.id,
      targetId: target.id,
      operation: { kind: "scanEdit", action: "split" },
    },
    h.context,
  )) as { entityIds: string[] };
  expect(result.entityIds).toEqual([source.id]);
  expect(h.state.entities.find((e) => e.id === source.id)!.positions).toBe(
    source.positions,
  );
  expect(h.state.entities.find((e) => e.id === source.id)!.visible).toBe(true);
  expect(h.host.commit).not.toHaveBeenCalled();
});
it("publishes the unsplit tilted coplanar control through the shared MCP operation", async () => {
  const positions = new Float32Array([0, 0, 0, 7, 5, 21, 2, 2, 17]);
  const scan = entity({ id: "tilted-scan", positions });
  const target = entity({ id: "tilted-cutter", positions: positions.slice() });
  const h = harness([scan, target]);
  const result = (await h.ops.mesh_process(
    {
      entityId: scan.id,
      targetId: target.id,
      operation: { kind: "scanEdit", action: "split" },
    },
    h.context,
  )) as { entityIds: string[] };
  expect(result.entityIds).toHaveLength(1);
  expect(
    h.state.entities.find((e) => e.id === result.entityIds[0])!.positions,
  ).toEqual(positions);
  expect(h.state.entities.find((e) => e.id === scan.id)!.visible).toBe(true);
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(h.state.entities.find((e) => e.id === target.id)!.positions).toEqual(
    positions,
  );
});
it("component extraction retains raw source while hiding it and selecting its visible result like the GUI", async () => {
  const positions = new Float32Array([
    ...triangle,
    ...triangle.map((v, i) => (i % 3 === 0 ? v + 3 : v)),
  ]);
  const h = harness([entity({ positions, color: "#ff0000", opacity: 0.4 })]);
  const result = (await h.ops.mesh_process(
    {
      entityId: "mesh",
      operation: { kind: "scanEdit", action: "componentExtract", indices: [1] },
    },
    h.context,
  )) as { entityIds: string[] };
  expect(result.entityIds).toHaveLength(1);
  const original = h.state.entities.find((e) => e.id === "mesh")!,
    part = h.state.entities.find((e) => e.id === result.entityIds[0])!;
  expect(original.positions).toBe(positions);
  expect(original.visible).toBe(false);
  expect(part.visible).toBe(true);
  expect(part.opacity).toBe(1);
  expect(part.positions).toEqual(positions.slice(9));
  expect(h.host.select).toHaveBeenCalledWith(part.id);
});
it("publishes no empty segment transaction and preserves source/history on failure", async () => {
  const h = harness([source, cutter]);
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "scanEdit",
    diagnostics: {},
    scanEdit: {
      segments: [new Float32Array(), new Float32Array()],
      diagnostics: {},
    },
  });
  await expect(
    h.ops.mesh_process(
      {
        entityId: source.id,
        targetId: cutter.id,
        operation: { kind: "scanEdit", action: "split" },
      },
      h.context,
    ),
  ).rejects.toThrow(/no meshes|no.*segments|produced no/i);
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(h.host.select).not.toHaveBeenCalled();
  expect(h.state.entities).toEqual([source, cutter]);
});

it("uses a persisted planeFrame when transient fit metadata is absent", async () => {
  const target = {
    ...cutter,
    fit: undefined,
    planeFrame: {
      center: [0, 0, 0] as [number, number, number],
      normal: [1, 0, 0] as [number, number, number],
      tangent: [0, 1, 0] as [number, number, number],
    },
  };
  const h = harness([source, target]);
  const result = (await h.ops.mesh_process(
    {
      entityId: source.id,
      targetId: target.id,
      operation: { kind: "scanEdit", action: "split" },
    },
    h.context,
  )) as { entityIds: string[] };
  expect(result.entityIds).toHaveLength(2);
  expect(h.state.history[0].restoreVisibilityFor).toEqual([source.id]);
  const undo = seekModelRevision(h.state.history, h.state.entities, [], 0);
  expect(undo.entities.find((e) => e.id === source.id)!.visible).toBe(true);
  const redo = seekModelRevision(undo.history, undo.entities, undo.future, 1);
  expect(redo.entities.find((e) => e.id === source.id)!.visible).toBe(false);
});

it("preserves an explicit split plane instead of replacing it from the named cutter", async () => {
  const h = harness([source, cutter]);
  const plane = {
    origin: [5, 0, 0] as [number, number, number],
    normal: [1, 0, 0] as [number, number, number],
  };
  const expected = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source.positions,
    plane,
  }).segments!.filter((p) => p.length);
  const result = (await h.ops.mesh_process(
    {
      entityId: source.id,
      targetId: cutter.id,
      operation: { kind: "scanEdit", action: "split", plane },
    },
    h.context,
  )) as { entityIds: string[] };
  expect(
    result.entityIds.map(
      (id) => h.state.entities.find((e) => e.id === id)!.positions,
    ),
  ).toEqual(expected);
});

it("rejects point-cloud cutters before geometry work", async () => {
  const h = harness([
    source,
    { ...cutter, kind: "pointcloud", fit: undefined },
  ]);
  await expect(
    h.ops.mesh_process(
      {
        entityId: source.id,
        targetId: cutter.id,
        operation: { kind: "scanEdit", action: "split" },
      },
      h.context,
    ),
  ).rejects.toThrow(/triangle/);
  expect(processMesh).not.toHaveBeenCalled();
  expect(h.host.commit).not.toHaveBeenCalled();
});

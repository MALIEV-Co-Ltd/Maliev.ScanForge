import { expect, it, vi } from "vitest";
import { createOperations } from "../src/automation/operations";
import type {
  WorkspaceHost,
  WorkspaceSnapshot,
  CommandContext,
} from "../src/automation/api";
import type { CadClient } from "../src/cad/client";
import type { Entity } from "../src/types";
import { processMesh } from "../src/processing-client";
import { runScanTool } from "../src/scan-tools";
import { scanToolRequest } from "../src/ui/scan-tool-request";
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));
const triangle = [0, 0, 0, 2, 0, 0, 0, 2, 0];
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
    commit: vi.fn((next, label) => {
      state.history.push({ entities: state.entities, label });
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

it("routes GUI and MCP through identical multi-mesh reconstruction and diagnostics", async () => {
  const source = entity(),
    target = entity({ id: "target", positions: triangle });
  const h = harness([source, target]);
  const gui = runScanTool(
    scanToolRequest(
      source,
      {
        kind: "repolygonize",
        method: "voxel",
        resolution: 0.5,
        targetIds: [target.id],
      },
      h.state.entities,
    ),
  );
  vi.mocked(processMesh).mockImplementationOnce(async (request) => {
    if (request.kind !== "scanTools") throw Error("Expected scanTools");
    const result = runScanTool(request);
    return {
      kind: "scanTools",
      positions: result.positions,
      diagnostics: { ...result.diagnostics, summary: result.summary },
      topology: result.topology,
    };
  });
  const response = (await h.ops.mesh_process(
    {
      entityId: source.id,
      targetIds: [target.id],
      operation: {
        kind: "scanTools",
        operation: { kind: "repolygonize", method: "voxel", resolution: 0.5 },
      },
    },
    h.context,
  )) as { diagnostics: Record<string, unknown>; topology: unknown };
  expect(h.state.entities[0].positions).toEqual(gui.positions);
  expect(h.state.entities[1]).toBe(target);
  expect(response.diagnostics.watertight).toBe(true);
  expect(response.diagnostics.inputMeshes).toBe(2);
  expect(response.topology).toEqual(gui.topology);
  expect(h.host.commit).toHaveBeenCalledOnce();
});
it("rejects invalid MCP reconstruction references atomically", async () => {
  for (const targetIds of [
    ["mesh"],
    ["missing"],
    ["target", "target"],
    ["cad"],
  ]) {
    const h = harness([
      entity(),
      entity({ id: "target" }),
      entity({ id: "cad", kernelId: "exact" }),
    ]);
    await expect(
      h.ops.mesh_process(
        {
          entityId: "mesh",
          targetIds,
          operation: {
            kind: "scanTools",
            operation: {
              kind: "repolygonize",
              method: "voxel",
              resolution: 0.5,
            },
          },
        },
        h.context,
      ),
    ).rejects.toThrow();
    expect(h.host.commit).not.toHaveBeenCalled();
  }
});

it.each([false, true])(
  "publishes cloud reconstruction as a clean mesh with createNew=%s",
  async (createNew) => {
    const source = entity({
      kind: "pointcloud",
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
      normals: [1, 0, 0, 1, 0, 0],
      pointColors: new Uint8Array(8),
      pointSize: 4,
      pointAutoDensity: false,
      pointDensity: 70,
      pointColorMode: "source",
      ascAttributes: "xyz-normal",
      pointCloudPlacement: {
        matrixBits: "original-pose",
        sourcePositions: [0, 0, 0, 1, 1, 1],
      },
      meshSelection: { hidden: [0], saved: [] },
    });
    const target = entity({ id: "target" });
    const h = harness([source, target]);
    vi.mocked(processMesh).mockImplementationOnce(async (request) => {
      expect(request).toMatchObject({
        kind: "scanTools",
        operation: {
          kind: "repolygonize",
          inputKind: "points",
          targetInputs: [{ kind: "triangles", positions: target.positions }],
        },
      });
      return {
        kind: "scanTools",
        positions: new Float32Array(triangle),
        diagnostics: { inputPoints: 2, representedPoints: 2 },
      };
    });
    const response = (await h.ops.mesh_process(
      {
        entityId: source.id,
        targetIds: [target.id],
        createNew,
        operation: {
          kind: "scanTools",
          operation: { kind: "repolygonize", resolution: 0.5 },
        },
      },
      h.context,
    )) as { entityIds: string[]; diagnostics: Record<string, number> };
    const output = h.state.entities.find(
      (e) => e.id === response.entityIds[0],
    )!;
    expect(output.kind).toBe("mesh");
    expect(output.positions).toEqual(new Float32Array(triangle));
    for (const key of [
      "pointColors",
      "pointCloudPlacement",
      "pointSize",
      "pointAutoDensity",
      "pointDensity",
      "pointColorMode",
      "ascAttributes",
      "normals",
      "meshSelection",
    ])
      expect(output[key as keyof Entity]).toBeUndefined();
    expect(h.state.entities.find((e) => e.id === target.id)).toBe(target);
    if (createNew) expect(h.state.entities[0]).toBe(source);
    else expect(output.id).toBe(source.id);
    expect(h.host.commit).toHaveBeenCalledOnce();
    expect(h.state.history[0].entities[0]).toBe(source);
    expect(response.diagnostics.representedPoints).toBe(2);
  },
);

it("binds cloud targets from workspace objects for a mesh source", async () => {
  const source = entity(),
    target = entity({ id: "cloud", kind: "pointcloud", positions: [1, 2, 3] });
  const h = harness([source, target]);
  vi.mocked(processMesh).mockImplementationOnce(async (request) => {
    expect(request).toMatchObject({
      operation: {
        inputKind: "triangles",
        targetInputs: [{ kind: "points", positions: target.positions }],
      },
    });
    return {
      kind: "scanTools",
      positions: new Float32Array(triangle),
      diagnostics: {},
    };
  });
  await h.ops.mesh_process(
    {
      entityId: source.id,
      targetIds: [target.id],
      operation: { kind: "scanTools", operation: { kind: "repolygonize" } },
    },
    h.context,
  );
  expect(h.state.entities[1]).toBe(target);
});

it.each(["targets", "targetInputs", "inputKind"])(
  "rejects injected reconstruction field %s atomically",
  async (field) => {
    const h = harness();
    await expect(
      h.ops.mesh_process(
        {
          entityId: "mesh",
          operation: {
            kind: "scanTools",
            operation: {
              kind: "repolygonize",
              [field]: field === "inputKind" ? "points" : [],
            },
          },
        },
        h.context,
      ),
    ).rejects.toThrow(/geometry|workspace/i);
    expect(h.host.commit).not.toHaveBeenCalled();
  },
);

import {
  scanToolRequest,
  stagedScanToolRequest,
} from "../src/ui/scan-tool-request";
import { describe, it, expect, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  createOperations,
  createCadFeature,
  rebuildCadFeature,
} from "../src/automation/operations";
import type {
  WorkspaceHost,
  WorkspaceSnapshot,
  CommandContext,
} from "../src/automation/api";
import type { CadClient } from "../src/cad/client";
import type { Entity } from "../src/types";
import type { ParametricRecipe } from "../src/parametric";
import { processMesh } from "../src/processing-client";
import { extractSketchSection } from "../src/sketch-section";
import { createGridPatch } from "../src/surfaces";
import {
  runScanEdit,
  runScanEditAsync,
  type ScanEditRequest,
} from "../src/scan-edit";
import smoothingInput from "./fixtures/defeature-annular.json";
import { runScanTool } from "../src/scan-tools";
import { reductionGrid } from "./helpers/reduction-grid";
import { ScanPreviewSession } from "../src/scan-preview";
import boundaryNative from "./fixtures/boundary-smooth-observed-annulus.json";
import anchorNative from "./fixtures/boundary-smooth-anchor-inner-native.json";
import twoAnchorNative from "./fixtures/boundary-smooth-two-anchors-native.json";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { indexedMeshMatches } from "../src/indexed-mesh";
import { withCurvatureKernel } from "./helpers/curvature-kernel-vm";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));

const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];
it.each([undefined, 0.000001])(
  "uses GUI analysis tolerance by default and preserves explicit tolerance %s",
  async (tolerance) => {
    const h = harness();
    vi.mocked(processMesh).mockResolvedValueOnce({
      kind: "report",
      diagnostics: {},
    });
    await h.ops.mesh_analyze({ entityId: "mesh", tolerance }, h.context);
    expect(vi.mocked(processMesh).mock.lastCall?.[0]).toMatchObject({
      kind: "report",
      tolerance: tolerance ?? 0.001,
    });
  },
);
it("uses reusable geometry processing for MCP analysis and inventory", async () => {
  const h = harness();
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "report",
    diagnostics: {},
  });
  await h.ops.mesh_analyze({ entityId: "mesh", tolerance: 0.001 }, h.context);
  expect(vi.mocked(processMesh).mock.lastCall?.[1]).toMatchObject({
    reuseTopology: true,
    signal: h.context.signal,
  });
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "scanEdit",
    diagnostics: {},
    scanEdit: {
      inventory: { components: [], boundaries: [] },
      diagnostics: {},
    },
  });
  await h.ops.mesh_process(
    {
      entityId: "mesh",
      operation: { kind: "scanEdit", action: "inventory", tolerance: 0.001 },
    },
    h.context,
  );
  expect(vi.mocked(processMesh).mock.lastCall?.[1]).toMatchObject({
    reuseTopology: true,
    signal: h.context.signal,
  });
  expect(h.host.commit).not.toHaveBeenCalled();
});
it("renames the selected objects in browser order in one transaction", () => {
  const h = harness([entity(), entity({ id: "b" }), entity({ id: "c" })]);
  h.state.selectedIds = ["c", "mesh", "b"];
  h.ops.object_rename({ name: " scan " }, h.context);
  expect(h.state.entities.map((e) => e.name)).toEqual([
    "scan - 1",
    "scan - 2",
    "scan - 3",
  ]);
  expect(h.host.commit).toHaveBeenCalledOnce();
  expect(h.state.selectedIds).toEqual(["c", "mesh", "b"]);
});
it("renames one object without numbering and rejects invalid batches atomically", () => {
  const h = harness();
  h.ops.object_rename({ name: "scan" }, h.context);
  expect(h.state.entities[0].name).toBe("scan");
  for (const args of [
    { name: " " },
    { name: "scan", entityIds: [] },
    { name: "scan", entityIds: ["missing"] },
  ])
    expect(() => h.ops.object_rename(args, h.context)).toThrow();
  expect(h.host.commit).toHaveBeenCalledTimes(1);
});
it("shares indexed point-pair refinement target validation and worker controls", async () => {
  const indexedMesh = {
    vertices: Float32Array.from(triangle),
    triangles: new Uint32Array([0, 1, 2]),
  };
  const source = entity({ positions: indexedMesh.vertices, indexedMesh });
  const target = entity({
    id: "fixed",
    positions: indexedMesh.vertices,
    indexedMesh,
  });
  const h = harness([source, target]);
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "paired",
    diagnostics: {},
  } as never);
  await h.ops.mesh_process(
    {
      entityId: source.id,
      targetId: target.id,
      operation: {
        kind: "paired",
        refineSurface: true,
        sourceLandmarks: triangle,
        targetLandmarks: triangle,
        workerCount: 4,
        parallel: false,
      },
    },
    h.context,
  );
  expect(vi.mocked(processMesh).mock.calls.at(-1)![0]).toMatchObject({
    sourceIndexed: indexedMesh,
    refinementTargets: [{ positions: target.positions, indexedMesh }],
    workerCount: 4,
    parallel: false,
  });
  await expect(
    h.ops.mesh_process(
      {
        entityId: source.id,
        operation: {
          kind: "paired",
          refineSurface: true,
          sourceLandmarks: triangle,
          targetLandmarks: triangle,
        },
      },
      h.context,
    ),
  ).rejects.toThrow("targetId");
  await expect(
    h.ops.mesh_process(
      {
        entityId: source.id,
        targetId: source.id,
        operation: {
          kind: "paired",
          refineSurface: true,
          sourceLandmarks: triangle,
          targetLandmarks: triangle,
        },
      },
      h.context,
    ),
  ).rejects.toThrow("different objects");
});
it("toggles every selected object's visibility in one commit without changing geometry or selection", () => {
  const a = entity({ id: "a", visible: true }),
    b = entity({ id: "b", visible: false }),
    unselected = entity({ id: "c" });
  const { ops, state, context, host } = harness([a, b, unselected]);
  state.selectedId = "b";
  state.selectedIds = ["a", "b"];
  expect(ops.object_visibility_toggle({}, context)).toEqual({
    objects: [
      { entityId: "a", visible: false },
      { entityId: "b", visible: true },
    ],
  });
  expect(state.entities.map((e) => e.visible)).toEqual([false, true, true]);
  expect(state.entities[0].positions).toBe(a.positions);
  expect(state.entities[2]).toBe(unselected);
  expect(state.selectedIds).toEqual(["a", "b"]);
  expect(host.commit).toHaveBeenCalledTimes(1);
  ops.object_visibility_toggle({}, context);
  expect(state.entities.map((e) => e.visible)).toEqual([true, false, true]);
});
it("rejects stale or empty visibility targets before any mutation and supports explicit locked display targets", () => {
  const { ops, state, context } = harness([entity({ id: "a", locked: true })]);
  state.selectedId = null;
  state.selectedIds = [];
  expect(() => ops.object_visibility_toggle({}, context)).toThrow("Select");
  expect(() =>
    ops.object_visibility_toggle({ entityIds: ["a", "missing"] }, context),
  ).toThrow("exist");
  expect(state.history).toHaveLength(0);
  ops.object_visibility_toggle({ entityIds: ["a", "a"] }, context);
  expect(state.entities[0].visible).toBe(false);
  expect(state.history).toHaveLength(1);
});
it("imports a CAD batch through MCP in order, preserving undo steps and waiting for presentation", async () => {
  const { host, state, cad, context, ops } = harness([]);
  const presented: number[] = [];
  host.present = async () => {
    presented.push(state.entities.length);
  };
  cad.importFile = vi.fn(async () => ({
    kernelId: `native-${state.entities.length}`,
    positions: [...triangle],
    brep: "BREP",
  }));
  vi.mocked(context.artifactBlob).mockImplementation(
    (id) => new File(["CAD"], `${id}.step`),
  );
  const result = await ops.project_import_batch(
    { artifactIds: ["first", "second"] },
    context,
  );
  expect(result).toMatchObject({
    completed: [{ triangles: 1 }, { triangles: 1 }],
    failed: [],
    cancelled: false,
  });
  expect(state.entities.map((e) => e.name)).toEqual([
    "first.step",
    "second.step",
  ]);
  expect(state.history).toHaveLength(2);
  expect(presented).toEqual([1, 2]);
});
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
const recipe: ParametricRecipe = {
  kind: "primitive",
  input: { kind: "box", center: [0, 0, 0], size: [1, 1, 1] },
};
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
it("retains indexed vertex identities and refreshes geometry normals when flipping a scan", async () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const positions = Float32Array.from(
    Array.from(triangles).flatMap((id) =>
      Array.from(vertices.slice(id * 3, id * 3 + 3)),
    ),
  );
  const indexedMesh = { vertices, triangles };
  const h = harness([entity({ positions, indexedMesh })]);
  vi.mocked(processMesh).mockImplementationOnce(async (request) => {
    if (request.kind !== "scanTools") throw new Error("Expected scan tools");
    const result = runScanTool(request);
    return {
      kind: "scanTools",
      positions: result.positions,
      indexedMesh: result.indexedMesh,
      diagnostics: { summary: result.summary },
    };
  });
  await h.ops.mesh_process(
    {
      entityId: "mesh",
      operation: { kind: "scanTools", operation: { kind: "flipNormals" } },
    },
    h.context,
  );
  const result = h.state.entities[0];
  expect(result.indexedMesh).toBeDefined();
  expect(Array.from(result.indexedMesh!.triangles)).toEqual([0, 2, 1, 0, 3, 2]);
  expect(Array.from(result.indexedMesh!.vertices)).toEqual(
    Array.from(vertices),
  );
  expect(Array.from(result.indexedMesh!.geometryNormals!)).toEqual([
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
  ]);
  expect(Array.from(triangles)).toEqual([0, 1, 2, 0, 2, 3]);
});

it("binds the same indexed topology for the Flip Normals ribbon and MCP", () => {
  const positions = Float32Array.from(triangle);
  const mesh = {
    vertices: positions,
    triangles: new Uint32Array([0, 1, 2]),
    facetNormals: new Float32Array([0, 0, 1]),
  };
  const source = entity({ positions, indexedMesh: mesh });
  const request = scanToolRequest(source, { kind: "flipNormals" }, [source]);
  expect(request.operation).toEqual({
    kind: "flipNormals",
    sourceTopology: mesh,
  });
});

it("cancels GUI and MCP Flip admission without starting the worker or changing the model", async () => {
  const vertices = new Float32Array(300_000);
  const triangles = new Uint32Array(300_000);
  const positions = new Float32Array(900_000);
  const source = entity({ positions, indexedMesh: { vertices, triangles } });
  const h = harness([source]);
  const priorCalls = vi.mocked(processMesh).mock.calls.length;
  const timer = setTimeout(() => h.controller.abort(), 0);
  try {
    await expect(
      h.ops.mesh_process(
        {
          entityId: "mesh",
          operation: { kind: "scanTools", operation: { kind: "flipNormals" } },
        },
        h.context,
      ),
    ).rejects.toThrow();
  } finally {
    clearTimeout(timer);
  }
  expect(vi.mocked(processMesh).mock.calls.length).toBe(priorCalls);
  expect(h.host.commit).not.toHaveBeenCalled();
  expect(h.state.entities[0]).toBe(source);

  const guiController = new AbortController();
  const guiTimer = setTimeout(() => guiController.abort(), 0);
  try {
    await expect(
      stagedScanToolRequest(
        source,
        { kind: "flipNormals" },
        [source],
        undefined,
        () => guiController.signal.throwIfAborted(),
      ),
    ).rejects.toThrow();
  } finally {
    clearTimeout(guiTimer);
  }
  expect(source.positions).toBe(positions);
  expect(source.indexedMesh?.triangles).toBe(triangles);
});

it("rejects oversized indexed vertices before starting Flip Normals", async () => {
  const positions = Float32Array.from(triangle);
  const indexedMesh = {
    vertices: new Array<number>(27_000_001),
    triangles: new Uint32Array([0, 1, 2]),
  };
  const h = harness([entity({ positions, indexedMesh })]);
  const priorCalls = vi.mocked(processMesh).mock.calls.length;
  await expect(
    h.ops.mesh_process(
      {
        entityId: "mesh",
        operation: { kind: "scanTools", operation: { kind: "flipNormals" } },
      },
      h.context,
    ),
  ).rejects.toThrow(/indexed vertices exceed/i);
  expect(vi.mocked(processMesh).mock.calls.length).toBe(priorCalls);
  expect(h.host.commit).not.toHaveBeenCalled();
});

it("shares compact global reduction between GUI preview and MCP above the old admission boundary", async () => {
  const positions = reductionGrid(160, 128),
    before = positions.slice();
  const operation = {
    kind: "reducePolygons" as const,
    mode: "percentage" as const,
    percentage: 50,
  };
  const preview = await ScanPreviewSession.create({
    kind: "scanPreview",
    phase: "create",
    previewId: "compact-global",
    positions,
    operation,
  });
  const h = harness([entity({ positions })]);
  vi.mocked(processMesh).mockImplementationOnce(async (request) => {
    if (request.kind !== "scanTools")
      throw new Error("Expected shared scan tool");
    const result = runScanTool(request);
    return {
      kind: "scanTools",
      positions: result.positions,
      diagnostics: { summary: result.summary },
    };
  });
  await h.ops.mesh_process(
    { entityId: "mesh", operation: { kind: "scanTools", operation } },
    h.context,
  );
  expect(h.state.entities[0].positions).toEqual(preview.output);
  expect(h.state.entities[0].positions.length / 9).toBe(20480);
  expect(h.host.commit).toHaveBeenCalledOnce();
  expect(positions).toEqual(before);
});
it.each([8, 160])(
  "MCP invalid global reduction retains source and history at width %s",
  async (width) => {
    const valid = reductionGrid(width, 128);
    for (const invalid of [
      [0, 0, 0, 1, 0, 0, 1, 0, 0],
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 0],
      [
        0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0,
        0, 0, 1,
      ],
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, -1, 0, 0],
    ]) {
      const positions = new Float32Array(valid.length + invalid.length);
      positions.set(valid);
      positions.set(
        invalid.map((x, i) => (i % 3 === 2 ? x : x - 20)),
        valid.length,
      );
      const before = positions.slice(),
        h = harness([entity({ positions })]);
      vi.mocked(processMesh).mockImplementationOnce(async (request) => {
        if (request.kind !== "scanTools")
          throw new Error("Expected shared scan tool");
        const result = runScanTool(request);
        return {
          kind: "scanTools",
          positions: result.positions,
          diagnostics: { summary: result.summary },
        };
      });
      await expect(
        h.ops.mesh_process(
          {
            entityId: "mesh",
            operation: {
              kind: "scanTools",
              operation: {
                kind: "reducePolygons",
                mode: "percentage",
                percentage: 50,
              },
            },
          },
          h.context,
        ),
      ).rejects.toThrow("Repair invalid");
      expect(h.host.commit).not.toHaveBeenCalled();
      expect(h.state.history).toEqual([]);
      expect(h.state.entities[0].positions).toBe(positions);
      expect(
        Buffer.from(positions.buffer).equals(Buffer.from(before.buffer)),
      ).toBe(true);
    }
  },
);
it("retains segmentation classification fits in agent-created regions", async () => {
  const h = harness(),
    fit = {
      kind: "plane" as const,
      center: [0, 0, 0] as [number, number, number],
      axis: [0, 0, 1] as [number, number, number],
      rms: 0,
      maxError: 0,
    };
  vi.mocked(processMesh).mockResolvedValueOnce({
    segments: [new Float32Array(triangle)],
    segmentClassifications: [{ kind: "plane", fit }],
  } as never);
  const result = (await h.ops.mesh_process(
    {
      entityId: "mesh",
      operation: { kind: "segment", tolerance: 0.001, angleDegrees: 180 },
      createNew: true,
    },
    h.context,
  )) as { entityIds: string[]; segmentClassifications: { fit: unknown }[] };
  expect(
    h.state.entities.find((entity) => entity.id === result.entityIds[0])?.fit,
  ).toEqual(fit);
  expect(result.segmentClassifications[0].fit).toEqual(fit);
  expect(h.host.commit).toHaveBeenCalledTimes(1);
});

describe("shared workspace operation contracts", () => {
  it.each([undefined, 1])(
    "reports preview sampling consistently for accepted count %s",
    async (acceptedTriangles) => {
      const scanSource = {
        bytes: 184,
        triangles: 2,
        displayedTriangles: 1,
        ...(acceptedTriangles === undefined ? {} : { acceptedTriangles }),
      };
      const h = harness([entity({ scanSource })]);
      vi.mocked(processMesh).mockRejectedValueOnce(
        new Error("request captured"),
      );
      await expect(
        h.ops.mesh_process(
          {
            entityId: "mesh",
            operation: {
              kind: "sketchSection",
              options: {
                plane: "OXY",
                offset: 0,
                onSlicingPlane: true,
                selectedOnly: false,
              },
            },
          },
          h.context,
        ),
      ).rejects.toThrow("request captured");
      expect(vi.mocked(processMesh).mock.lastCall![0]).toMatchObject({
        sampled: acceptedTriangles === undefined,
      });
      const state = (await h.ops.project_get({}, h.context)) as {
        objects: { scanSource: unknown }[];
      };
      expect(state.objects[0].scanSource).toEqual(scanSource);
    },
  );
  it("applies the stronger selected-smoothing preset through MCP and honors explicit overrides", async () => {
    const positions = new Float32Array(smoothingInput.positions);
    for (const iterations of [undefined, 2]) {
      const h = harness([entity({ positions })]);
      h.state.selection = new Uint8Array(smoothingInput.selection);
      vi.mocked(processMesh).mockImplementationOnce(async (request) => {
        const edit = runScanEdit(request as ScanEditRequest);
        return {
          kind: "scanEdit",
          scanEdit: edit,
          diagnostics: edit.diagnostics,
        };
      });
      await h.ops.mesh_process(
        {
          entityId: "mesh",
          selectionOnly: true,
          operation: {
            kind: "scanEdit",
            action: "smoothSelected",
            ...(iterations === undefined ? {} : { iterations, strength: 0.5 }),
          },
        },
        h.context,
      );
      expect(h.state.entities[0].positions).toEqual(
        runScanEdit({
          kind: "scanEdit",
          action: "smoothSelected",
          positions,
          selection: new Uint8Array(smoothingInput.selection),
          iterations: iterations ?? 6,
          strength: 0.5,
        }).positions,
      );
      expect(h.host.commit).toHaveBeenCalledOnce();
    }
  });

  it("rejects degenerate boundary smoothing through the shared operation without MCP publication", async () => {
    const positions = Float32Array.from([
        0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0, 10, 0, 0, 10, 0,
        0, 10, 0, 0,
      ]),
      before = positions.slice();
    const h = harness([entity({ positions })]);
    h.state.selection = new Uint8Array(3);
    vi.mocked(processMesh).mockImplementationOnce(async (request) => {
      if (request.kind !== "scanEdit") throw new Error("Unexpected operation");
      const scanEdit = await runScanEditAsync(request);
      return { kind: "scanEdit", scanEdit, diagnostics: scanEdit.diagnostics };
    });
    await expect(
      h.ops.mesh_process(
        {
          entityId: "mesh",
          operation: { kind: "scanEdit", action: "boundarySmooth" },
        },
        h.context,
      ),
    ).rejects.toThrow(/degenerate/i);
    expect(h.host.commit).not.toHaveBeenCalled();
    expect(h.state.history).toHaveLength(0);
    expect(h.state.entities[0].positions).toBe(positions);
    expect(positions).toEqual(before);
  });

  it("routes a boundary inventory anchor through MCP and publishes the native result", async () => {
    const positions = Float32Array.from(boundaryNative.source);
    const indexedMesh = nativeStlTopology(positions);
    const topology = analyzeIndexedMesh(
      Float64Array.from(indexedMesh.vertices),
      indexedMesh.triangles,
    );
    const boundaries = [...topology.boundaryLoops, ...topology.boundaryChains];
    const boundary = boundaries.findIndex((ids) =>
      ids.some((id) =>
        anchorNative.anchorObservedPosition.every(
          (v, axis) => topology.vertices[id * 3 + axis] === v,
        ),
      ),
    );
    const point = boundaries[boundary].findIndex((id) =>
      anchorNative.anchorObservedPosition.every(
        (v, axis) => topology.vertices[id * 3 + axis] === v,
      ),
    );
    const h = harness([entity({ positions, indexedMesh })]);
    await withCurvatureKernel(async () => {
      vi.mocked(processMesh).mockImplementationOnce(async (request) => {
        const scanEdit = await runScanEditAsync(request as ScanEditRequest, {
          topologyCache: { positions, tolerance: 1e-6, topology },
        });
        return {
          kind: "scanEdit",
          scanEdit,
          diagnostics: scanEdit.diagnostics,
        };
      });
      await h.ops.mesh_process(
        {
          entityId: "mesh",
          operation: {
            kind: "scanEdit",
            action: "boundarySmooth",
            strength: 0.5,
            anchors: [{ boundary, point }],
          },
        },
        h.context,
      );
      expect(vi.mocked(processMesh).mock.lastCall?.[0]).toMatchObject({
        anchors: [{ boundary, point }],
      });
      expect(h.host.commit).toHaveBeenCalledOnce();
      expect(h.state.history).toHaveLength(1);
      const result = h.state.entities[0].positions;
      const zero = 16 * Number.EPSILON * 5;
      for (let i = 0; i < result.length; i++) {
        if (
          Math.abs(result[i]) <= zero &&
          Math.abs(anchorNative.output[i]) <= zero
        )
          continue;
        expect(result[i], `native MCP coordinate ${i}`).toBe(
          anchorNative.output[i],
        );
      }
    });
  }, 30000);

  it("routes two boundary inventory anchors through MCP and publishes the native result", async () => {
    const positions = Float32Array.from(boundaryNative.source);
    const indexedMesh = nativeStlTopology(positions);
    const topology = analyzeIndexedMesh(
      Float64Array.from(indexedMesh.vertices),
      indexedMesh.triangles,
    );
    const boundaries = [...topology.boundaryLoops, ...topology.boundaryChains];
    const anchors = twoAnchorNative.anchorObservedPositions.map((position) => {
      const boundary = boundaries.findIndex((ids) =>
        ids.some((id) =>
          position.every((v, axis) => topology.vertices[id * 3 + axis] === v),
        ),
      );
      const point = boundaries[boundary].findIndex((id) =>
        position.every((v, axis) => topology.vertices[id * 3 + axis] === v),
      );
      return { boundary, point };
    });
    const h = harness([entity({ positions, indexedMesh })]);
    await withCurvatureKernel(async () => {
      vi.mocked(processMesh).mockImplementationOnce(async (request) => {
        const scanEdit = await runScanEditAsync(request as ScanEditRequest, {
          topologyCache: { positions, tolerance: 1e-6, topology },
        });
        return {
          kind: "scanEdit",
          scanEdit,
          diagnostics: scanEdit.diagnostics,
        };
      });
      await h.ops.mesh_process(
        {
          entityId: "mesh",
          operation: {
            kind: "scanEdit",
            action: "boundarySmooth",
            strength: 0.5,
            anchors,
          },
        },
        h.context,
      );
      expect(vi.mocked(processMesh).mock.lastCall?.[0]).toMatchObject({
        anchors,
      });
      expect(h.host.commit).toHaveBeenCalledOnce();
      expect(h.state.history).toHaveLength(1);
      const result = h.state.entities[0].positions;
      const zero = 16 * Number.EPSILON * 5;
      for (let i = 0; i < result.length; i++) {
        if (
          Math.abs(result[i]) <= zero &&
          Math.abs(twoAnchorNative.output[i]) <= zero
        )
          continue;
        expect(result[i], `native MCP coordinate ${i}`).toBe(
          twoAnchorNative.output[i],
        );
      }
    });
  }, 30000);

  it("routes MCP boundary smoothing defaults through the actual worker and pinned CAD kernel", async () => {
    const positions = Float32Array.from(boundaryNative.source),
      before = positions.slice();
    const indexedMesh = nativeStlTopology(positions);
    const h = harness([entity({ positions, indexedMesh })]);
    h.state.selection = new Uint8Array(positions.length / 9);
    await withCurvatureKernel(async () => {
      let reply: Exclude<ProcessingResponse, { progress: number }> | undefined;
      const scope = {
        location: self.location,
        onmessage: null as
          null | ((event: { data: ProcessingRequest }) => Promise<void>),
        postMessage: (
          response: ProcessingResponse,
          transfer: Transferable[] = [],
        ) => {
          if (!("progress" in response))
            reply = structuredClone(response, { transfer });
        },
      };
      vi.stubGlobal("self", scope);
      await import("../src/processing-worker");
      vi.mocked(processMesh).mockImplementationOnce(async (request) => {
        await scope.onmessage!({ data: request });
        if (!reply)
          throw new Error("Worker did not publish a terminal response.");
        if ("error" in reply) throw new Error(reply.error);
        return reply.result;
      });
      await h.ops.mesh_process(
        {
          entityId: "mesh",
          operation: { kind: "scanEdit", action: "boundarySmooth" },
        },
        h.context,
      );
      if (!reply || !("result" in reply))
        throw new Error("Worker did not publish a result.");
      expect(reply.result.scanEdit!.diagnostics).toMatchObject({
        passesPerBoundary: 20,
        iterations: 1,
        strength: 1,
        fittedBoundaries: 2,
        changed: true,
      });
      expect(h.host.commit).toHaveBeenCalledOnce();
      expect(h.state.history).toHaveLength(1);
      const successor = h.state.entities[0];
      expect(successor.indexedMesh!.triangles).toEqual(indexedMesh.triangles);
      expect(
        indexedMeshMatches(successor.indexedMesh, successor.positions),
      ).toBe(true);
      const zero = 16 * Number.EPSILON * 5;
      for (let i = 0; i < successor.positions.length; i++) {
        const actual = successor.positions[i],
          expected = boundaryNative.output[i];
        if (Math.abs(actual) <= zero && Math.abs(expected) <= zero) continue;
        expect(actual, `native MCP coordinate ${i}`).toBe(expected);
      }
      expect(positions).toEqual(before);
    });
  }, 30000);

  it("passes ordered fixed mesh targets through shared refinement without changing them", async () => {
    const indexedMesh = {
      vertices: new Float32Array(triangle),
      triangles: new Uint32Array([0, 1, 2]),
    };
    const source = entity({ positions: indexedMesh.vertices, indexedMesh });
    const first = entity({
      id: "fixed-first",
      positions: indexedMesh.vertices,
      indexedMesh,
    });
    const second = entity({
      id: "fixed-second",
      positions: indexedMesh.vertices,
      indexedMesh,
    });
    const h = harness([source, first, second]);
    vi.mocked(processMesh).mockResolvedValueOnce({
      positions: source.positions,
      indexedMesh,
    } as never);
    await h.ops.mesh_process(
      {
        entityId: source.id,
        targetIds: [second.id, first.id],
        operation: {
          kind: "nativeRefine",
          sampleBudget: 500,
          initialRadius: 10,
          workerCount: 2,
          parallel: false,
        },
      },
      h.context,
    );
    expect(vi.mocked(processMesh).mock.calls.at(-1)![0]).toMatchObject({
      target: second.positions,
      additionalTargets: [{ positions: first.positions, indexedMesh }],
      workerCount: 2,
      parallel: false,
    });
    expect(h.state.entities.slice(1)).toEqual([first, second]);
    await expect(
      h.ops.mesh_process(
        {
          entityId: source.id,
          targetIds: [first.id, first.id],
          operation: {
            kind: "nativeRefine",
            sampleBudget: 500,
            initialRadius: 10,
          },
        },
        h.context,
      ),
    ).rejects.toThrow("distinct");
    await expect(
      h.ops.mesh_process(
        {
          entityId: source.id,
          targetId: first.id,
          targetIds: [second.id],
          operation: {
            kind: "nativeRefine",
            sampleBudget: 500,
            initialRadius: 10,
          },
        },
        h.context,
      ),
    ).rejects.toThrow("not both");
  });
  it.each(["paired", "icp", "global"] as const)(
    "retains indexed topology through MCP %s processing and undo snapshots",
    async (kind) => {
      const moving = entity();
      moving.indexedMesh = {
        vertices: new Float32Array(moving.positions),
        triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
      };
      const h = harness([moving, entity({ id: "fixed" })]);
      const indexedMesh = {
        vertices: new Float32Array(moving.indexedMesh.vertices),
        triangles: new Uint32Array(moving.indexedMesh.triangles),
      };
      vi.mocked(processMesh).mockResolvedValueOnce({
        kind,
        diagnostics: {},
        positions: new Float32Array(moving.positions),
        indexedMesh,
      });
      await h.ops.mesh_process(
        {
          entityId: moving.id,
          targetId: "fixed",
          operation: {
            kind,
            sourceLandmarks: [0, 0, 0, 10, 0, 0, 0, 10, 0],
            targetLandmarks: [0, 0, 0, 10, 0, 0, 0, 10, 0],
          },
        },
        h.context,
      );
      expect(vi.mocked(processMesh).mock.calls.at(-1)?.[0]).toMatchObject({
        sourceIndexed: moving.indexedMesh,
      });
      expect(h.state.entities[0].indexedMesh).toBe(indexedMesh);
      expect(h.state.history[0].entities[0].indexedMesh).toBe(
        moving.indexedMesh,
      );
    },
  );
  it("binds imported exact CAD as a project-local persistent seed", async () => {
    const h = harness([entity({ kernelId: "native", brep: "BREP" })]);
    const result = (await h.ops.cad_bind({ entityId: "mesh" }, h.context)) as {
      ref: { featureId: string };
    };
    expect(h.state.entities[0].parametric?.feature.id).toBe(
      result.ref.featureId,
    );
    expect(h.state.entities[0].kernelId).toBe("native");
  });
  it("creates a NURBS authoring patch when no target is supplied", async () => {
    const h = harness([]);
    await h.ops.surface_set(
      { patch: createGridPatch(10, 10, 3, 3) },
      h.context,
    );
    expect(h.state.entities).toHaveLength(1);
    expect(h.state.entities[0].surfacePatch).toBeDefined();
  });
  it("does not classify its own mesh commit as a stale revision", async () => {
    const h = harness();
    const initial = h.state.entities;
    h.context.check = () => {
      if (h.state.entities !== initial) throw new Error("Stale revision");
    };
    vi.mocked(processMesh).mockResolvedValueOnce({
      kind: "scanEdit",
      diagnostics: {},
      scanEdit: {
        positions: new Float32Array(triangle),
        curves: [[0, 0, 0, 1, 0, 0]],
        diagnostics: {},
      },
    });
    const response = (await h.ops.mesh_process(
      {
        entityId: "mesh",
        operation: { kind: "scanEdit", action: "fillHoles" },
      },
      h.context,
    )) as { artifact: unknown };
    expect(h.host.commit).toHaveBeenCalledOnce();
    expect(response.artifact).toBeDefined();
  });
  it("rejects partial mesh replacement before launching an operation", async () => {
    const h = harness();
    await expect(
      h.ops.mesh_process(
        {
          entityId: "mesh",
          operation: {
            kind: "smooth",
            iterations: 1,
            strength: 0.5,
            tolerance: 1e-6,
          },
          selectionOnly: true,
        },
        h.context,
      ),
    ).rejects.toThrow("createNew");
    expect(h.host.commit).not.toHaveBeenCalled();
  });
  it("partitions a triangle selection without changing unselected coordinates", async () => {
    const h = harness();
    const original = h.state.entities[0].positions.slice();
    const result = (await h.ops.selection_edit(
      { entityId: "mesh", operation: "cut" },
      h.context,
    )) as { entityId: string };
    expect(h.state.entities.find((e) => e.id === "mesh")!.positions).toEqual(
      new Float32Array(original.slice(9)),
    );
    expect(
      h.state.entities.find((e) => e.id === result.entityId)!.positions,
    ).toEqual(new Float32Array(original.slice(0, 9)));
    expect(original.length).toBe(18);
  });
  it("rejects a selection belonging to a different object", async () => {
    const h = harness();
    h.state.selectedId = "different";
    await expect(async () =>
      h.ops.selection_edit(
        { entityId: "mesh", operation: "delete" },
        h.context,
      ),
    ).rejects.toThrow("Select triangles");
    expect(h.host.commit).not.toHaveBeenCalled();
  });
  it("rejects invalid triangle indices rather than silently selecting another face", async () => {
    const h = harness();
    await expect(async () =>
      h.ops.selection_set({ entityId: "mesh", triangles: [2] }, h.context),
    ).rejects.toThrow("out of bounds");
    expect(h.host.setSelection).not.toHaveBeenCalled();
  });
  it("forbids overwriting geometry through metadata commands", async () => {
    const h = harness();
    await expect(async () =>
      h.ops.object_update(
        { entityId: "mesh", patch: { positions: triangle } },
        h.context,
      ),
    ).rejects.toThrow("metadata");
    expect(h.host.commit).not.toHaveBeenCalled();
  });
  it("keeps locked and exact bodies protected from mesh edits", async () => {
    for (const patch of [{ locked: true }, { kernelId: "cad" }]) {
      const h = harness([entity(patch)]);
      await expect(async () =>
        h.ops.mesh_transform(
          {
            entityId: "mesh",
            translation: [1, 0, 0],
            rotation: [0, 0, 0],
            scale: 1,
          },
          h.context,
        ),
      ).rejects.toThrow();
      expect(h.host.commit).not.toHaveBeenCalled();
    }
  });
  it.each([
    { patch: { locked: true }, error: "Object is locked" },
    { patch: { kernelId: "cad" }, error: "Create a mesh copy" },
  ])(
    "protects $patch from boundary smoothing before starting work",
    async ({ patch, error }) => {
      const h = harness([entity(patch)]);
      vi.mocked(processMesh).mockClear();
      vi.mocked(processMesh).mockResolvedValue({
        kind: "scanEdit",
        diagnostics: {},
        scanEdit: { positions: new Float32Array(triangle), diagnostics: {} },
      });
      await expect(
        h.ops.mesh_process(
          {
            entityId: "mesh",
            operation: {
              kind: "scanEdit",
              action: "boundarySmooth",
              indices: [0],
              strength: 0.3,
              iterations: 3,
            },
          },
          h.context,
        ),
      ).rejects.toThrow(error);
      expect(processMesh).not.toHaveBeenCalled();
      expect(h.host.commit).not.toHaveBeenCalled();
    },
  );
  it.each([{ locked: true }, { kernelId: "cad" }])(
    "retains read-only boundary inspection on protected sources %s",
    async (patch) => {
      const h = harness([entity(patch)]);
      vi.mocked(processMesh).mockClear();
      vi.mocked(processMesh).mockResolvedValue({
        kind: "scanEdit",
        diagnostics: {},
        scanEdit: {
          inventory: { components: [], boundaries: [] },
          diagnostics: {},
        },
      });
      const result = await h.ops.mesh_process(
        {
          entityId: "mesh",
          operation: { kind: "scanEdit", action: "inventory" },
        },
        h.context,
      );
      expect(result).toHaveProperty("artifact");
      expect(processMesh).toHaveBeenCalledOnce();
      expect(h.host.commit).not.toHaveBeenCalled();
    },
  );
  it("creates an independent tessellation while retaining exact CAD on its source", async () => {
    const h = harness([entity({ kernelId: "native", brep: "BREP" })]);
    await h.ops.mesh_copy({ entityId: "mesh" }, h.context);
    expect(h.state.entities[0].kernelId).toBe("native");
    expect(h.state.entities[1].kernelId).toBeUndefined();
    expect(h.state.entities[1].positions).not.toBe(
      h.state.entities[0].positions,
    );
  });
  it("cancellation immediately before a mutation prevents commits", async () => {
    const h = harness();
    h.controller.abort();
    await expect(async () =>
      h.ops.object_update(
        { entityId: "mesh", patch: { name: "Changed" } },
        h.context,
      ),
    ).rejects.toThrow();
    expect(h.host.commit).not.toHaveBeenCalled();
  });
  it("releases only newly evaluated CAD handles after a stale commit", async () => {
    const h = harness([]);
    h.context.check = () => {
      throw new Error("Stale revision");
    };
    await expect(
      h.ops.cad_create({ recipe, name: "Box" }, h.context),
    ).rejects.toThrow("Stale");
    expect(h.cad.release).toHaveBeenCalledWith(["native-1"]);
    expect(h.host.commit).not.toHaveBeenCalled();
  });
  it("returns compact summaries without geometry arrays or BREP", async () => {
    const h = harness([entity({ kernelId: "native", brep: "huge" })]);
    const result = (await h.ops.project_get({}, h.context)) as {
      objects: Record<string, unknown>[];
    };
    expect(result.objects[0]).not.toHaveProperty("positions");
    expect(result.objects[0]).not.toHaveProperty("brep");
    expect(result.objects[0].exactCad).toBe(true);
  });
  it("validates missing dependencies before calling the CAD evaluator", async () => {
    const h = harness([]);
    await expect(
      createCadFeature(
        h.cad,
        [],
        { kind: "offset", source: { featureId: "foreign" }, distance: 1 },
        "Offset",
      ),
    ).rejects.toThrow();
    expect(h.cad.primitive).not.toHaveBeenCalled();
  });
  it("retains the previous native body for history after rebuilding", async () => {
    const h = harness([]);
    const initial = await createCadFeature(h.cad, [], recipe, "Box");
    const rebuilt = await rebuildCadFeature(
      h.cad,
      initial.entities,
      [],
      [],
      initial.created[0].id,
      {
        kind: "primitive",
        input: { kind: "box", center: [0, 0, 0], size: [2, 2, 2] },
      },
    );
    expect(rebuilt.entities[0].id).toBe(initial.created[0].id);
    expect(rebuilt.entities[0].kernelId).toBe("native-2");
    expect(h.cad.release).not.toHaveBeenCalled();
  });
});

it("keeps the dedicated mesh split available through MCP processing with workspace cutters", async () => {
  const cutter = entity({ id: "cutter", name: "Cutting mesh" });
  const h = harness([entity(), cutter]);
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "scanEdit",
    diagnostics: {},
    scanEdit: {
      segments: [new Float32Array(triangle), new Float32Array(triangle)],
      diagnostics: {},
    },
  });
  await h.ops.mesh_process(
    {
      entityId: "mesh",
      targetId: "cutter",
      operation: { kind: "scanEdit", action: "split" },
    },
    h.context,
  );
  expect(vi.mocked(processMesh).mock.calls.at(-1)?.[0]).toMatchObject({
    kind: "scanEdit",
    action: "split",
    target: cutter.positions,
  });
  expect(h.host.commit).toHaveBeenCalledOnce();
  expect(h.state.entities.length).toBeGreaterThan(2);
});

it("reuses prepared source topology for MCP edits on selected facets", async () => {
  const h = harness();
  vi.mocked(processMesh).mockResolvedValueOnce({
    kind: "scanEdit",
    scanEdit: { diagnostics: {} },
    diagnostics: {},
  });
  await h.ops.mesh_process(
    {
      entityId: "mesh",
      selectionOnly: true,
      operation: { kind: "scanEdit", action: "defeature", tolerance: 0.001 },
    },
    h.context,
  );
  expect(vi.mocked(processMesh).mock.lastCall?.[1]).toMatchObject({
    reuseTopology: true,
  });
  expect(vi.mocked(processMesh).mock.lastCall?.[0].positions).toBe(
    h.state.entities[0].positions,
  );
});

it("exposes automatic mesh preparation through MCP object inspection without model writes", async () => {
  const h = harness(),
    { prepareMeshInBackground } =
      await import("../src/scan-background-preparation");
  const stop = prepareMeshInBackground(h.state.entities[0].positions, {
    canStart: () => false,
  });
  try {
    expect(h.ops.object_get({ entityId: "mesh" }, h.context)).toMatchObject({
      meshPreparation: { phase: "scheduled" },
    });
    expect(h.host.commit).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

describe("sketch section GUI/MCP original-slot parity", () => {
  const sectionPositions = new Float32Array([
    0, 0, 0, 2, 0, 2, 0, 2, 0, 10, 0, 0, 12, 0, 2, 10, 2, 0,
  ]);
  const sectionOptions = {
    plane: "OXY" as const,
    offset: 1,
    onSlicingPlane: true,
    selectedOnly: true,
  };
  const runSection = (request: Parameters<typeof processMesh>[0]) => {
    if (request.kind !== "sketchSection")
      throw new Error("Expected the actual sketch section worker request");
    return Promise.resolve({
      kind: "sketchSection" as const,
      diagnostics: {},
      sketchSection: extractSketchSection(
        request.positions,
        request.options,
        request.sourceId,
        request.hidden,
        request.selection,
        request.sampled,
      ),
    });
  };
  it.each([undefined, true])(
    "matches GUI extraction using full source slots with top-level selectionOnly=%s",
    async (selectionOnly) => {
      const positions = sectionPositions.slice();
      const before = positions.slice();
      const hidden = [0];
      const h = harness([
        entity({ positions, meshSelection: { hidden, saved: [] } }),
      ]);
      h.state.selection = new Uint8Array([0, 1]);
      const selectionBefore = h.state.selection.slice();
      const expected = extractSketchSection(
        positions,
        sectionOptions,
        "mesh",
        hidden,
        h.state.selection,
        false,
      );
      const worker = vi.mocked(processMesh);
      worker.mockClear();
      worker.mockImplementation(runSection);
      try {
        await h.ops.mesh_process(
          {
            entityId: "mesh",
            ...(selectionOnly === undefined ? {} : { selectionOnly }),
            operation: { kind: "sketchSection", options: sectionOptions },
          },
          h.context,
        );
        const request = worker.mock.lastCall![0];
        expect(request.positions).toBe(positions);
        expect(request).toMatchObject({
          hidden: [0],
          selection: new Uint8Array([0, 1]),
          sourceId: "mesh",
        });
        const payload = vi.mocked(h.context.artifact).mock.lastCall![0];
        expect(typeof payload).toBe("string");
        expect(JSON.parse(payload as string).sketchSection).toEqual(expected);
        expect(expected.eligibleTriangles).toBe(1);
        expect(expected.reference.segments[0]).toBe(11);
        expect(positions).toEqual(before);
        expect(h.state.selection).toEqual(selectionBefore);
        expect(hidden).toEqual([0]);
        expect(h.state.history).toEqual([]);
        expect(h.host.commit).not.toHaveBeenCalled();
      } finally {
        worker.mockReset();
      }
    },
  );
  it.each([undefined, false])(
    "ignores the live selection for a full visible section with top-level flag %s",
    async (selectionOnly) => {
      const positions = sectionPositions.slice();
      const h = harness([
        entity({ positions, meshSelection: { hidden: [0], saved: [] } }),
      ]);
      h.state.selection = new Uint8Array([1, 0]);
      const options = { ...sectionOptions, selectedOnly: false };
      const expected = extractSketchSection(positions, options, "mesh", [0]);
      const worker = vi.mocked(processMesh);
      worker.mockClear();
      worker.mockImplementation(runSection);
      try {
        await h.ops.mesh_process(
          {
            entityId: "mesh",
            ...(selectionOnly === undefined ? {} : { selectionOnly }),
            operation: { kind: "sketchSection", options },
          },
          h.context,
        );
        expect(worker.mock.lastCall![0].positions).toBe(positions);
        const payload = vi.mocked(h.context.artifact).mock.lastCall![0];
        expect(JSON.parse(payload as string).sketchSection).toEqual(expected);
        expect(expected.eligibleTriangles).toBe(1);
        expect(h.host.commit).not.toHaveBeenCalled();
      } finally {
        worker.mockReset();
      }
    },
  );
  it.each([
    [true, false],
    [false, true],
  ])(
    "rejects contradictory nested selectedOnly=%s and top-level selectionOnly=%s before processing",
    async (selectedOnly, selectionOnly) => {
      const h = harness([entity({ positions: sectionPositions.slice() })]);
      const worker = vi.mocked(processMesh);
      worker.mockClear();
      worker.mockImplementation(runSection);
      try {
        await expect(
          h.ops.mesh_process(
            {
              entityId: "mesh",
              selectionOnly,
              operation: {
                kind: "sketchSection",
                options: { ...sectionOptions, selectedOnly },
              },
            },
            h.context,
          ),
        ).rejects.toThrow(/must match/);
        expect(worker).not.toHaveBeenCalled();
        expect(h.context.artifact).not.toHaveBeenCalled();
        expect(h.host.commit).not.toHaveBeenCalled();
      } finally {
        worker.mockReset();
      }
    },
  );
  it.each([null, new Uint8Array([1]), new Uint8Array([0, 0])])(
    "rejects a missing, stale or empty selected-only mask before processing: %s",
    async (selection) => {
      const h = harness([entity({ positions: sectionPositions.slice() })]);
      h.state.selection = selection;
      const worker = vi.mocked(processMesh);
      worker.mockClear();
      worker.mockImplementation(runSection);
      try {
        await expect(
          h.ops.mesh_process(
            {
              entityId: "mesh",
              operation: { kind: "sketchSection", options: sectionOptions },
            },
            h.context,
          ),
        ).rejects.toThrow(/Select|Selection/);
        expect(worker).not.toHaveBeenCalled();
        expect(h.context.artifact).not.toHaveBeenCalled();
        expect(h.host.commit).not.toHaveBeenCalled();
      } finally {
        worker.mockReset();
      }
    },
  );
});

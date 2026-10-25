import { afterEach, expect, it, vi } from "vitest";
import {
  analyzeMesh,
  type MeshProcessingOptions,
} from "../src/mesh-processing";
import { runScanEdit } from "../src/scan-edit";
import { HoleRefinementError, refineHolePatch } from "../src/scan-hole-refine";
import { createOperations } from "../src/automation/operations";
import type {
  WorkspaceHost,
  WorkspaceSnapshot,
  CommandContext,
} from "../src/automation/api";
import { processMesh } from "../src/processing-client";
import type { ScanEditRequest } from "../src/scan-edit";
import type { Entity } from "../src/types";

vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));

vi.mock("../src/scan-hole-refine", async (original) => ({
  ...(await original<typeof import("../src/scan-hole-refine")>()),
  refineHolePatch: vi.fn(),
}));
const actual = await vi.importActual<typeof import("../src/scan-hole-refine")>(
  "../src/scan-hole-refine",
);
afterEach(() => vi.resetAllMocks());

// Three disjoint tetrahedra, each missing its bottom triangle.
const positions = Float32Array.from(
  [0, 4, 8].flatMap((x) => {
    const p = [
      [x, 0, 0],
      [x + 1, 0, 0],
      [x, 1, 0],
      [x, 0, 1],
    ];
    return [
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3],
    ].flatMap((f) => f.flatMap((i) => p[i]));
  }),
);
const request = {
  kind: "scanEdit",
  action: "fillHoles",
  algorithm: "curvature",
  positions,
} as const;
const failure = () =>
  new HoleRefinementError(
    "Hole refinement did not converge; the hole was left unchanged.",
  );

it.each([0, 1, 2])(
  "keeps successful patches when hole %i fails after modifying its local patch",
  (failed) => {
    let attempt = 0;
    vi.mocked(refineHolePatch).mockImplementation((...args) => {
      if (attempt++ === failed) {
        args[0].push([999, 999, 999]);
        throw failure();
      }
      return actual.refineHolePatch(...args);
    });
    const topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> =
      {};
    const result = runScanEdit(request, { topologyCache });
    expect(result.diagnostics).toMatchObject({
      filledHoles: 2,
      skippedHoles: 1,
      addedTriangles: 2,
    });
    expect(result.positions!.slice(0, positions.length)).toEqual(positions);
    const topology = analyzeMesh(result.positions!);
    expect(topology.boundaryLoops).toHaveLength(1);
    expect(
      topology.boundaryLoops[0].every(
        (id) =>
          topology.vertices[id * 3] >= failed * 4 &&
          topology.vertices[id * 3] <= failed * 4 + 1,
      ),
    ).toBe(true);
    expect(topology.nonManifoldEdges).toBe(0);
    expect(topology.inconsistentEdges).toBe(0);
    // Compare the complete logical topology across compact and editable storage.
    expect({
      ...topologyCache.topology,
      edges: [...topologyCache.topology!.edges],
    }).toEqual({ ...topology, edges: [...topology.edges] });
  },
);

it("returns unchanged geometry when every hole fails", () => {
  vi.mocked(refineHolePatch).mockImplementation(() => {
    throw failure();
  });
  const result = runScanEdit(request);
  expect(result.positions).toEqual(positions);
  expect(result.diagnostics).toMatchObject({
    filledHoles: 0,
    skippedHoles: 3,
    addedTriangles: 0,
  });
});

it("preserves the error for a single selected hole", () => {
  vi.mocked(refineHolePatch).mockImplementation(() => {
    throw failure();
  });
  expect(() => runScanEdit({ ...request, indices: [0] })).toThrow(
    "did not converge",
  );
});

it("does not turn cancellation into a skipped hole", () => {
  const controller = new AbortController();
  const topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  vi.mocked(refineHolePatch).mockImplementation(() => {
    controller.abort();
    throw failure();
  });
  expect(() =>
    runScanEdit(request, { signal: controller.signal, topologyCache }),
  ).toThrow("did not converge");
  expect(topologyCache.positions).toBe(positions);
});

it("propagates AbortError even before the signal is marked aborted", () => {
  const error = new DOMException("Cancelled", "AbortError");
  vi.mocked(refineHolePatch).mockImplementation(() => {
    throw error;
  });
  expect(() => runScanEdit(request)).toThrow(error);
});

it("does not hide unexpected refinement errors", () => {
  const error = new TypeError("Invalid patch data");
  vi.mocked(refineHolePatch).mockImplementation(() => {
    throw error;
  });
  expect(() => runScanEdit(request)).toThrow(error);
});

it("commits successful batch patches and exposes skipped holes through MCP", async () => {
  vi.mocked(refineHolePatch).mockImplementation((...args) => {
    if (args[0][0][0] >= 4 && args[0][0][0] <= 5) throw failure();
    return actual.refineHolePatch(...args);
  });
  const guiResult = runScanEdit(request);
  const state: WorkspaceSnapshot = {
    name: "Batch holes",
    entities: [
      {
        id: "mesh",
        name: "Scan",
        kind: "mesh",
        positions,
        color: "#ffffff",
        visible: true,
        opacity: 1,
      },
    ],
    history: [],
    future: [],
    authoring: {},
    selectedId: "mesh",
    selection: new Uint8Array(),
    settings: {},
  };
  const host = {
    snapshot: () => state,
    commit: vi.fn((entities: Entity[], label: string) => {
      state.history.push({ entities: state.entities, label });
      state.entities = entities;
    }),
  } as unknown as WorkspaceHost;
  const context: CommandContext = {
    signal: new AbortController().signal,
    check: () => {},
    progress: () => {},
    artifact: vi.fn(),
    artifactBlob: vi.fn(),
  };
  // Replace only worker transport: geometry still runs through the shared executor.
  vi.mocked(processMesh).mockImplementationOnce(async (input) => {
    const scanEdit = runScanEdit(input as ScanEditRequest);
    return { kind: "scanEdit", scanEdit, diagnostics: scanEdit.diagnostics };
  });
  const response = (await createOperations(host).mesh_process(
    {
      entityId: "mesh",
      operation: {
        kind: "scanEdit",
        action: "fillHoles",
        algorithm: "curvature",
      },
    },
    context,
  )) as { diagnostics: Record<string, unknown> };
  expect(response.diagnostics).toMatchObject({
    filledHoles: 2,
    skippedHoles: 1,
  });
  expect(state.entities[0].positions).toEqual(guiResult.positions);
  expect(state.history).toHaveLength(1);
  expect(state.history[0].entities[0].positions).toEqual(positions);
});

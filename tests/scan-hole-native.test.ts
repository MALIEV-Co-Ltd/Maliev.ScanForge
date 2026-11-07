import { expect, it, vi } from "vitest";
import fixture from "./fixtures/hole-fill-observed-cups.json";
import steepLip from "./fixtures/hole-fill-observed-steep-lip.json";
import rectangles from "./fixtures/hole-fill-observed-rectangles.json";
import { runScanEdit } from "../src/scan-edit";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { createOperations } from "../src/automation/operations";
import { validateInput } from "../src/automation/api";
import catalog from "../src/automation/catalog.json";
import type {
  WorkspaceHost,
  WorkspaceSnapshot,
  CommandContext,
} from "../src/automation/api";
import { processMesh } from "../src/processing-client";
vi.mock("../src/processing-client", () => ({ processMesh: vi.fn() }));

it("measures both native rectangular rims with an enclosing sphere despite their rotation", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    positions: new Float32Array(rectangles.positions),
  });
  expect(result.inventory!.boundaries).toHaveLength(2);
  for (const boundary of result.inventory!.boundaries) {
    expect(boundary.diameter).toBeCloseTo(Math.sqrt(68), 5);
    expect(boundary.diameter).toBeLessThan(rectangles.threshold);
  }
});

it("retains native boundary order for the asymmetric enclosing-sphere expansion", () => {
  const sample = fixture.cases.find((row) => row.rimEdges === 39)!;
  const positions = new Float32Array(
    sample.faces.flatMap((face) => face.flatMap((id) => sample.vertices[id])),
  );
  const indexed = nativeStlTopology(positions);
  const topology = analyzeIndexedMesh(
    Float64Array.from(indexed.vertices),
    indexed.triangles,
  );
  const result = runScanEdit(
    { kind: "scanEdit", action: "inventory", positions },
    { topologyCache: { positions, tolerance: 1e-6, topology } },
  );
  expect(result.inventory!.boundaries[0].diameter).toBeCloseTo(
    4.107916094298118,
    12,
  );
});

it("exposes native batch filling separately from the selected-hole algorithm", () => {
  const positions = new Float32Array(rectangles.positions);
  const indexed = nativeStlTopology(positions);
  const topology = analyzeIndexedMesh(
    Float64Array.from(indexed.vertices),
    indexed.triangles,
  );
  const request = {
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    batch: true,
    diameter: rectangles.threshold,
  } as const;
  const result = runScanEdit(request, {
    topologyCache: { positions, tolerance: 1e-6, topology },
  });
  expect(result.diagnostics).toMatchObject({
    filledHoles: 2,
    addedTriangles: 8,
    batch: true,
    method: "tangent",
  });
  expect(result.positions!.slice(0, positions.length)).toEqual(positions);
  const oriented = (coordinates: ArrayLike<number>) => {
    const triangles: string[] = [];
    for (let i = 0; i < coordinates.length; i += 9) {
      const p = [0, 1, 2].map((k) =>
        [0, 1, 2].map((a) => coordinates[i + k * 3 + a]).join(","),
      );
      triangles.push(
        [0, 1, 2]
          .map((k) => [...p.slice(k), ...p.slice(0, k)].join(";"))
          .sort()[0],
      );
    }
    return triangles.sort();
  };
  expect(oriented(result.positions!)).toEqual(
    oriented(rectangles.batchCoordinates),
  );
});

it("discovers batch filling through MCP", () => {
  const schema = catalog.find(
    (tool) => tool.name === "mesh_process",
  )!.inputSchema;
  expect(() =>
    validateInput(schema, {
      entityId: "cup",
      expectedRevision: 0,
      requestId: "00000000-0000-4000-8000-000000000002",
      operation: {
        kind: "scanEdit",
        action: "fillHoles",
        batch: true,
        diameter: 9,
      },
    }),
  ).not.toThrow();
});

it("rejects a selected-hole algorithm on native batch requests", () => {
  const request = {
    kind: "scanEdit",
    action: "fillHoles",
    positions: new Float32Array(rectangles.positions),
    batch: true,
    algorithm: "flat",
  } as const;
  expect(() => runScanEdit(request)).toThrow(/batch.*tangent/i);
});

it("rejects batch filling outside entire-hole mode", () => {
  const request = {
    kind: "scanEdit",
    action: "fillHoles",
    positions: new Float32Array(rectangles.positions),
    batch: true,
    mode: "partial",
    start: 0,
    end: 2,
  } as const;
  expect(() => runScanEdit(request)).toThrow(/batch.*entire/i);
});

it("discovers explicit surface recovery through the public MCP schema", () => {
  const schema = catalog.find(
    (tool) => tool.name === "mesh_process",
  )!.inputSchema;
  expect(() =>
    validateInput(schema, {
      entityId: "cup",
      expectedRevision: 0,
      requestId: "00000000-0000-4000-8000-000000000001",
      operation: {
        kind: "scanEdit",
        action: "fillHoles",
        algorithm: "surfaceRecovery",
      },
    }),
  ).not.toThrow();
});

it("matches native Automatic's curved steep-lip output without disguising it as recovery", () => {
  const input = new Float32Array(steepLip.positions),
    before = input.slice();
  const indexed = nativeStlTopology(input);
  const topology = analyzeIndexedMesh(
    Float64Array.from(indexed.vertices),
    indexed.triangles,
  );
  const hole = topology.boundaryLoops.findIndex((loop) =>
    loop.every(
      (id) =>
        Math.hypot(topology.vertices[id * 3], topology.vertices[id * 3 + 1]) <
        4.1,
    ),
  );
  expect(hole).toBeGreaterThanOrEqual(0);
  const result = runScanEdit(
    {
      kind: "scanEdit",
      action: "fillHoles",
      positions: input,
      indices: [hole],
      algorithm: "automatic",
    },
    { topologyCache: { positions: input, tolerance: 1e-6, topology } },
  );
  expect(input).toEqual(before);
  expect(result.diagnostics.filledHoles).toBe(1);
  expect(result.positions).toEqual(
    new Float32Array(steepLip.outputCoordinates),
  );
});

it.each([false, true])(
  "exposes Flat through MCP without changing a closed source (already closed: %s)",
  async (closed) => {
    const sample = fixture.cases.find((row) => row.rimEdges === 39)!;
    const positions = new Float32Array(
      closed
        ? sample.flatOutput!.flat()
        : sample.faces.flatMap((face) =>
            face.flatMap((id) => sample.vertices[id]),
          ),
    );
    const state: WorkspaceSnapshot = {
      name: "Native Flat",
      entities: [
        {
          id: "cup",
          name: "Cup",
          kind: "mesh",
          positions,
          visible: true,
          color: "#ffffff",
          opacity: 1,
        },
      ],
      history: [],
      future: [],
      authoring: {},
      selectedId: "cup",
      selection: new Uint8Array(),
      settings: {},
    };
    const host = {
      snapshot: () => state,
      commit: vi.fn((next: WorkspaceSnapshot["entities"], label: string) => {
        state.history.push({ entities: state.entities, label });
        state.entities = next;
      }),
    } as unknown as WorkspaceHost;
    const context: CommandContext = {
      signal: new AbortController().signal,
      check: () => {},
      progress: vi.fn(),
      artifact: vi.fn(),
      artifactBlob: vi.fn(),
    };
    const request = {
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      indices: closed ? [] : [0],
      algorithm: "flat",
    } as const;
    const expected = runScanEdit({ ...request, indices: closed ? [] : [0] });
    // Only the worker transport is replaced: both routes execute production geometry.
    vi.mocked(processMesh).mockImplementationOnce(async (input) => {
      const scanEdit = runScanEdit(input as Parameters<typeof runScanEdit>[0]);
      return { kind: "scanEdit", scanEdit, diagnostics: scanEdit.diagnostics };
    });
    const response = await createOperations(host).mesh_process(
      {
        entityId: "cup",
        operation: {
          kind: "scanEdit",
          action: "fillHoles",
          indices: closed ? [] : [0],
          algorithm: "flat",
        },
      },
      context,
    );
    expect(response).toMatchObject({
      entityIds: ["cup"],
      diagnostics: {
        filledHoles: closed ? 0 : 1,
        addedTriangles: closed ? 0 : 37,
      },
    });
    expect(state.entities[0].positions).toEqual(expected.positions);
    if (closed) {
      expect(host.commit).not.toHaveBeenCalled();
      expect(state.entities[0].positions).toBe(positions);
      expect(state.history).toHaveLength(0);
    } else {
      expect(state.history).toHaveLength(1);
      expect(state.history[0].entities[0].positions).toBe(positions);
      expect(positions.length / 9).toBe(117);
    }
  },
);

it.each([false, true])(
  "matches the native Flat cap without inserting refinement vertices (imported indices: %s)",
  (imported) => {
    const sample = fixture.cases.find((row) => row.rimEdges === 39)!;
    const input = new Float32Array(
      sample.faces.flatMap((face) => face.flatMap((id) => sample.vertices[id])),
    );
    const before = input.slice();
    const indexed = imported ? nativeStlTopology(input) : undefined;
    const topology = indexed
      ? analyzeIndexedMesh(
          Float64Array.from(indexed.vertices),
          indexed.triangles,
        )
      : undefined;
    const result = runScanEdit(
      {
        kind: "scanEdit",
        action: "fillHoles",
        positions: input,
        indices: [0],
        algorithm: "flat",
      },
      topology
        ? { topologyCache: { positions: input, tolerance: 1e-6, topology } }
        : {},
    );
    expect(input).toEqual(before);
    expect(result.diagnostics.filledHoles).toBe(1);
    expect(result.positions!.length / 9).toBe(sample.flatOutputFacets);
    const triangleKeys = (coordinates: ArrayLike<number>) => {
      const keys: string[] = [];
      for (let i = 0; i < coordinates.length; i += 9) {
        const corners = [0, 1, 2].map((k) =>
          [0, 1, 2].map((a) => coordinates[i + k * 3 + a]).join(","),
        );
        keys.push(
          [0, 1, 2]
            .map((start) =>
              [...corners.slice(start), ...corners.slice(0, start)].join(";"),
            )
            .sort()[0],
        );
      }
      return keys.sort();
    };
    expect(triangleKeys(result.positions!)).toEqual(
      triangleKeys(sample.flatOutput!.flat()),
    );
  },
);

it("preserves source and cached topology identities when no boundary is selected", () => {
  const sample = fixture.cases[0];
  const positions = new Float32Array(
    sample.faces.flatMap((face) => face.flatMap((id) => sample.vertices[id])),
  );
  const indexed = nativeStlTopology(positions);
  const topology = analyzeIndexedMesh(
    Float64Array.from(indexed.vertices),
    indexed.triangles,
  );
  const topologyCache = { positions, tolerance: 1e-6, topology };
  const result = runScanEdit(
    {
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      indices: [],
      algorithm: "flat",
    },
    { topologyCache },
  );
  expect(result.diagnostics.changed).toBe(false);
  expect(result.positions).toBe(positions);
  expect(topologyCache.positions).toBe(positions);
  expect(topologyCache.topology).toBe(topology);
});

for (const sample of fixture.cases) {
  for (const algorithm of ["automatic", "tangent"] as const) {
    it(`matches the native ${algorithm} cap for the ${sample.rimEdges}-edge cup`, () => {
      const input = new Float32Array(
        sample.faces.flatMap((face) =>
          face.flatMap((vertex) => sample.vertices[vertex]),
        ),
      );
      const original = input.slice();
      // Match the observed binary-STL reader's vertex identities, not another
      // weld order: native strict ties depend on that retained preparation.
      const indexed = nativeStlTopology(input);
      const topology = analyzeIndexedMesh(
        Float64Array.from(indexed.vertices),
        indexed.triangles,
      );
      const result = runScanEdit(
        {
          kind: "scanEdit",
          action: "fillHoles",
          positions: input,
          indices: [0],
          algorithm,
        },
        { topologyCache: { positions: input, tolerance: 1e-6, topology } },
      );
      expect(input).toEqual(original);
      expect(result.diagnostics.filledHoles).toBe(1);
      expect(result.positions!.length / 9).toBe(sample.outputFacets);
      expect(result.positions).toEqual(new Float32Array(sample.output.flat(2)));
    });
  }
}

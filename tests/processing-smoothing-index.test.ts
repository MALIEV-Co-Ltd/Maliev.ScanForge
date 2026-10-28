import { expect, it, vi } from "vitest";
import input from "./fixtures/defeature-annular.json";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { indexedMeshMatches } from "../src/indexed-mesh";
import { analyzeMesh } from "../src/mesh-processing";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";

it("keeps untouched precise coordinates through the worker smoothing response", async () => {
  vi.resetModules();
  const untouched = [100000004, 0, 0, 100000012, 0, 0, 100000004, 8, 0];
  const positions = [...input.positions, ...untouched];
  const selection = Uint8Array.from([...input.selection, 0]);
  const topology = analyzeMesh(positions);
  const sourceIndexed = {
    vertices: Array.from(topology.vertices),
    triangles: topology.triangles.slice(),
  };
  const firstVertex = sourceIndexed.triangles[0];
  const duplicate = sourceIndexed.vertices.length / 3;
  sourceIndexed.vertices.push(
    ...sourceIndexed.vertices.slice(firstVertex * 3, firstVertex * 3 + 3),
  );
  sourceIndexed.triangles[0] = duplicate;
  expect(indexedMeshMatches(sourceIndexed, positions)).toBe(true);
  const replies: Exclude<ProcessingResponse, { progress: number }>[] = [];
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage: (reply: ProcessingResponse, transfer: Transferable[] = []) => {
      if (!("progress" in reply))
        replies.push(structuredClone(reply, { transfer }));
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "smoothSelected",
        positions,
        sourceIndexed,
        selection,
        iterations: 2,
        strength: 0.5,
      },
    });
    const terminal = replies.at(-1)!;
    if (!("result" in terminal)) throw new Error(terminal.error);
    expect(terminal.result.scanEdit?.positions?.slice(-9)).toEqual(untouched);
    expect(terminal.result.indexedMesh).toBeDefined();
    expect(terminal.result.indexedMesh!.triangles).toEqual(
      sourceIndexed.triangles,
    );
    expect(
      indexedMeshMatches(
        terminal.result.indexedMesh!,
        terminal.result.scanEdit!.positions!,
      ),
    ).toBe(true);
    expect(positions.slice(-9)).toEqual(untouched);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("decodes packed precise component input before validating indexed topology", async () => {
  vi.resetModules();
  const precise = [100000004, 0, 0, 100000012, 0, 0, 100000004, 8, 0];
  const replies: Exclude<ProcessingResponse, { progress: number }>[] = [];
  const scope = {
    onmessage: null as
      | null
      | ((event: {
          data: ProcessingRequest & {
            packedScanEditSource?: {
              positions: Float64Array;
              vertices: Float64Array;
            };
          };
        }) => Promise<void>),
    postMessage: (reply: ProcessingResponse, transfer: Transferable[] = []) => {
      if (!("progress" in reply))
        replies.push(structuredClone(reply, { transfer }));
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "componentFlip",
        positions: new Float32Array(),
        indices: [0],
        sourceIndexed: { vertices: [], triangles: new Uint32Array([0, 1, 2]) },
        packedScanEditSource: {
          positions: Float64Array.from(precise),
          vertices: Float64Array.from(precise),
        },
      },
    });
    const terminal = replies.at(-1)!;
    if (!("result" in terminal)) throw new Error(terminal.error);
    expect(terminal.packedScanEdit?.positions).toBeInstanceOf(Float64Array);
    expect(Array.from(terminal.packedScanEdit!.positions)).toEqual([
      ...precise.slice(0, 3),
      ...precise.slice(6, 9),
      ...precise.slice(3, 6),
    ]);
    expect(
      indexedMeshMatches(
        {
          ...terminal.result.indexedMesh!,
          vertices: Array.from(terminal.packedScanEdit!.vertices),
        },
        Array.from(terminal.packedScanEdit!.positions),
      ),
    ).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("returns ordinary empty geometry when a packed removal deletes the only component", async () => {
  vi.resetModules();
  const precise = [100000004, 0, 0, 100000012, 0, 0, 100000004, 8, 0];
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      | null
      | ((event: {
          data: ProcessingRequest & {
            packedScanEditSource?: {
              positions: Float64Array;
              vertices: Float64Array;
            };
          };
        }) => Promise<void>),
    postMessage: (reply: ProcessingResponse) => replies.push(reply),
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "componentRemove",
        positions: new Float32Array(),
        indices: [0],
        sourceIndexed: { vertices: [], triangles: new Uint32Array([0, 1, 2]) },
        packedScanEditSource: {
          positions: Float64Array.from(precise),
          vertices: Float64Array.from(precise),
        },
      },
    });
    const terminal = replies.at(-1)!;
    if (!("result" in terminal)) throw new Error("Expected successful removal");
    expect(terminal.result.scanEdit?.positions).toEqual([]);
    expect(terminal.packedScanEdit).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("returns a transferable segment for packed precise Extract", async () => {
  vi.resetModules();
  const precise = [100000004, 0, 0, 100000012, 0, 0, 100000004, 8, 0];
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      | null
      | ((event: {
          data: ProcessingRequest & {
            packedScanEditSource?: {
              positions: Float64Array;
              vertices: Float64Array;
            };
          };
        }) => Promise<void>),
    postMessage: (reply: ProcessingResponse, transfers: Transferable[] = []) =>
      replies.push(structuredClone(reply, { transfer: transfers })),
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "componentExtract",
        positions: new Float32Array(),
        indices: [0],
        sourceIndexed: { vertices: [], triangles: new Uint32Array([0, 1, 2]) },
        packedScanEditSource: {
          positions: Float64Array.from(precise),
          vertices: Float64Array.from(precise),
        },
      },
    });
    const terminal = replies.at(-1)!;
    if (!("result" in terminal)) throw new Error("Expected Extract result");
    const packed = (
      terminal as typeof terminal & {
        packedScanSegments?: {
          positions: Float64Array;
          vertices: Float64Array;
        }[];
      }
    ).packedScanSegments;
    expect(Array.from(packed![0].positions)).toEqual(precise);
    expect(
      indexedMeshMatches(
        {
          ...terminal.result.scanEdit!.segmentIndexedMeshes![0]!,
          vertices: Array.from(packed![0].vertices),
        },
        Array.from(packed![0].positions),
      ),
    ).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("does not build a welded persistent topology before an indexed component edit", async () => {
  vi.resetModules();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const sourceIndexed = {
    vertices: positions.slice(),
    triangles: new Uint32Array([0, 1, 2]),
  };
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage: (reply: ProcessingResponse) => replies.push(reply),
  };
  vi.stubGlobal("self", scope);
  // A persistent lookup would fail against this inert IndexedDB stub.
  vi.stubGlobal("indexedDB", {});
  try {
    await import("../src/processing-worker");
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "componentFlip",
        positions,
        sourceIndexed,
        indices: [0],
      },
    });
    const terminal = replies.at(-1)!;
    expect(terminal).toHaveProperty("result");
    expect(
      replies
        .filter((reply) => "stage" in reply)
        .map((reply) => ("stage" in reply ? reply.stage : "")),
    ).not.toContain("Welding vertices");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("publishes an independent updated index without detaching the source or canonical cache", async () => {
  vi.resetModules();
  const positions = Float32Array.from(input.positions),
    before = positions.slice();
  const indexed = nativeStlTopology(positions),
    indices = indexed.triangles.slice(),
    vertices = indexed.vertices.slice();
  const replies: Exclude<ProcessingResponse, { progress: number }>[] = [];
  const scope = {
    onmessage: null as
      | null
      | ((event: {
          data: ProcessingRequest & { geometryKey?: number };
        }) => Promise<void>),
    postMessage: (reply: ProcessingResponse, transfer: Transferable[] = []) => {
      if (!("progress" in reply))
        replies.push(structuredClone(reply, { transfer }));
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "smoothSelected",
        positions,
        sourceIndexed: indexed,
        selection: Uint8Array.from(input.selection),
        iterations: 2,
        strength: 0.5,
        geometryKey: 19,
      },
    });
    const terminal = replies.at(-1)!;
    if (!("result" in terminal)) throw new Error(terminal.error);
    const result = terminal.result;
    expect(result.scanEdit?.positions).toBeDefined();
    expect(result.indexedMesh).toBeDefined();
    expect(result.indexedMesh!.triangles).toEqual(indices);
    expect(
      indexedMeshMatches(result.indexedMesh, result.scanEdit!.positions!),
    ).toBe(true);
    expect(positions).toEqual(before);
    expect(indexed.vertices).toEqual(vertices);
    expect(indexed.triangles).toEqual(indices);
    await scope.onmessage!({
      data: {
        kind: "scanEdit",
        action: "inventory",
        positions: new Float32Array(),
        geometryKey: 19,
      },
    });
    const inventory = replies.at(-1)!;
    if (!("result" in inventory)) throw new Error(inventory.error);
    expect(inventory.result.scanEdit?.inventory?.boundaries).toHaveLength(2);
  } finally {
    vi.unstubAllGlobals();
  }
});

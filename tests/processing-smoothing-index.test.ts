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

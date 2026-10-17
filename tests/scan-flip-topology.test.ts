import { afterEach, expect, it, vi } from "vitest";
import {
  analyzeMesh,
  type MeshProcessingOptions,
} from "../src/mesh-processing";
import { flipScanNormals } from "../src/scan-tools-transforms";
import { runScanTool } from "../src/scan-tools";
import { noiseRings } from "../src/scan-noise-parallel";
import { smoothingRings } from "../src/scan-smoothing-kernel";
import capture from "./fixtures/flip-kernel-native.json";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";

const decode = (hex: string) =>
  new Float32Array(
    Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)).buffer,
  );
afterEach(() => vi.unstubAllGlobals());

it.each(capture.cases)(
  "retains native vertex identity after flipping $name",
  (entry) => {
    const positions = decode(entry.inputBits);
    const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
    const before = analyzeMesh(positions, {
      tolerance: 0.001,
      topologyCache: cache,
    });
    const originalTriangles = before.triangles.slice();
    const oldNoise = noiseRings(before),
      oldSmooth = smoothingRings(before);
    const stages: string[] = [];
    const flipped = flipScanNormals(positions, { topologyCache: cache });
    expect(new Uint8Array(flipped.positions.buffer)).toEqual(
      new Uint8Array(decode(entry.nativeBits).buffer),
    );
    const after = analyzeMesh(flipped.positions, {
      tolerance: 0.001,
      topologyCache: cache,
      onProgress: (_, stage) => stages.push(stage),
    });
    expect(stages).toEqual(["Reusing mesh topology"]);
    expect(after.vertices).toBe(before.vertices);
    for (const field of [
      "neighbors",
      "components",
      "boundaryLoops",
      "boundaryChains",
    ] as const)
      expect(after[field]).toBe(before[field]);
    expect(before.triangles).toEqual(originalTriangles);
    expect(after.triangles).not.toBe(before.triangles);
    for (const [key, uses] of after.edges)
      uses.forEach((use, i) => {
        expect(use.from).toBe(before.edges.get(key)![i].to);
        expect(use.to).toBe(before.edges.get(key)![i].from);
      });
    expect(noiseRings(after)).not.toBe(oldNoise);
    expect(smoothingRings(after)).not.toBe(oldSmooth);
    const restored = flipScanNormals(flipped.positions, {
      topologyCache: cache,
    });
    expect(new Uint8Array(restored.positions.buffer)).toEqual(
      new Uint8Array(positions.buffer),
    );
    const twice = analyzeMesh(restored.positions, {
      tolerance: 0.001,
      topologyCache: cache,
    });
    expect(twice.triangles).toEqual(before.triangles);
    expect([...twice.edges]).toEqual([...before.edges]);
  },
);

it("does not publish a changed cache on cancellation or progress callback failure", () => {
  const positions = decode(capture.cases[0].inputBits);
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const topology = analyzeMesh(positions, { topologyCache: cache });
  const controller = new AbortController();
  expect(() =>
    flipScanNormals(positions, {
      topologyCache: cache,
      signal: controller.signal,
      onProgress: (_, stage) => {
        if (stage === "Updating mesh winding") controller.abort();
      },
    }),
  ).toThrow(/cancelled/);
  expect(cache.positions).toBe(positions);
  expect(cache.topology).toBe(topology);
  expect(() =>
    flipScanNormals(positions, {
      topologyCache: cache,
      onProgress: (_, stage) => {
        if (stage === "Complete") throw new Error("Progress failed");
      },
    }),
  ).toThrow("Progress failed");
  expect(cache.positions).toBe(positions);
  expect(cache.topology).toBe(topology);
});

it("does not weld cold geometry or replace a cache belonging to another source", () => {
  const positions = decode(capture.cases[0].inputBits);
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  runScanTool(
    { kind: "scanTools", positions, operation: { kind: "flipNormals" } },
    { topologyCache: cache },
  );
  expect(cache).toEqual({});
  const topology = analyzeMesh(positions, { topologyCache: cache });
  flipScanNormals(positions.slice(), { topologyCache: cache });
  expect(cache.positions).toBe(positions);
  expect(cache.topology).toBe(topology);
});

it("preserves welded representatives even when reversing corners changes first-seen coordinates", () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 1.0005, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0,
  ]);
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const before = analyzeMesh(positions, {
    tolerance: 0.001,
    topologyCache: cache,
  });
  const result = flipScanNormals(positions, { topologyCache: cache });
  const retained = analyzeMesh(result.positions, {
    tolerance: 0.001,
    topologyCache: cache,
  });
  const rebuilt = analyzeMesh(result.positions, { tolerance: 0.001 });
  expect(retained.vertices).toBe(before.vertices);
  expect(retained.degenerateTriangles).toBe(1);
  expect(Array.from(rebuilt.vertices)).not.toEqual(
    Array.from(retained.vertices),
  );
  expect(Array.from(before.vertices)).toContain(1);
  expect(Array.from(rebuilt.vertices)).toContain(positions[6]);
});

it("production worker retains canonical flipped topology across transferred results and reports", async () => {
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      | ((event: {
          data: ProcessingRequest & { geometryKey: number };
        }) => Promise<void>)
      | null,
    postMessage: (data: ProcessingResponse, transfers?: Transferable[]) =>
      replies.push(structuredClone(data, { transfer: transfers ?? [] })),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  for (const [index, entry] of capture.cases.entries()) {
    await scope.onmessage!({
      data: {
        kind: "report",
        positions: decode(entry.inputBits),
        tolerance: 0.001,
        geometryKey: index + 1,
      },
    });
    const before = replies.at(-1)!;
    expect("result" in before).toBe(true);
    replies.length = 0;
    await scope.onmessage!({
      data: {
        kind: "scanTools",
        positions: new Float32Array(),
        operation: { kind: "flipNormals" },
        geometryKey: index + 1,
      },
    });
    const flipped = replies.at(-1)!;
    if (!("result" in flipped) || !flipped.result.positions)
      throw new Error("Expected flipped worker output");
    expect(new Uint8Array(flipped.result.positions.buffer)).toEqual(
      new Uint8Array(decode(entry.nativeBits).buffer),
    );
    replies.length = 0;
    await scope.onmessage!({
      data: {
        kind: "report",
        positions: new Float32Array(),
        tolerance: 0.001,
        geometryKey: index + 1,
      },
    });
    const stages = replies.flatMap((reply) =>
      "progress" in reply ? [reply.stage] : [],
    );
    expect(stages).toEqual(["Reusing mesh topology"]);
    const after = replies.at(-1)!;
    if (!("result" in before) || !("result" in after))
      throw new Error("Expected topology reports");
    expect(before.result.topology?.triangles).toBe(entry.inputBits.length / 72);
    expect(after.result.topology).toEqual(before.result.topology);
  }
});

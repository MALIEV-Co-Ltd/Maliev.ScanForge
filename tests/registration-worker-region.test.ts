import { afterEach, expect, it, vi } from "vitest";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
import { indexedMeshMatches } from "../src/indexed-mesh";

afterEach(() => vi.unstubAllGlobals());
it("the worker fits only the priority region and returns the entire moving scan", async () => {
  const moving = new Float32Array([
    0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 4, 1, 2, 3, -2, 0, 1, 100, 100, 100, 101,
    100, 100, 100, 101, 100,
  ]);
  const fixed = new Float32Array(
    Array.from(
      moving.slice(0, 18),
      (value, index) => value + [0.05, -0.04, 0.03][index % 3],
    ),
  );
  const replies: ProcessingResponse[] = [];
  const sourceIndexed = {
    vertices: new Float32Array([9, 8, 7, ...moving]),
    triangles: new Uint32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
  };
  const scope = {
    onmessage: null as ((event: { data: ProcessingRequest }) => void) | null,
    postMessage: (message: ProcessingResponse) => replies.push(message),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  scope.onmessage!({
    data: {
      kind: "icp",
      positions: moving,
      sourceIndexed,
      target: fixed,
      sourceTriangleMask: new Uint8Array([1, 1, 0]),
      maxDistance: 1,
      maxIterations: 40,
      sampleSize: 100,
      targetSampleSize: 100,
      tolerance: 1e-8,
      trimFraction: 1,
    },
  });
  const reply = replies.at(-1)!;
  expect("error" in reply).toBe(false);
  if (!("result" in reply)) throw new Error("Missing registration result");
  expect(reply.result.registration?.pairs).toBe(6);
  expect(reply.result.positions).toHaveLength(27);
  expect(reply.result.positions![18]).toBeCloseTo(100.05, 4);
  expect(moving[18]).toBe(100);
  expect(fixed[0]).toBeCloseTo(0.05, 5);
  expect(
    indexedMeshMatches(reply.result.indexedMesh, reply.result.positions!),
  ).toBe(true);
  expect(reply.result.indexedMesh!.triangles).toEqual(sourceIndexed.triangles);
  expect(reply.result.indexedMesh!.vertices[0]).toBeCloseTo(9.05, 5);
  expect(sourceIndexed.vertices[0]).toBe(9);
});

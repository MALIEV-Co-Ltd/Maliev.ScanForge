import { expect, it, vi } from "vitest";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
import fixture from "./fixtures/repolygonize-observed-tilted-box.json";

it.each(["native", "voxel"] as const)(
  "preserves %s reconstruction carriers through the real worker dispatcher and structured-clone boundary",
  async (method) => {
    vi.resetModules();
    const { runScanTool } = await import("../src/scan-tools");
    const vertices = Float32Array.from(fixture.vertices.flat());
    const triangles = Uint32Array.from(fixture.faces.flat());
    const positions = Float32Array.from(
      Array.from(triangles).flatMap((id) =>
        Array.from(vertices.subarray(id * 3, id * 3 + 3)),
      ),
    );
    const request = {
      kind: "scanTools" as const,
      positions,
      operation: {
        kind: "repolygonize" as const,
        method,
        resolution: fixture.resolution,
        sourceTopology: { vertices, triangles },
      },
    };
    const expected = runScanTool(request);
    const replies: ProcessingResponse[] = [];
    const scope = {
      onmessage: null as
        null | ((event: { data: ProcessingRequest }) => Promise<void>),
      postMessage(message: ProcessingResponse, transfer: Transferable[] = []) {
        expect(transfer.every((buffer) => buffer instanceof ArrayBuffer)).toBe(
          true,
        );
        expect(new Set(transfer).size).toBe(transfer.length);
        replies.push(structuredClone(message, { transfer }));
      },
    };
    vi.stubGlobal("self", scope);
    try {
      await import("../src/processing-worker");
      await scope.onmessage!({ data: structuredClone(request) });
      const reply = replies.at(-1);
      if (!reply || !("result" in reply)) throw Error(JSON.stringify(reply));
      expect(reply.result.positions).toEqual(expected.positions);
      expect(reply.result.topology).toEqual(expected.topology);
      if (method === "native") {
        expect(reply.result.positions).toEqual(
          Float32Array.from(fixture.nativeOutput),
        );
        const indexed = reply.result.indexedMesh;
        expect(indexed).toBeDefined();
        expect(indexed?.vertices).toBeInstanceOf(Float32Array);
        expect(indexed?.triangles).toBeInstanceOf(Uint32Array);
        expect(indexed?.geometryNormals).toBeInstanceOf(Float32Array);
        expect(indexed?.facetNormals).toBeInstanceOf(Float32Array);
        for (const key of [
          "vertices",
          "triangles",
          "geometryNormals",
          "facetNormals",
        ] as const)
          expect(indexed?.[key]).toEqual(expected.indexedMesh?.[key]);
        expect(reply.result.renderData?.normals).toBeInstanceOf(Float32Array);
        expect(indexed?.facetNormals).toHaveLength(indexed!.triangles.length);
      } else {
        expect(expected.indexedMesh).toBeUndefined();
        expect(reply.result.indexedMesh).toBeUndefined();
      }
      expect(positions.byteLength).toBeGreaterThan(0);
      expect(vertices.byteLength).toBeGreaterThan(0);
      expect(triangles.byteLength).toBeGreaterThan(0);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);

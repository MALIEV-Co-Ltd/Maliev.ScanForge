import { expect, it, vi } from "vitest";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
it("releases prior adjacency before reconstruction and preserves the canonical scan on failure", async () => {
  vi.resetModules();
  const scan = await import("../src/scan-tools");
  const replies: ProcessingResponse[] = [],
    scope = {
      onmessage: null as
        null | ((event: { data: ProcessingRequest }) => Promise<void>),
      postMessage: (message: ProcessingResponse) => replies.push(message),
    };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    const source = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
    await scope.onmessage!({
      data: {
        kind: "report",
        positions: source,
        tolerance: 0.001,
        geometryKey: 42,
      } as ProcessingRequest,
    });
    let retained: unknown;
    vi.spyOn(scan, "runScanTool").mockImplementationOnce((request, options) => {
      expect(request.positions).toEqual(source);
      retained = options?.topologyCache?.topology;
      throw Error("Intentional reconstruction failure");
    });
    await scope.onmessage!({
      data: {
        kind: "scanTools",
        positions: new Float32Array(0),
        operation: { kind: "repolygonize", method: "voxel", resolution: 0.5 },
        geometryKey: 42,
      } as ProcessingRequest,
    });
    expect(replies.at(-1)).toMatchObject({
      error: "Intentional reconstruction failure",
    });
    expect(retained).toBeUndefined();
    await scope.onmessage!({
      data: {
        kind: "report",
        positions: new Float32Array(0),
        tolerance: 0.001,
        geometryKey: 42,
      } as ProcessingRequest,
    });
    const last = replies.at(-1);
    if (!last || !("result" in last)) throw Error(JSON.stringify(last));
    expect(last.result.topology?.triangles).toBe(1);
    expect(source).toEqual(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]));
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

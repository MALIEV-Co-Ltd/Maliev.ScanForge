import { expect, it, vi } from "vitest";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";

it("runs projected meshing through the processing worker and keeps source XYZ intact", async () => {
  vi.resetModules();
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage: (reply: ProcessingResponse) => replies.push(reply),
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    const before = positions.slice();
    await scope.onmessage!({
      data: {
        kind: "pointCloudMesh",
        positions,
        plane: "xy",
        maxEdgeLength: 2,
      },
    });
    const last = replies.at(-1);
    if (!last || !("result" in last)) throw Error(JSON.stringify(last));
    expect(last.result.positions?.length).toBe(18);
    expect(last.result.indexedMesh?.triangles.length).toBe(6);
    expect(last.result.renderData).toBeDefined();
    expect(positions).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
  }
});

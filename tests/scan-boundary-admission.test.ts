import { expect, it } from "vitest";
import {
  analyzeMesh,
  type MeshProcessingOptions,
} from "../src/mesh-processing";
import { runScanEdit, runScanEditAsync } from "../src/scan-edit";

const quad = [0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0];
it.each([
  { field: "degenerateTriangles", extra: [10, 0, 0, 10, 0, 0, 10, 0, 0] },
  {
    field: "nonManifoldEdges",
    extra: [0, 0, 0, 2, 0, 0, 1, -1, 0, 2, 0, 0, 0, 0, 0, 1, -1, 1],
  },
  { field: "nonManifoldVertices", extra: [0, 0, 0, -1, 0, 0, 0, -1, 0] },
] as const)(
  "rejects $field before changing source or canonical topology",
  async ({ field, extra }) => {
    const positions = Float32Array.from([...quad, ...extra]),
      before = positions.slice();
    const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
    const topology = analyzeMesh(positions, { topologyCache: cache });
    expect(topology[field]).toBeGreaterThan(0);
    const request = {
      kind: "scanEdit",
      action: "boundarySmooth",
      positions,
    } as const;
    expect(() => runScanEdit(request, { topologyCache: cache })).toThrow(
      /degenerate|nonmanifold/i,
    );
    await expect(
      runScanEditAsync(request, { topologyCache: cache }),
    ).rejects.toThrow(/degenerate|nonmanifold/i);
    expect(positions).toEqual(before);
    expect(cache.positions).toBe(positions);
    expect(cache.topology).toBe(topology);
  },
);

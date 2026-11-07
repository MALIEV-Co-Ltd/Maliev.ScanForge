import { expect, it } from "vitest";
import {
  analyzeMesh,
  type MeshProcessingOptions,
} from "../src/mesh-processing";
import { runScanEditAsync } from "../src/scan-edit";

const quad = new Float32Array([
  0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0,
]);

it("keeps the canonical source cache for an unchanged small convex boundary", async () => {
  const source = quad.slice();
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const topology = analyzeMesh(source, { topologyCache: cache });
  const result = await runScanEditAsync(
    { kind: "scanEdit", action: "boundarySmooth", positions: source },
    { topologyCache: cache },
  );
  expect(result.positions).toEqual(source);
  expect(result.diagnostics.changed).toBe(false);
  expect(cache.positions).toBe(source);
  expect(cache.topology).toBe(topology);
});

it("cancels at completion before publishing a successor topology", async () => {
  const source = quad.slice(),
    before = source.slice();
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const topology = analyzeMesh(source, { topologyCache: cache });
  const controller = new AbortController();
  await expect(
    runScanEditAsync(
      { kind: "scanEdit", action: "boundarySmooth", positions: source },
      {
        topologyCache: cache,
        signal: controller.signal,
        onProgress: (_, stage) => {
          if (stage === "Boundary smoothing complete") controller.abort();
        },
      },
    ),
  ).rejects.toThrow(/cancel/i);
  expect(source).toEqual(before);
  expect(cache.positions).toBe(source);
  expect(cache.topology).toBe(topology);
});

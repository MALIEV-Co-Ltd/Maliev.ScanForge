import { expect, it, vi } from "vitest";
import { reduceScanMesh } from "../src/scan-tools-reduction";
import { analyzeMesh } from "../src/mesh-processing";
import {
  reduceSpatialMesh,
  REDUCTION_PATCH_TRIANGLES,
} from "../src/scan-reduction-partitions";

function grid(size: number) {
  const p = new Float32Array(size * size * 18);
  let i = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      p.set(
        [
          x,
          y,
          0,
          x + 1,
          y,
          0,
          x + 1,
          y + 1,
          0,
          x,
          y,
          0,
          x + 1,
          y + 1,
          0,
          x,
          y + 1,
          0,
        ],
        i,
      );
      i += 18;
    }
  return p;
}

it("reduces spatial patches without introducing seams, changing the perimeter or mutating input", () => {
  const source = grid(70),
    copy = source.slice();
  const result = reduceScanMesh(source, { mode: "percentage", percentage: 75 });
  expect(result.positions.length).toBeLessThan(source.length);
  const after = analyzeMesh(result.positions);
  expect(after.components).toHaveLength(1);
  expect(after.boundaryEdges).toBe(280);
  expect(after.boundaryLoops).toHaveLength(1);
  expect(
    after.nonManifoldEdges +
      after.nonManifoldVertices +
      after.inconsistentEdges +
      after.degenerateTriangles,
  ).toBe(0);
  expect(result.positions.every((v, i) => i % 3 !== 2 || v === 0)).toBe(true);
  expect(source).toEqual(copy);
});

it("keeps patch topology bounded above the former input limit and honors cancellation", () => {
  const source = grid(501); // 502,002 input triangles, no giant topology allocation.
  let patches = 0,
    visited = 0;
  const controller = new AbortController();
  expect(() =>
    reduceSpatialMesh(
      source,
      source.length / 18,
      { signal: controller.signal },
      (patch, _, topology) => {
        expect(patch.length / 9).toBeLessThanOrEqual(REDUCTION_PATCH_TRIANGLES);
        expect(topology.triangles.length / 3).toBeLessThanOrEqual(
          REDUCTION_PATCH_TRIANGLES,
        );
        patches++;
        visited += patch.length / 9;
        controller.abort();
        return patch;
      },
    ),
  ).toThrow(/cancelled/i);
  expect(patches).toBe(1);
  expect(visited).toBeLessThanOrEqual(REDUCTION_PATCH_TRIANGLES);
});

it("validates large input coordinates and cancellation before building topology", () => {
  const source = grid(70);
  source[123] = NaN;
  expect(() =>
    reduceScanMesh(source, { mode: "deviation", deviation: 0.05 }),
  ).toThrow(/finite/);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    reduceScanMesh(grid(70), { mode: "percentage", signal: controller.signal }),
  ).toThrow(/cancelled/i);
});

it("actually reduces more than 500,000 facets without Float32-collapsed triangles", () => {
  const source = grid(501);
  const result = reduceScanMesh(source, { mode: "percentage", percentage: 50 });
  expect(result.positions.length).toBeLessThan(source.length);
  expect(result.summary).toMatch(/502002 →/);
  const p = result.positions;
  for (let i = 0; i < p.length; i += 9) {
    const area =
      (p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) -
      (p[i + 4] - p[i + 1]) * (p[i + 6] - p[i]);
    if (!(area > 0)) throw new Error(`Invalid stored triangle at ${i / 9}`);
  }
  expect(result.positions.every((v, i) => i % 3 !== 2 || v === 0)).toBe(true);
}, 30_000);

it("preserves zero surface deviation on planar patches in deviation mode", () => {
  const source = grid(70);
  const result = reduceScanMesh(source, { mode: "deviation", deviation: 0.05 });
  expect(result.positions.length).toBeLessThan(source.length);
  expect(result.positions.every((v, i) => i % 3 !== 2 || v === 0)).toBe(true);
  const topology = analyzeMesh(result.positions);
  expect(topology.boundaryEdges).toBe(280);
  expect(topology.components).toHaveLength(1);
  expect(topology.nonManifoldEdges + topology.inconsistentEdges).toBe(0);
});

it("runs the large reduction through the real worker request and result contract", async () => {
  const messages: any[] = [];
  const scope = {
    onmessage: null as ((event: { data: any }) => void) | null,
    postMessage: (message: any) => messages.push(message),
  };
  vi.stubGlobal("self", scope);
  try {
    vi.resetModules();
    await import("../src/processing-worker");
    scope.onmessage!({
      data: {
        kind: "scanTools",
        positions: grid(501),
        operation: {
          kind: "reducePolygons",
          mode: "percentage",
          percentage: 75,
        },
      },
    });
    expect(messages.some((m) => m.error)).toBe(false);
    const result = messages.find((m) => m.result)?.result;
    expect(result.kind).toBe("scanTools");
    expect(result.positions.length / 9).toBeLessThan(502002);
    expect(messages.some((m) => m.stage === "Reducing spatial patches")).toBe(
      true,
    );
    expect(messages.some((m) => m.stage === "Polygon reduction complete")).toBe(
      true,
    );
  } finally {
    vi.unstubAllGlobals();
  }
}, 30_000);

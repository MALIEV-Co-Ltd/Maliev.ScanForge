import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import type { MeshProcessingOptions } from "../src/mesh-processing";
import { nativeNoiseVertices } from "../src/scan-native-noise";
import fixture from "./fixtures/noise-annular-default.json";
import whole2 from "./fixtures/noise-annular-whole-2.json";
import whole3 from "./fixtures/noise-annular-whole-3.json";
import selected3 from "./fixtures/noise-annular-selected-3.json";
import extended from "./fixtures/noise-annular-selected-extended.json";
import selected1 from "./fixtures/noise-annular-selected-1.json";
import selected2 from "./fixtures/noise-annular-selected-2.json";
import selected4 from "./fixtures/noise-annular-selected-4.json";
import selected5 from "./fixtures/noise-annular-selected-5.json";
import boundaryOff from "./fixtures/noise-annular-boundary-off.json";
import selectedBoundaryOff from "./fixtures/noise-annular-selected-boundary-off.json";
import {
  reduceScanNoise,
  reduceScanNoiseAsync,
} from "../src/scan-tools-reduction";

const unpack = (vertices: ArrayLike<number>, triangles: Uint32Array) =>
  Array.from(triangles).flatMap((id) => [
    vertices[id * 3],
    vertices[id * 3 + 1],
    vertices[id * 3 + 2],
  ]);

it.each([
  fixture,
  whole2,
  whole3,
  selected1,
  selected2,
  selected3,
  selected4,
  selected5,
  boundaryOff,
  ...extended.cases.map((capture) => ({
    ...capture,
    positions: extended.positions,
    selection: extended.selection,
  })),
  ...selectedBoundaryOff.cases.map((capture) => ({
    ...capture,
    positions: selectedBoundaryOff.positions,
    selection: selectedBoundaryOff.selection,
  })),
])(
  "production async noise path matches native $iterations-iteration capture, selection-only $selectionOnly",
  async (capture) => {
    const result = await reduceScanNoiseAsync(
      new Float32Array(capture.positions),
      {
        iterations: capture.iterations,
        selection:
          "selection" in capture
            ? new Uint8Array(capture.selection as number[])
            : undefined,
        selectionOnly: capture.selectionOnly,
        applyBoundaryEdges: capture.applyBoundaryEdges,
      },
    );
    expect(Array.from(result.positions)).toEqual(capture.nativeOutput);
  },
);

it("async noise keeps topology reusable and never publishes an aborted successor", async () => {
  const topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const source = new Float32Array(selected3.positions);
  const first = await reduceScanNoiseAsync(source, {
    selectionOnly: true,
    selection: new Uint8Array(selected3.selection),
    iterations: 3,
    topologyCache,
  });
  const edges = topologyCache.topology?.edges;
  const stages: string[] = [];
  await reduceScanNoiseAsync(first.positions, {
    iterations: 2,
    topologyCache,
    onProgress: (_, stage) => stages.push(stage),
  });
  expect(topologyCache.topology?.edges).toBe(edges);
  expect(stages.some((stage) => /Welding|Building topology/.test(stage))).toBe(
    false,
  );
  const before = topologyCache.positions;
  const controller = new AbortController();
  controller.abort();
  await expect(
    reduceScanNoiseAsync(before!, { topologyCache, signal: controller.signal }),
  ).rejects.toThrow("cancelled");
  expect(topologyCache.positions).toBe(before);
});

it.each([fixture, whole2, whole3, boundaryOff])(
  "matches native whole-mesh $iterations-iteration capture, boundary smoothing $applyBoundaryEdges",
  (capture) => {
    const result = reduceScanNoise(new Float32Array(capture.positions), {
      iterations: capture.iterations,
      applyBoundaryEdges: capture.applyBoundaryEdges,
    });
    expect(Array.from(result.positions)).toEqual(capture.nativeOutput);
  },
);

it.each([
  selected1,
  selected2,
  selected3,
  selected4,
  selected5,
  ...selectedBoundaryOff.cases.map((capture) => ({
    ...capture,
    positions: selectedBoundaryOff.positions,
    selection: selectedBoundaryOff.selection,
  })),
])(
  "matches native $iterations-iteration selection-only smoothing including shared seam vertices",
  (capture) => {
    const source = new Float32Array(capture.positions);
    const selection = new Uint8Array(capture.selection);
    const result = reduceScanNoise(source, {
      iterations: capture.iterations,
      selection,
      selectionOnly: true,
      applyBoundaryEdges: capture.applyBoundaryEdges,
    });
    expect(Array.from(result.positions)).toEqual(capture.nativeOutput);
    const marked = new Set<string>();
    const locked = new Set<string>();
    if (!capture.applyBoundaryEdges) {
      const topology = analyzeMesh(source, { tolerance: 1e-6 });
      for (const uses of topology.edges.values())
        if (uses.length === 1)
          for (const id of [uses[0].from, uses[0].to])
            locked.add(
              Array.from(topology.vertices.slice(id * 3, id * 3 + 3)).join(","),
            );
    }
    for (let i = 0; i < source.length; i += 3)
      if (selection[Math.floor(i / 9)])
        marked.add(Array.from(source.slice(i, i + 3)).join(","));
    let sharedSeamsMoved = 0;
    for (let i = 0; i < source.length; i += 3) {
      const before = Array.from(source.slice(i, i + 3));
      const after = Array.from(result.positions.slice(i, i + 3));
      if (!marked.has(before.join(",")) || locked.has(before.join(",")))
        expect(new Uint8Array(result.positions.slice(i, i + 3).buffer)).toEqual(
          new Uint8Array(source.slice(i, i + 3).buffer),
        );
      else if (
        !selection[Math.floor(i / 9)] &&
        before.some((v, axis) => v !== after[axis])
      )
        sharedSeamsMoved++;
    }
    expect(sharedSeamsMoved).toBeGreaterThan(0);
  },
);

it("retains indexed adjacency between consecutive noise operations", () => {
  const source = new Float32Array(fixture.positions);
  const topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const before = analyzeMesh(source, { tolerance: 1e-6, topologyCache });
  const stages: string[] = [];
  const first = reduceScanNoise(source, {
    topologyCache,
    onProgress: (_, stage) => stages.push(stage),
  });
  reduceScanNoise(first.positions, {
    topologyCache,
    onProgress: (_, stage) => stages.push(stage),
  });
  expect(topologyCache.topology?.edges).toBe(before.edges);
  expect(topologyCache.topology?.triangles).toEqual(before.triangles);
  expect(stages.some((stage) => /Welding|Building topology/.test(stage))).toBe(
    false,
  );
});

it("uses the comparison threshold for reporting without clamping the native edit", () => {
  const progress: number[] = [];
  const result = reduceScanNoise(new Float32Array(fixture.positions), {
    deviation: 0.00001,
    measureDeviation: true,
    onProgress: (fraction) => progress.push(fraction),
  });
  expect(Array.from(result.positions)).toEqual(fixture.nativeOutput);
  expect(result.summary).toContain("Original-to-surface comparison");
  expect(progress.at(-1)).toBe(1);
  expect(
    progress.every((fraction, i) => !i || fraction >= progress[i - 1]),
  ).toBe(true);
});

it("matches every captured default noise-reduction coordinate exactly", () => {
  const source = new Float32Array(fixture.positions);
  const topology = analyzeMesh(source, { tolerance: 0.001 });
  const edges = topology.edges;
  const triangles = topology.triangles.slice();
  const originalVertices = topology.vertices.slice();
  const stages: string[] = [];
  const result = nativeNoiseVertices(topology, 1, undefined, true, {
    onProgress: (_, stage) => stages.push(stage),
  });
  expect(unpack(result, topology.triangles)).toEqual(fixture.nativeOutput);
  expect(source).toEqual(new Float32Array(fixture.positions));
  expect(topology.vertices).toEqual(originalVertices);
  expect(topology.triangles).toEqual(triangles);
  expect(topology.edges).toBe(edges);
  expect(stages.some((stage) => /Welding|Building topology/.test(stage))).toBe(
    false,
  );
});

it("keeps unmarked vertices and open boundaries fixed when requested", () => {
  const topology = analyzeMesh(new Float32Array(fixture.positions), {
    tolerance: 0.001,
  });
  const selection = new Uint8Array(topology.triangles.length / 3);
  selection[0] = 1;
  const marked = new Set(Array.from(topology.triangles.slice(0, 3)));
  const result = nativeNoiseVertices(topology, 2, selection, false);
  const boundary = new Set<number>();
  for (const uses of topology.edges.values())
    if (uses.length === 1) {
      boundary.add(uses[0].from);
      boundary.add(uses[0].to);
    }
  for (let id = 0; id < result.length / 3; id++)
    if (!marked.has(id) || boundary.has(id))
      expect(Array.from(result.slice(id * 3, id * 3 + 3))).toEqual(
        Array.from(topology.vertices.slice(id * 3, id * 3 + 3)),
      );
});

it("checks cancellation and selection/iteration contracts", () => {
  const topology = analyzeMesh(new Float32Array(fixture.positions), {
    tolerance: 0.001,
  });
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeNoiseVertices(topology, 1, undefined, true, {
      signal: controller.signal,
    }),
  ).toThrow("cancelled");
  expect(() => nativeNoiseVertices(topology, 0)).toThrow("positive integer");
  expect(() => nativeNoiseVertices(topology, 1, new Uint8Array(1))).toThrow(
    "Selection does not match",
  );
  const during = new AbortController();
  expect(() =>
    nativeNoiseVertices(topology, 2, undefined, true, {
      signal: during.signal,
      onProgress: (_, stage) => {
        if (stage === "Reducing mesh noise") during.abort();
      },
    }),
  ).toThrow("cancelled");
});

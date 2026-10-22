import { expect, it, vi } from "vitest";
import {
  prepareNoiseOctree,
  type NoiseIndexedSurface,
} from "../src/scan-noise-octree";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";
import {
  prepareReductionSurface,
  ReductionSurfaceBVH,
} from "../src/scan-reduction-surface";
import {
  comparePreparedReductionSurface,
  compareReductionSurface,
} from "../src/scan-reduction-comparison";
import { ScanPreviewSession } from "../src/scan-preview";
import * as tree from "../src/scan-noise-octree";

function surface(points: Float32Array): NoiseIndexedSurface {
  return {
    coordinates: points,
    indices: Uint32Array.from({ length: points.length / 3 }, (_, id) => id),
  };
}

it("reproduces the node-budget failure and completes the same comparison without dropping triangles", () => {
  const points = new Float32Array(32 * 9);
  for (let i = 0; i < 32; i++)
    points.set([0, 0, 0, 600, 0, 0, 0, 600, 0], i * 9);
  const input = surface(points);
  expect(() => prepareNoiseOctree(input)).toThrow(
    "Noise tree exceeds its node budget",
  );
  const prepared = prepareReductionSurface(input);
  expect(prepared).toBeInstanceOf(ReductionSurfaceBVH);
  const compared = comparePreparedReductionSurface(
    [5, 5, 0.02, 5, 5, -0.02, 800, 800, 0],
    prepared,
    0.05,
    0.05,
  );
  expect(compared.matched).toBe(2);
  expect(compared.within).toBe(2);
  expect(compared.distances[0]).toBeGreaterThan(0);
  expect(compared.distances[1]).toBeLessThan(0);
}, 60000);

it("uses bounded storage directly for a large scan and preserves exact signed triangle distances", () => {
  const count = 120_000;
  const positions = new Float32Array(count * 9);
  for (let id = 0; id < count; id++) {
    const x = (id % 500) * 1.2,
      y = Math.floor(id / 500) * 1.2;
    positions.set([x, y, 0, x + 1, y, 0, x, y + 1, 0], id * 9);
  }
  const original = positions.slice();
  const prepared = prepareReductionSurface(surface(positions));
  expect(prepared).toBeInstanceOf(ReductionSurfaceBVH);
  const query = (prepared as ReductionSurfaceBVH).createQuery();
  for (const [x, y, z] of [
    [0.2, 0.2, 0.02],
    [59.2, 59.2, -0.1],
    [599, 286.9, 0.04],
    [-1, -1, 0],
  ]) {
    const point = [x, y, z];
    let best = 0.25,
      expected: number | undefined;
    for (let id = 0; id < count; id++) {
      const offset = id * 9;
      const distance = noiseTriangleDistance(
        point,
        Array.from(positions.subarray(offset, offset + 3)),
        Array.from(positions.subarray(offset + 3, offset + 6)),
        Array.from(positions.subarray(offset + 6, offset + 9)),
        best,
      );
      if (Math.abs(distance) < best) {
        best = Math.abs(distance);
        expected = distance;
      }
    }
    expect(query(point, 0.25)?.distance).toBe(expected);
  }
  expect(positions).toEqual(original);
}, 30000);

it("preserves small-surface comparisons, cancellation, strict radius and malformed input errors", () => {
  const input = surface(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  const samples = [0.2, 0.2, 0.01, 0.2, 0.2, -0.01, 3, 3, 0];
  const original = compareReductionSurface(samples, input, 0.05, 0.05);
  const bvh = new ReductionSurfaceBVH(input);
  const accelerated = comparePreparedReductionSurface(samples, bvh, 0.05, 0.05);
  expect(accelerated).toEqual(original);
  expect(bvh.createQuery()([0.2, 0.2, 0.25], 0.25)).toBeUndefined();
  const cancel = new AbortController();
  cancel.abort();
  expect(() =>
    prepareReductionSurface(input, { signal: cancel.signal }),
  ).toThrow("cancelled");
  expect(
    () => new ReductionSurfaceBVH(input, { signal: cancel.signal }),
  ).toThrow("cancelled");
  expect(
    () =>
      new ReductionSurfaceBVH({ coordinates: [NaN, 0, 0], indices: [0, 0, 0] }),
  ).toThrow("finite");
  expect(
    () =>
      new ReductionSurfaceBVH({ coordinates: [0, 0, 0], indices: [0, 0, 1] }),
  ).toThrow("outside");
});

it("caches the scalable comparison index across preview tolerance changes without rerunning the reduction", async () => {
  const session = await ScanPreviewSession.create({
    kind: "scanPreview",
    phase: "create",
    previewId: "bounded",
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    operation: { kind: "reducePolygons", mode: "percentage", percentage: 100 },
  });
  const build = vi.spyOn(tree, "prepareNoiseOctree").mockImplementation(() => {
    throw new RangeError("Noise tree exceeds its node budget");
  });
  try {
    expect(session.compare(0.05).noiseComparison.statistics?.matched).toBe(3);
    expect(session.compare(0.1).noiseComparison.statistics?.matched).toBe(3);
    expect(build).toHaveBeenCalledTimes(1);
  } finally {
    build.mockRestore();
  }
});

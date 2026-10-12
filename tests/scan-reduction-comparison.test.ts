import { expect, it } from "vitest";
import fixture from "./fixtures/reduction-comparison.json";
import { compareReductionSamples } from "../src/scan-reduction-comparison";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";
import {
  queryNoiseOctree,
  type NoiseBounds,
  type NoiseQueryNode,
} from "../src/scan-noise-octree-query";

const nodes: NoiseQueryNode[] = fixture.nodes.map((node) => ({
  bounds: node.bounds as unknown as NoiseBounds,
  center: node.center as [number, number, number],
  mode: node.mode,
  triangles: node.triangles,
  children: {},
}));
const triangles = fixture.triangles.map((points) => ({
  bounds: [
    ...[0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))),
    ...[0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))),
  ] as unknown as NoiseBounds,
}));
it.each(fixture.cases)(
  "matches original reduction callback $label tolerance $threshold palette $colorThreshold",
  (capture) => {
    const points = Float64Array.from(capture.points.flat());
    const before = points.slice();
    const progress: number[] = [];
    const actual = compareReductionSamples(
      points,
      capture.threshold,
      capture.colorThreshold,
      (point, radius) =>
        queryNoiseOctree(
          nodes[capture.tree],
          point,
          radius,
          triangles,
          (id, limit) => {
            const [a, b, c] = fixture.triangles[id];
            return noiseTriangleDistance(point, a, b, c, limit);
          },
        ),
      { onProgress: (fraction) => progress.push(fraction) },
    );
    expect(Array.from(actual.rgb)).toEqual(capture.rgb.flat());
    expect(actual.within).toBe(capture.within);
    expect(actual.percentage).toBe(
      (capture.within * 100) / capture.points.length,
    );
    expect(capture.guardsIntact).toBe(true);
    expect(points).toEqual(before);
    expect(progress.at(-1)).toBe(1);
    if (capture.label === "empty") expect(actual.matched).toBe(0);
  },
);

it("counts against the dialog tolerance independently of palette/search settings", () => {
  const radii: number[] = [];
  const query = (_: number[], radius: number) => {
    radii.push(radius);
    return { distance: 0.02 };
  };
  const tight = compareReductionSamples([0, 0, 0], 0.01, 0.05, query);
  const loose = compareReductionSamples([0, 0, 0], 0.05, 0.05, query);
  expect(tight.within).toBe(0);
  expect(loose.within).toBe(1);
  expect(tight.rgb).toEqual(loose.rgb);
  expect(radii).toEqual([Math.fround(0.05) * 5, Math.fround(0.05) * 5]);
});

it("rejects invalid samples and cancellation without publishing or mutating input", () => {
  expect(() =>
    compareReductionSamples([0], 0.05, 0.05, () => undefined),
  ).toThrow("complete");
  expect(() =>
    compareReductionSamples([0, 0, Infinity], 0.05, 0.05, () => undefined),
  ).toThrow("finite");
  expect(() =>
    compareReductionSamples([0, 0, 0], 0, 0.05, () => undefined),
  ).toThrow("thresholds");
  expect(() =>
    compareReductionSamples([0, 0, 0], 0.05, 1e-100, () => undefined),
  ).toThrow("thresholds");
  expect(() =>
    compareReductionSamples([0, 0, 0], 0.05, 0.05, () => ({ distance: NaN })),
  ).toThrow("distance");
  const points = new Float64Array([0, 0, 0]);
  const controller = new AbortController();
  expect(() =>
    compareReductionSamples(
      points,
      0.05,
      0.05,
      () => {
        controller.abort();
        return { distance: 0 };
      },
      { signal: controller.signal },
    ),
  ).toThrow("cancelled");
  expect(points).toEqual(new Float64Array([0, 0, 0]));
});

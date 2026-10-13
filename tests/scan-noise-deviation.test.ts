import { expect, it } from "vitest";
import native from "./fixtures/noise-triangle-distance.json";
import nativeTrees from "./fixtures/noise-octree-trees.json";
import surfaces from "./fixtures/noise-surface-comparison.json";
import base from "./fixtures/noise-annular-default.json";
import whole2 from "./fixtures/noise-annular-whole-2.json";
import whole3 from "./fixtures/noise-annular-whole-3.json";
import selected1 from "./fixtures/noise-annular-selected-1.json";
import selected3 from "./fixtures/noise-annular-selected-3.json";
import boundaryOff from "./fixtures/noise-annular-boundary-off.json";
import {
  createNoiseTriangleScratch,
  noiseTriangleDistance,
  compareNoiseSurface,
} from "../src/scan-noise-deviation";
import { analyzeMesh } from "../src/mesh-processing";
import { reduceScanNoise } from "../src/scan-tools-reduction";
import { nativeNoiseColor } from "../src/scan-noise-color";

it("matches native leaf surface comparisons on all six noise captures and two thresholds", () => {
  const captures = {
    default: base,
    "whole-2": whole2,
    "whole-3": whole3,
    "selected-1": selected1,
    "selected-3": selected3,
    "boundary-off": boundaryOff,
  };
  for (const surface of surfaces.surfaces) {
    const capture = captures[surface.fixture as keyof typeof captures];
    const topology = analyzeMesh(new Float32Array(capture.positions));
    const preview = new Float64Array(topology.vertices.length);
    for (let corner = 0; corner < topology.triangles.length; corner++)
      for (let axis = 0; axis < 3; axis++)
        preview[topology.triangles[corner] * 3 + axis] =
          capture.nativeOutput[corner * 3 + axis];
    for (const expected of surface.results) {
      const result = compareNoiseSurface(topology, preview, expected.threshold);
      expect(result.matched).toBe(expected.matched);
      expect(result.within).toBe(expected.within);
      expect(result.percentage).toBe(expected.percentage);
      // This older fixture executes only the native leaf on exhaustive candidates.
      // Full-tree signed results are checked separately below.
      expect(
        Array.from(result.distances, (v) =>
          Number.isNaN(v) ? null : Math.abs(v),
        ),
      ).toEqual(
        expected.distances.map((v) => (v === null ? null : Math.abs(v))),
      );
      const edit = reduceScanNoise(new Float32Array(capture.positions), {
        iterations: capture.iterations,
        applyBoundaryEdges: capture.applyBoundaryEdges,
        selectionOnly: capture.selectionOnly,
        selection:
          "selection" in capture
            ? new Uint8Array(capture.selection as number[])
            : undefined,
        measureDeviation: true,
        deviation: expected.threshold,
      });
      expect(edit.noiseComparison?.threshold).toBe(expected.threshold);
      const expectedRgb = Array.from(topology.triangles).flatMap((id) =>
        nativeNoiseColor(expected.distances[id] ?? NaN, expected.threshold),
      );
      expect(Array.from(edit.noiseComparison!.rgb)).toEqual(expectedRgb);
      expect(Array.from(edit.positions)).toEqual(capture.nativeOutput);
    }
  }
});

it("production noise comparison and RGB reproduce native initialized trees on all six previews", () => {
  const captures = [base, whole2, whole3, selected1, selected3, boundaryOff];
  const names = [
    "noise-annular-default",
    "noise-annular-whole-2",
    "noise-annular-whole-3",
    "noise-annular-selected-1",
    "noise-annular-selected-3",
    "noise-annular-boundary-off",
  ];
  captures.forEach((capture, index) => {
    const tree = nativeTrees.cases.find((c) => c.name === names[index])!;
    const expected = new Map(
      tree.samples.map((s) => [s.point.join(","), s.distance]),
    );
    const topology = analyzeMesh(new Float32Array(capture.positions));
    const preview = new Float64Array(topology.vertices.length);
    for (let corner = 0; corner < topology.triangles.length; corner++)
      for (let axis = 0; axis < 3; axis++)
        preview[topology.triangles[corner] * 3 + axis] =
          capture.nativeOutput[corner * 3 + axis];
    const result = compareNoiseSurface(topology, preview, 0.05);
    for (let id = 0; id < result.total; id++) {
      const key = Array.from(
        topology.vertices.slice(id * 3, id * 3 + 3),
        Math.fround,
      ).join(",");
      expect(expected.has(key)).toBe(true);
      expect(
        Number.isNaN(result.distances[id]) ? null : result.distances[id],
      ).toBe(expected.get(key));
    }
    const edit = reduceScanNoise(new Float32Array(capture.positions), {
      iterations: capture.iterations,
      applyBoundaryEdges: capture.applyBoundaryEdges,
      selectionOnly: capture.selectionOnly,
      selection:
        "selection" in capture
          ? new Uint8Array(capture.selection as number[])
          : undefined,
      measureDeviation: true,
      deviation: 0.05,
    });
    const rgb = Array.from(topology.triangles).flatMap((id) => {
      const key = Array.from(
        topology.vertices.slice(id * 3, id * 3 + 3),
        Math.fround,
      ).join(",");
      return nativeNoiseColor(expected.get(key) ?? NaN, 0.05);
    });
    expect(Array.from(edit.noiseComparison!.rgb)).toEqual(rgb);
    expect(Array.from(edit.positions)).toEqual(capture.nativeOutput);
  });
});

it("matches original native triangle-distance instructions across all projection regions", () => {
  const regions = new Set<number>();
  for (const sample of native.samples) {
    regions.add(sample.region);
    expect(
      noiseTriangleDistance(
        sample.p,
        sample.a,
        sample.b,
        sample.c,
        sample.radius,
      ),
    ).toBe(sample.distance);
  }
  expect(regions.size).toBe(7);
});

it("reuses leaf scratch across native projection regions without changing outputs or inputs", () => {
  const scratch = createNoiseTriangleScratch();
  const closest: number[] = [],
    region = [0];
  for (const sample of [...native.samples, ...[...native.samples].reverse()]) {
    const input = [...sample.p];
    expect(
      noiseTriangleDistance(
        input,
        sample.a,
        sample.b,
        sample.c,
        sample.radius,
        closest,
        region,
        undefined,
        scratch,
      ),
    ).toBe(sample.distance);
    expect(closest).toEqual(sample.closest);
    expect(region[0]).toBe(sample.region);
    expect(input).toEqual(sample.p);
  }
});

it("measures original points against the preview surface rather than corresponding vertices", () => {
  const source = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  const original = analyzeMesh(source);
  const preview = Float64Array.from(original.vertices);
  for (let i = 0; i < preview.length; i += 3) preview[i] += 0.1;
  const result = compareNoiseSurface(original, preview, 0.05);
  expect(result.total).toBe(3);
  expect(result.matched).toBe(3);
  expect(result.within).toBe(1);
  expect(result.percentage).toBe(100 / 3);
  expect(result.maximum).toBeCloseTo(0.1, 6);
});

it("uses strict search-radius improvement, includes all original vertices and releases cancelled work", () => {
  const original = analyzeMesh(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]));
  const preview = Float64Array.from(original.vertices, (x, i) =>
    i % 3 === 2 ? x + 0.25 : x,
  );
  const result = compareNoiseSurface(original, preview, 0.05);
  expect(result.matched).toBe(0);
  expect(Array.from(result.distances).every(Number.isNaN)).toBe(true);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    compareNoiseSurface(original, preview, 0.05, { signal: controller.signal }),
  ).toThrow("cancelled");
});

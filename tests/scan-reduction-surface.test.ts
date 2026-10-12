import { expect, it } from "vitest";
import captures from "./fixtures/noise-octree-trees.json";
import { compareReductionSurface } from "../src/scan-reduction-comparison";
import { nativeNoiseColor } from "../src/scan-noise-color";

it.each(
  captures.cases.filter(
    (capture) => capture.minextent === 0.5 && capture.maxdepth === 10,
  ),
)(
  "composed reduction comparison retains native signed matches on constructed surface $name",
  (capture) => {
    // Native constructor fixtures queried at exact radius 0.25. A successful
    // closest winner remains the winner at the caller's slightly larger
    // 5 * Float32(0.05) radius. Missing points at the old strict limit are
    // excluded: the changed radius does not prove their missing-result parity.
    const samples = capture.samples.filter((sample) => sample.winner !== null);
    const original = Float64Array.from(
      samples.flatMap((sample) => sample.point),
    );
    const coordinates = Float32Array.from(capture.points.flat(2));
    const indices = Uint32Array.from(
      { length: capture.points.length * 3 },
      (_, id) => id,
    );
    const before = original.slice();
    const sourceSurface = coordinates.slice();
    const result = compareReductionSurface(
      original,
      { coordinates, indices },
      0.1,
      0.05,
    );
    expect(result.total).toBe(samples.length);
    expect(result.matched).toBe(samples.length);
    expect(result.within).toBe(
      samples.filter((sample) => Math.abs(sample.distance!) <= Math.fround(0.1))
        .length,
    );
    samples.forEach((sample, id) => {
      expect(result.distances[id]).toBe(sample.distance);
      expect(result.rgb.subarray(id * 3, id * 3 + 3)).toEqual(
        Uint8Array.from(nativeNoiseColor(sample.distance!, 0.05)),
      );
    });
    expect(original).toEqual(before);
    expect(coordinates).toEqual(sourceSurface);
  },
);

it("allows different original vertex counts and reduced connectivity, with unmatched grey samples", () => {
  const reduced = {
    coordinates: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
  const result = compareReductionSurface(
    new Float32Array([
      0.25, 0.25, 0, 0.25, 0.25, 0.1, 20, 20, 20, 0.5, 0.25, -0.1,
    ]),
    reduced,
    0.2,
    0.05,
  );
  expect(result.total).toBe(4);
  expect(result.matched).toBe(3);
  expect(result.within).toBe(3);
  expect(result.percentage).toBe(75);
  expect(result.rgb.subarray(6, 9)).toEqual(new Uint8Array([50, 50, 50]));
  expect(Number.isNaN(result.distances[2])).toBe(true);
});

it("invalid surface inputs and cancellation retain original coordinates", () => {
  const points = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const original = points.slice();
  const reduced = { coordinates: points, indices: new Uint32Array([0, 1, 2]) };
  expect(() => compareReductionSurface(points, reduced, 0, 0.05)).toThrow(
    "thresholds",
  );
  expect(() =>
    compareReductionSurface(
      points,
      { ...reduced, indices: new Uint32Array([0, 1, 99]) },
      0.05,
      0.05,
    ),
  ).toThrow("index");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    compareReductionSurface(points, reduced, 0.05, 0.05, {
      signal: controller.signal,
    }),
  ).toThrow("cancelled");
  expect(points).toEqual(original);
});

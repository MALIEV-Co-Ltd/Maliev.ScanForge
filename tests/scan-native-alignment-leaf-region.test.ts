import { expect, it } from "vitest";
import native from "./fixtures/noise-triangle-distance.json";
import cachedNormals from "./fixtures/alignment-cached-normal.json";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";

it.each(cachedNormals.samples)(
  "matches native cached-normal leaf for $point with $normal",
  (sample) => {
    const closest: number[] = [];
    const region = [99];
    expect(
      noiseTriangleDistance(
        sample.point,
        sample.a,
        sample.b,
        sample.c,
        sample.radius,
        closest,
        region,
        sample.normal,
      ),
    ).toBe(sample.distance);
    expect(closest).toEqual(sample.closest);
    expect(region[0]).toBe(sample.region);
  },
);

it.each(native.samples)(
  "matches native closest-point edge mask for $p",
  (sample) => {
    const closest: number[] = [];
    const region = [99];
    const distance = noiseTriangleDistance(
      sample.p,
      sample.a,
      sample.b,
      sample.c,
      sample.radius,
      closest,
      region,
    );
    expect(distance).toBe(sample.distance);
    expect(closest).toEqual(sample.closest);
    expect(region[0]).toBe(sample.region);
  },
);
it("clears region output when the radius rejects a match", () => {
  const region = [7];
  expect(
    noiseTriangleDistance(
      [0, 0, 2],
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
      0.5,
      undefined,
      region,
    ),
  ).toBe(Infinity);
  expect(region).toEqual([0]);
});

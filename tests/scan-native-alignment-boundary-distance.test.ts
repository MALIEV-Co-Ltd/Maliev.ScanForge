import { expect, it } from "vitest";
import native from "./fixtures/alignment-user-boundary-distance.json";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";

it.each(native.cases)(
  "matches native boundary distance for $source vertex $vertex",
  (sample) => {
    const closest: number[] = [],
      region: number[] = [];
    const [a, b, c] = sample.points;
    const distance = noiseTriangleDistance(
      sample.point,
      a,
      b,
      c,
      10,
      closest,
      region,
      sample.normal,
    );
    expect({ distance, closest, region: region[0] }).toEqual({
      distance: sample.distance,
      closest: sample.closest,
      region: sample.region,
    });
  },
);

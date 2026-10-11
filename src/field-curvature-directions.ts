import { produceConstrainedCurvatureDirections } from "./field-curvature-constrained";
import { produceFallbackCurvatureDirections } from "./field-curvature-fallback";
import {
  produceStableCurvatureDirections,
  type CurvatureRadiusData,
  type StableCurvatureDirections,
} from "./field-curvature-radius";

/** Recovered numerical direction-worker branch sequence; cache ownership is caller-supplied. */
export function produceCurvatureDirections(
  radii: CurvatureRadiusData[],
  normals: Float32Array,
  radiusThresholds: Float32Array,
  options: {
    backwardSpan: number;
    forwardSpan: number;
    ratioMinimum: number;
    normalThresholds: readonly [number, number, number];
    skippedFaces?: Uint8Array;
    previous?: StableCurvatureDirections;
  },
) {
  const stable = produceStableCurvatureDirections(radii, options);
  const constrained = produceConstrainedCurvatureDirections(
    radii,
    stable,
    options,
  );
  return produceFallbackCurvatureDirections(
    radii,
    constrained,
    normals,
    radiusThresholds,
    options,
  );
}

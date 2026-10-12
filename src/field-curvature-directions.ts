import { produceConstrainedCurvatureDirections } from "./field-curvature-constrained";
import { produceAlternateCurvatureDirections } from "./field-curvature-alternate";
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
    mode?: 0 | 1 | 2;
    backwardSpan: number;
    forwardSpan: number;
    ratioMinimum: number;
    normalThresholds: readonly [number, number, number];
    skippedFaces?: Uint8Array;
    previous?: StableCurvatureDirections;
  },
) {
  if (options.mode === 1)
    return produceAlternateCurvatureDirections(radii, options);
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

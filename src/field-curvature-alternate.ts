import { produceConstrainedCurvatureDirections } from "./field-curvature-constrained";
import {
  curvatureRadiusAngle,
  produceStableCurvatureDirections,
  type CurvatureRadiusData,
  type StableCurvatureDirections,
} from "./field-curvature-radius";

/** Recovered alternate numerical worker; supplied caches have separate ownership. */
export function produceAlternateCurvatureDirections(
  radii: CurvatureRadiusData[],
  options: {
    backwardSpan: number;
    forwardSpan: number;
    skippedFaces?: Uint8Array;
    previous?: StableCurvatureDirections;
  },
): StableCurvatureDirections {
  const faces =
    radii[0]?.largestValues.length ?? options.previous?.flags.length ?? 0;
  // Copy/validate storage without running the primary worker's strength calculation.
  const state = produceStableCurvatureDirections(radii, {
    ...options,
    ratioMinimum: 0,
    skippedFaces: new Uint8Array(Math.ceil(faces / 8)).fill(255),
  });
  const f = Math.fround;
  const marked = (mask: Uint8Array | undefined, face: number) =>
    !!(mask && face < mask.length * 8 && mask[face >> 3] & (1 << (face & 7)));
  const increment = (array: Uint32Array, face: number) => {
    if (array[face] === 0xffffffff)
      throw new Error("Alternate curvature count overflowed.");
    array[face]++;
  };
  for (let face = 0; face < faces; face++) {
    if (marked(options.skippedFaces, face) || state.flags[face] & 12) continue;
    let best = -1;
    let bestCost = f(3.4028235e38);
    for (let radius = 0; radius < radii.length; radius++) {
      if (!marked(radii[radius].qualified, face)) continue;
      increment(state.qualifiedCounts, face);
      const first = Math.max(0, radius - options.backwardSpan);
      const last = Math.min(radii.length - 1, radius + options.forwardSpan);
      let qualified = true;
      for (let other = first; other <= last; other++)
        if (!marked(radii[other].qualified, face)) {
          qualified = false;
          break;
        }
      if (!qualified) continue;
      state.candidateMasks[radius][face >> 3] |= 1 << (face & 7);
      increment(state.stableCounts, face);
      let sum = 0;
      for (let other = first; other <= last; other++)
        if (other !== radius)
          sum = f(
            sum +
              curvatureRadiusAngle(
                radii[other].directions,
                radii[radius].directions,
                face * 3,
              ),
          );
      const cost = f(sum / f(last - first + 1));
      state.costs[radius][face] = cost;
      if (cost < bestCost) {
        bestCost = cost;
        best = radius;
      }
    }
    state.selectedRadius[face] = best;
    if (best < 0) continue;
    state.directions.set(
      radii[best].directions.subarray(face * 3, face * 3 + 3),
      face * 3,
    );
    state.middleValues[face] = radii[best].middleValues[face];
    state.largestValues[face] = radii[best].largestValues[face];
    state.flags[face] |= 3;
    state.completed[face] = 1;
  }
  // This branch shares the recovered constrained scoring/projection arithmetic,
  // but the alternate worker never assigns the primary worker's fixed strength.
  const result = produceConstrainedCurvatureDirections(radii, state, options);
  result.strengths.set(state.strengths);
  for (let face = 0; face < faces; face++) {
    if (marked(options.skippedFaces, face) || result.completed[face]) continue;
    if (!radii.length)
      throw new Error(
        "Alternate curvature averaging requires at least one radius.",
      );
    let middle = 0;
    let largest = 0;
    let total = 0;
    for (let radius = 0; radius < radii.length; radius++) {
      let weight = marked(radii[radius].qualified, face) ? 5 : 1;
      if (radius === 0) weight = f(weight * 0.5);
      if (radius === radii.length - 1) weight = f(weight * 0.5);
      middle = f(
        middle + f(Math.abs(radii[radius].middleValues[face]) * weight),
      );
      total = f(total + weight);
      largest = f(
        largest + f(Math.abs(radii[radius].largestValues[face]) * weight),
      );
    }
    result.middleValues[face] = f(middle / total);
    result.largestValues[face] = f(largest / total);
    if (
      !Number.isFinite(result.middleValues[face]) ||
      !Number.isFinite(result.largestValues[face])
    )
      throw new Error("Alternate curvature average overflowed.");
    result.completed[face] = 1;
  }
  return result;
}

import {
  curvatureRadiusAngle,
  produceStableCurvatureDirections,
  type CurvatureRadiusData,
  type StableCurvatureDirections,
} from "./field-curvature-radius";

export interface FallbackCurvatureDirections extends StableCurvatureDirections {
  /** Independent diagnostic scores; the native stable-cost arrays are preserved. */
  fallbackScores: Float32Array[];
}

/** Recovered no-stable-radius direction/strength branch, with caller-owned caches. */
export function produceFallbackCurvatureDirections(
  radii: CurvatureRadiusData[],
  previous: StableCurvatureDirections,
  normals: Float32Array,
  radiusThresholds: Float32Array,
  {
    ratioMinimum,
    normalThresholds,
    skippedFaces,
  }: {
    ratioMinimum: number;
    normalThresholds: readonly [number, number, number];
    skippedFaces?: Uint8Array;
  },
): FallbackCurvatureDirections {
  const faces = previous.flags.length;
  const f = Math.fround;
  const threshold = f(ratioMinimum);
  const [normalLow, normalMiddle, normalHigh] = normalThresholds.map(f);
  if (
    !radii.length ||
    normals.length !== faces * 3 ||
    previous.completed.length !== faces ||
    radiusThresholds.length !== radii.length ||
    normals.some((v) => !Number.isFinite(v)) ||
    radiusThresholds.some((v) => !Number.isFinite(v) || v <= 0) ||
    ![threshold, normalLow, normalMiddle, normalHigh].every(Number.isFinite) ||
    threshold < 0 ||
    threshold >= 1 ||
    normalLow < 0 ||
    normalLow >= normalMiddle ||
    normalMiddle >= normalHigh ||
    normalHigh > 1 ||
    (skippedFaces && skippedFaces.length > Math.ceil(faces / 8))
  )
    throw new Error("Fallback curvature cache/threshold inputs are invalid.");
  // Reuse dimension/state validation without executing the stable-radius branch.
  const state = produceStableCurvatureDirections(radii, {
    backwardSpan: 0,
    forwardSpan: 0,
    ratioMinimum: threshold,
    previous,
    skippedFaces: new Uint8Array(Math.ceil(faces / 8)).fill(255),
  });
  state.completed.set(previous.completed);
  const result: FallbackCurvatureDirections = {
    ...state,
    fallbackScores: radii.map(() => new Float32Array(faces).fill(NaN)),
  };
  const marked = (mask: Uint8Array | undefined, face: number) =>
    !!(mask && face < mask.length * 8 && mask[face >> 3] & (1 << (face & 7)));
  const interpolate = (
    value: number,
    low: number,
    high: number,
    start: number,
    end: number,
  ) => f(f(f(f(value - low) * f(end - start)) / f(high - low)) + start);
  const clamp = (
    value: number,
    low: number,
    high: number,
    start: number,
    end: number,
  ) =>
    value < low
      ? start
      : value <= high
        ? interpolate(value, low, high, start, end)
        : end;
  const dot = (a: Float32Array, b: Float32Array, base: number) =>
    Math.abs(
      f(
        f(f(a[base + 1] * b[base + 1]) + f(a[base] * b[base])) +
          f(a[base + 2] * b[base + 2]),
      ),
    );
  const tiny = f(1e-6);
  for (let face = 0; face < faces; face++) {
    if (previous.completed[face] || marked(skippedFaces, face)) continue;
    const base = face * 3;
    const ratios = radii.map((radius) => {
      const large = Math.abs(radius.largestValues[face]);
      return large === 0
        ? 0
        : f(f(large - Math.abs(radius.middleValues[face])) / large);
    });
    let selected = -1;
    let best = f(3.4028235e38);
    for (let radius = 0; radius < radii.length; radius++) {
      const ratio = ratios[radius];
      const large = radii[radius].largestValues[face];
      const inverseRadius = radiusThresholds[radius];
      let penalty = clamp(ratio, f(0.3), f(0.7), 1, 0);
      if (ratio < f(0.05)) penalty = f(penalty + 2);
      const fifth = f(inverseRadius / 5);
      if (large < fifth && radius !== radii.length - 1) continue;
      const half = f(inverseRadius * 0.5);
      const magnitude =
        large < half
          ? clamp(large, fifth, half, 4, 1.5)
          : clamp(large, half, inverseRadius, 1.5, 0);
      penalty = f(penalty + magnitude);
      let angle = 1;
      if (penalty < 1.5) {
        let sum = 0;
        let count = 0;
        for (let other = 0; other < radii.length; other++) {
          // The native comparison promotes the float ratio to double 0.3.
          if (other === radius || ratio < 0.3) continue;
          sum = f(
            sum +
              curvatureRadiusAngle(
                radii[other].directions,
                radii[radius].directions,
                base,
              ),
          );
          count = f(count + 1);
        }
        // A zero comparison count deliberately yields NaN and cannot win the search.
        angle = f(f(sum / count) / f(Math.PI / 2));
      }
      const normalDot = dot(normals, radii[radius].directions, base);
      let normalPenalty = 0;
      if (normalDot > normalHigh) normalPenalty = 100;
      else if (normalDot > normalMiddle)
        normalPenalty = interpolate(normalDot, normalMiddle, normalHigh, 5, 20);
      else if (normalDot > normalLow)
        normalPenalty = interpolate(normalDot, normalLow, normalMiddle, 0, 5);
      let score = f(
        clamp(f(radius), 0, f(radii.length - 1), 1.5, 0.5) *
          f(f(penalty + angle) + normalPenalty),
      );
      if (radius === radii.length - 2) score = f(score * 0.5);
      else if (radius === radii.length - 1) score = f(score * 0.25);
      result.fallbackScores[radius][face] = score;
      if (score < best) {
        best = score;
        selected = radius;
      }
    }
    result.selectedRadius[face] = selected;
    if (selected === -1) {
      let middle = 0;
      let largest = 0;
      let count = 0;
      for (let radius = 0; radius < radii.length; radius++) {
        let weight = marked(radii[radius].qualified, face) ? 5 : 1;
        if (radius === 0) weight = f(weight * 0.5);
        if (radius === radii.length - 1) weight = f(weight * 0.5);
        middle = f(
          middle + f(Math.abs(radii[radius].middleValues[face]) * weight),
        );
        largest = f(
          largest + f(Math.abs(radii[radius].largestValues[face]) * weight),
        );
        count = f(count + weight);
      }
      result.middleValues[face] = f(middle / count);
      result.largestValues[face] = f(largest / count);
      if (!(result.flags[face] & 12)) result.strengths[face] = tiny;
    } else {
      const radius = radii[selected];
      const fixed = result.flags[face] & 1;
      if (!fixed) {
        result.directions.set(radius.directions.subarray(base, base + 3), base);
        result.flags[face] |= 1;
      }
      const ratio = ratios[selected];
      const large = radius.largestValues[face];
      const inverseRadius = radiusThresholds[selected];
      result.middleValues[face] = radius.middleValues[face];
      result.largestValues[face] = large;
      if (large < inverseRadius / 1.5 && ratio > 0.5) result.flags[face] |= 2;
      const normalDot = dot(normals, radius.directions, base);
      if (fixed) result.strengths[face] = 50000;
      else if (
        ratio < f(0.1) ||
        large < f(inverseRadius / 20) ||
        normalDot > normalHigh
      )
        result.strengths[face] = tiny;
      else {
        const ratioStrength =
          ratio < f(0.3)
            ? tiny
            : ratio < threshold
              ? clamp(ratio, f(0.3), threshold, f(0.1), 1)
              : clamp(ratio, threshold, 1, 1, 60);
        const magnitudeStrength = clamp(
          large,
          f(inverseRadius / 2.5),
          inverseRadius,
          f(0.1),
          60,
        );
        const angleStrength =
          ratio < f(0.3) || large < f(inverseRadius / 5)
            ? tiny
            : clamp(best, 0, f(0.13962633907794952), 60, f(0.1));
        // Captured native powf cases match; arbitrary math-library equivalence is unproven.
        let strength = f(
          Math.pow(
            f(f(angleStrength * ratioStrength) * magnitudeStrength),
            f(0.333),
          ),
        );
        if (normalDot > normalMiddle)
          strength = f(
            strength /
              interpolate(normalDot, normalMiddle, normalHigh, 10, 1000),
          );
        else if (normalDot > normalLow)
          strength = f(
            strength / interpolate(normalDot, normalLow, normalMiddle, 1, 10),
          );
        result.strengths[face] = strength;
      }
    }
    if (
      ![
        result.middleValues[face],
        result.largestValues[face],
        result.strengths[face],
      ].every(Number.isFinite)
    )
      throw new Error("Fallback curvature output overflowed.");
    result.completed[face] = 1;
  }
  return result;
}

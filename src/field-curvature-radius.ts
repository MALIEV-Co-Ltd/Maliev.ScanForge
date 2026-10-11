import type { CurvatureFaceEigenData } from "./field-curvature-faces";

export interface CurvatureRadiusData extends CurvatureFaceEigenData {
  qualified: Uint8Array;
}
export interface StableCurvatureDirections {
  selectedRadius: Int32Array;
  directions: Float32Array;
  middleValues: Float32Array;
  largestValues: Float32Array;
  strengths: Float32Array;
  flags: Uint8Array;
  qualifiedCounts: Uint32Array;
  stableCounts: Uint32Array;
  candidateMasks: Uint8Array[];
  costs: Float32Array[];
  /** Faces completed by this branch. Other faces require later worker branches. */
  completed: Uint8Array;
}

/** Recovered initial stable-radius branch; constrained and fallback branches remain separate. */
export function produceStableCurvatureDirections(
  radii: CurvatureRadiusData[],
  {
    backwardSpan,
    forwardSpan,
    ratioMinimum,
    skippedFaces,
    previous,
  }: {
    backwardSpan: number;
    forwardSpan: number;
    ratioMinimum: number;
    skippedFaces?: Uint8Array;
    previous?: StableCurvatureDirections;
  },
): StableCurvatureDirections {
  const faces = radii[0]?.largestValues.length ?? previous?.flags.length ?? 0;
  const bytes = Math.ceil(faces / 8);
  const f = Math.fround;
  const minimum = f(ratioMinimum);
  if (
    ![backwardSpan, forwardSpan].every(
      (v) => Number.isSafeInteger(v) && v >= 0 && v <= 0x7fffffff,
    ) ||
    !Number.isFinite(minimum)
  )
    throw new Error("Invalid stable curvature thresholds.");
  for (const radius of radii) {
    if (
      radius.directions.length !== faces * 3 ||
      radius.middleValues.length !== faces ||
      radius.largestValues.length !== faces ||
      radius.qualified.length > bytes
    )
      throw new Error("Curvature radius dimensions are inconsistent.");
    for (const array of [
      radius.directions,
      radius.middleValues,
      radius.largestValues,
    ])
      if (array.some((v) => !Number.isFinite(v)))
        throw new Error("Curvature radius data must be finite.");
  }
  if (
    previous &&
    (previous.flags.length !== faces ||
      previous.directions.length !== faces * 3 ||
      previous.middleValues.length !== faces ||
      previous.largestValues.length !== faces ||
      previous.strengths.length !== faces ||
      previous.selectedRadius.length !== faces ||
      previous.qualifiedCounts.length !== faces ||
      previous.stableCounts.length !== faces ||
      previous.candidateMasks.length !== radii.length ||
      previous.costs.length !== radii.length ||
      previous.costs.some((v) => v.length !== faces) ||
      previous.candidateMasks.some((v) => v.length !== bytes))
  )
    throw new Error("Previous stable curvature dimensions are inconsistent.");
  const result: StableCurvatureDirections = {
    selectedRadius:
      previous?.selectedRadius.slice() ?? new Int32Array(faces).fill(-1),
    directions: previous?.directions.slice() ?? new Float32Array(faces * 3),
    middleValues: previous?.middleValues.slice() ?? new Float32Array(faces),
    largestValues: previous?.largestValues.slice() ?? new Float32Array(faces),
    strengths: previous?.strengths.slice() ?? new Float32Array(faces),
    flags: previous?.flags.slice() ?? new Uint8Array(faces),
    qualifiedCounts:
      previous?.qualifiedCounts.slice() ?? new Uint32Array(faces),
    stableCounts: previous?.stableCounts.slice() ?? new Uint32Array(faces),
    candidateMasks: radii.map(
      (_, i) => previous?.candidateMasks[i].slice() ?? new Uint8Array(bytes),
    ),
    costs: radii.map(
      (_, i) =>
        previous?.costs[i].slice() ??
        new Float32Array(faces).fill(f(3.4028235e38)),
    ),
    completed: new Uint8Array(faces),
  };
  for (const array of [
    result.directions,
    result.middleValues,
    result.largestValues,
    result.strengths,
    ...result.costs,
  ])
    if (array.some((v) => !Number.isFinite(v)))
      throw new Error("Previous stable curvature data must be finite.");
  const marked = (mask: Uint8Array | undefined, face: number) =>
    !!(mask && face < mask.length * 8 && mask[face >> 3] & (1 << (face & 7)));
  const length = (v: Float32Array, base: number) =>
    f(
      Math.sqrt(
        f(
          f(f(v[base] * v[base]) + f(v[base + 1] * v[base + 1])) +
            f(v[base + 2] * v[base + 2]),
        ),
      ),
    );
  const angle = (a: Float32Array, b: Float32Array, base: number) => {
    const product = length(a, base) * length(b, base);
    if (product === 0) return 0;
    const dot = f(
      f(f(a[base + 1] * b[base + 1]) + f(a[base] * b[base])) +
        f(a[base + 2] * b[base + 2]),
    );
    const cosine = Math.abs(dot / product);
    const value = cosine < 1 ? f(Math.acos(cosine)) : 0;
    if (
      !Number.isFinite(value) ||
      !Number.isFinite(product) ||
      !Number.isFinite(dot)
    )
      throw new Error("Curvature radius angle overflowed.");
    return value;
  };
  const clamped = (
    value: number,
    lower: number,
    upper: number,
    start: number,
    end: number,
  ) => {
    if (value < lower) return start;
    if (value <= upper)
      return f(
        f(f(f(value - lower) * f(end - start)) / f(upper - lower)) + start,
      );
    return end;
  };
  const increment = (array: Uint32Array, face: number) => {
    if (array[face] === 0xffffffff)
      throw new Error("Stable curvature count overflowed.");
    array[face]++;
  };
  for (let face = 0; face < faces; face++) {
    if (marked(skippedFaces, face) || result.flags[face] & 12) continue;
    let best = -1;
    let bestCost = f(3.4028235e38);
    for (let radius = 0; radius < radii.length; radius++) {
      if (!marked(radii[radius].qualified, face)) continue;
      increment(result.qualifiedCounts, face);
      const first = Math.max(0, radius - backwardSpan);
      const last = Math.min(radii.length - 1, radius + forwardSpan);
      let stable = true;
      for (let other = first; other <= last; other++)
        if (!marked(radii[other].qualified, face)) {
          stable = false;
          break;
        }
      if (!stable) continue;
      result.candidateMasks[radius][face >> 3] |= 1 << (face & 7);
      increment(result.stableCounts, face);
      let sum = 0;
      for (let other = first; other <= last; other++)
        if (other !== radius)
          sum = f(
            sum +
              angle(
                radii[other].directions,
                radii[radius].directions,
                face * 3,
              ),
          );
      const cost = f(sum / f(last - first + 1));
      result.costs[radius][face] = cost;
      if (cost < bestCost) {
        bestCost = cost;
        best = radius;
      }
    }
    result.selectedRadius[face] = best;
    if (best < 0) continue;
    result.completed[face] = 1;
    const chosen = radii[best];
    result.directions.set(
      chosen.directions.subarray(face * 3, face * 3 + 3),
      face * 3,
    );
    result.middleValues[face] = chosen.middleValues[face];
    result.largestValues[face] = chosen.largestValues[face];
    result.flags[face] |= 3;
    const maximum = Math.abs(chosen.largestValues[face]);
    const ratio =
      maximum === 0
        ? 0
        : f(f(maximum - Math.abs(chosen.middleValues[face])) / maximum);
    const angleStrength = clamped(bestCost, 0, f(0.06981317), 1000, 500);
    const ratioStrength = clamped(ratio, minimum, 1, 500, 1000);
    const strength = f(f(f(ratioStrength * 3) + angleStrength) * 0.25);
    if (!Number.isFinite(strength))
      throw new Error("Stable curvature strength overflowed.");
    result.strengths[face] = strength;
  }
  return result;
}

import {
  curvatureRadiusAngle,
  produceStableCurvatureDirections,
  type CurvatureRadiusData,
  type StableCurvatureDirections,
} from "./field-curvature-radius";

export interface ConstrainedCurvatureDirections extends StableCurvatureDirections {
  /** Diagnostic choice; the native constrained branch does not write selectedRadius. */
  chosenRadius: Int32Array;
  scores: Float32Array[];
}

/** Recovered constrained-direction branch; unsuccessful faces still need fallback. */
export function produceConstrainedCurvatureDirections(
  radii: CurvatureRadiusData[],
  previous: StableCurvatureDirections,
  {
    backwardSpan,
    forwardSpan,
    skippedFaces,
  }: {
    backwardSpan: number;
    forwardSpan: number;
    skippedFaces?: Uint8Array;
  },
): ConstrainedCurvatureDirections {
  const faces = previous.flags.length;
  if (previous.completed.length !== faces)
    throw new Error("Invalid constrained curvature completion data.");
  // Reuse owned storage validation/initialization, while skipping the separate stable branch.
  const state = produceStableCurvatureDirections(radii, {
    backwardSpan,
    forwardSpan,
    ratioMinimum: 0,
    previous,
    skippedFaces: new Uint8Array(Math.ceil(faces / 8)).fill(255),
  });
  state.completed.set(previous.completed);
  const result: ConstrainedCurvatureDirections = {
    ...state,
    chosenRadius: new Int32Array(faces).fill(-1),
    scores: radii.map(() =>
      new Float32Array(faces).fill(Math.fround(3.4028235e38)),
    ),
  };
  const f = Math.fround;
  const halfPi = 1.5707963705062866;
  const marked = (mask: Uint8Array | undefined, face: number) =>
    !!(mask && face < mask.length * 8 && mask[face >> 3] & (1 << (face & 7)));
  const project = (weight: number, value: number, mean: number) =>
    f(f(f(f(weight - 1) * f(mean - value)) / -0.5) + value);
  for (let face = 0; face < faces; face++) {
    if (marked(skippedFaces, face) || !(state.flags[face] & 12)) continue;
    state.completed[face] = 0;
    state.strengths[face] = 50000;
    let best = -1;
    let bestScore = f(3.4028235e38);
    for (let radius = 0; radius < radii.length; radius++) {
      const first = Math.max(0, radius - backwardSpan);
      const last = Math.min(radii.length - 1, radius + forwardSpan);
      let qualified = true;
      for (let other = first; other <= last; other++)
        if (!marked(radii[other].qualified, face)) {
          qualified = false;
          break;
        }
      if (!qualified) continue;
      const maximum = Math.abs(radii[radius].largestValues[face]);
      const ratio =
        maximum === 0
          ? 0
          : f(
              f(maximum - Math.abs(radii[radius].middleValues[face])) / maximum,
            );
      const angle = curvatureRadiusAngle(
        radii[radius].directions,
        state.directions,
        face * 3,
      );
      let penalty = 0;
      if (angle > 0.08726646259971647) penalty = f(angle / halfPi);
      if (angle > 0.3490658503988659)
        penalty = f(((angle - 0.3490658503988659) * 3) / halfPi + penalty);
      let score = f(penalty + f(ratio + ratio));
      if (radius === 0) score = f(score * 0.5);
      else if (radius > Math.floor(radii.length / 2))
        score = radius === radii.length - 1 ? f(score / 1.5) : f(score * 1.5);
      if (!Number.isFinite(score))
        throw new Error("Constrained curvature score overflowed.");
      result.scores[radius][face] = score;
      if (score < bestScore) {
        bestScore = score;
        best = radius;
      }
    }
    if (best < 0) continue;
    const base = face * 3;
    const direction = radii[best].directions;
    let dot = Math.abs(
      f(
        f(
          f(state.directions[base + 1] * direction[base + 1]) +
            f(state.directions[base] * direction[base]),
        ) + f(state.directions[base + 2] * direction[base + 2]),
      ),
    );
    let middle = radii[best].middleValues[face];
    let largest = radii[best].largestValues[face];
    const mean = f(f(middle + largest) * 0.5);
    if (dot < 0.5) {
      [middle, largest] = [largest, middle];
      dot = f(1 - dot);
    }
    const projectedMiddle = project(dot, middle, mean);
    const projectedLargest = project(dot, largest, mean);
    if (!Number.isFinite(projectedMiddle) || !Number.isFinite(projectedLargest))
      throw new Error("Constrained curvature projection overflowed.");
    state.middleValues[face] = projectedMiddle;
    state.largestValues[face] = projectedLargest;
    state.flags[face] |= 2;
    state.completed[face] = 1;
    result.chosenRadius[face] = best;
  }
  return result;
}

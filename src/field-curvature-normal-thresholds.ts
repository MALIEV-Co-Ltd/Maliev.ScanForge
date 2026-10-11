export interface CurvatureNormalThresholds {
  qualificationMaximum: number;
  directionPenaltyThresholds: readonly [number, number, number];
}

/** Recovered owner sine caches; arguments are radians and rounded to native floats. */
export function prepareCurvatureNormalThresholds(
  qualificationAngle: number,
  lowerPenaltyAngle: number,
  upperPenaltyAngle: number,
): CurvatureNormalThresholds {
  const f = Math.fround;
  const qualification = f(qualificationAngle);
  const low = f(lowerPenaltyAngle);
  const high = f(upperPenaltyAngle);
  const midpoint = f(f(high + low) * 0.5);
  if (![qualification, low, high, midpoint].every(Number.isFinite))
    throw new Error(
      "Curvature normal angles must remain finite in float storage.",
    );
  return {
    qualificationMaximum: f(Math.sin(qualification)),
    directionPenaltyThresholds: [
      f(Math.sin(low)),
      f(Math.sin(midpoint)),
      f(Math.sin(high)),
    ],
  };
}

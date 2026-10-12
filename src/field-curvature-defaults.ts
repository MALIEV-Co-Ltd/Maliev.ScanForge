/** Recovered numerical owner defaults; object/cache construction remains separate. */
export function createCurvatureOwnerDefaults() {
  const f = Math.fround;
  const tangent = f(Math.tan(f(0.13089969754219055)));
  return {
    minimumControl: 50,
    maximumControl: 50,
    targetCount: -1,
    previousBounds: {
      minimum: -1,
      maximum: -1,
      ratio: -1,
      referenceMinimum: -1,
      count: 5,
    },
    scheduleMode: 2,
    thresholdScale: f(1 / f(tangent + tangent)),
    qualificationAngle: 0.5235987901687622,
    lowerPenaltyAngle: 0.4363323152065277,
    upperPenaltyAngle: 1.0471975803375244,
    ratioMinimum: f(0.7),
    backwardSpan: 1,
    forwardSpan: 1,
    propagateRadii: true,
    symmetryMode: 1,
    requireCompleteSymmetry: true,
  };
}

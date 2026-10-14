/** Plane reference math after the original CAD adaptor evaluates its trimmed UV midpoint. */
export function nativeDatumCadPlaneReference(
  evaluatedPoint: readonly number[],
  derivativeU: readonly number[],
  derivativeV: readonly number[],
  referencePoint?: readonly number[],
): { point: number[]; normal: number[] } {
  for (const vector of [
    evaluatedPoint,
    derivativeU,
    derivativeV,
    ...(referencePoint ? [referencePoint] : []),
  ]) {
    if (vector.length !== 3 || !vector.every(Number.isFinite))
      throw new Error(
        "CAD plane reference requires finite evaluated point and derivative vectors.",
      );
  }
  const normal = [
    derivativeV[2] * derivativeU[1] - derivativeV[1] * derivativeU[2],
    derivativeV[0] * derivativeU[2] - derivativeV[2] * derivativeU[0],
    derivativeV[1] * derivativeU[0] - derivativeV[0] * derivativeU[1],
  ];
  const length = Math.sqrt(
    normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2],
  );
  if (length >= Number.EPSILON) {
    const reciprocal = 1 / length;
    for (let i = 0; i < 3; i++) normal[i] *= reciprocal;
  }
  if (!referencePoint) return { point: [...evaluatedPoint], normal };
  const distance =
    (referencePoint[1] - evaluatedPoint[1]) * normal[1] +
    (referencePoint[0] - evaluatedPoint[0]) * normal[0] +
    (referencePoint[2] - evaluatedPoint[2]) * normal[2];
  return {
    point: referencePoint.map((value, i) => value - normal[i] * distance),
    normal,
  };
}

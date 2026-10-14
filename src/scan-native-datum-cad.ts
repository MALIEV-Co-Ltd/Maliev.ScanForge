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

/** Axis reference from native CAD primitive parameters and trimmed V bounds. */
export function nativeDatumCadAxisReference(
  kind: "cylinder" | "cone" | "torus",
  location: readonly number[],
  rawAxis: readonly number[],
  firstV: number,
  lastV: number,
  radius = 0,
  semiAngle = 0,
): { point: number[]; direction: number[]; length: number } {
  if (
    ![location, rawAxis].every(
      (vector) => vector.length === 3 && vector.every(Number.isFinite),
    ) ||
    ![firstV, lastV, radius, semiAngle].every(Number.isFinite)
  )
    throw new Error("CAD axis reference requires finite primitive parameters.");
  const direction = [...rawAxis];
  const norm = Math.sqrt(
    direction[0] * direction[0] +
      direction[1] * direction[1] +
      direction[2] * direction[2],
  );
  if (norm >= Number.EPSILON) {
    const reciprocal = 1 / norm;
    for (let i = 0; i < 3; i++) direction[i] *= reciprocal;
  }
  if (kind === "torus") return { point: [...location], direction, length: 1 };
  const origin =
    kind === "cone"
      ? location.map(
          (value, i) => rawAxis[i] * -(radius / Math.tan(semiAngle)) + value,
        )
      : [...location];
  const point = origin.map((value, i) => direction[i] * firstV + value);
  const delta = origin.map(
    (value, i) => direction[i] * lastV + value - point[i],
  );
  return {
    point,
    direction,
    length: Math.sqrt(
      delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2],
    ),
  };
}

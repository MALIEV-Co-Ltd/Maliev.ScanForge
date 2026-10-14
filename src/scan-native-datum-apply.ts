/** Original Apply frame identity predicate. */
export function nativeDatumIsIdentity(
  input: readonly number[],
  tolerance = 0,
): boolean {
  if (
    input.length !== 12 ||
    !input.every(Number.isFinite) ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  )
    throw new Error(
      "Identity comparison requires a finite 3x4 frame and nonnegative tolerance.",
    );
  return (
    [0, 5, 10].every((i) => Math.abs(input[i] - 1) <= tolerance) &&
    [1, 2, 3, 4, 6, 7, 8, 9, 11].every((i) => Math.abs(input[i]) <= tolerance)
  );
}

/** Native plane feature conversion, before frame constraint construction. */
export function nativeDatumPlaneGeometry(
  center: readonly number[],
  normal: readonly number[],
  equationOffset: number,
  referencePoint?: readonly number[],
): { point: number[]; normal: number[] } {
  if (
    center.length !== 3 ||
    normal.length !== 3 ||
    !center.every(Number.isFinite) ||
    !normal.every(Number.isFinite) ||
    !Number.isFinite(equationOffset) ||
    (referencePoint &&
      (referencePoint.length !== 3 || !referencePoint.every(Number.isFinite)))
  )
    throw new Error(
      "Plane reference geometry requires finite XYZ vectors and equation offset.",
    );
  if (!referencePoint) return { point: [...center], normal: [...normal] };
  const distance =
    normal[0] * referencePoint[0] +
    referencePoint[1] * normal[1] +
    referencePoint[2] * normal[2] +
    equationOffset;
  return {
    point: [
      referencePoint[0] - normal[0] * distance,
      referencePoint[1] - distance * normal[1],
      referencePoint[2] - distance * normal[2],
    ],
    normal: [...normal],
  };
}

/** The original Apply path uses this rigid inverse, not a general matrix inverse. */
export function nativeDatumInverseFrame(input: readonly number[]): number[] {
  if (input.length !== 12 || !input.every(Number.isFinite))
    throw new Error("Datum inverse requires a finite 3x4 frame.");
  const m = [...input];
  const a = input[4],
    tx = input[3],
    b = input[8],
    c = input[9],
    d = input[1],
    ty = input[7],
    tz = input[11],
    e = input[6],
    f = input[2];
  m[8] = f;
  m[1] = a;
  m[4] = d;
  m[2] = b;
  m[9] = e;
  m[3] = -(ty * a + tx * m[0] + tz * b);
  m[6] = c;
  m[7] = -(ty * m[5] + d * tx + tz * c);
  m[11] = -(f * tx + ty * e + tz * m[10]);
  return m;
}

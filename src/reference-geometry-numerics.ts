/**
 * Construction arithmetic shared with datum alignment. Callers own validation,
 * primitive resolution and the policy for an undefined geometric result.
 */
export function nativeReferenceClosestLines(
  a: readonly number[],
  u: readonly number[],
  b: readonly number[],
  v: readonly number[],
  tolerance: number,
): { first: number[]; second: number[] } | undefined {
  const uv = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const determinant = vv * uu - uv * uv;
  if (!(tolerance < Math.abs(determinant))) return undefined;
  const dy = b[1] - a[1],
    dz = b[2] - a[2];
  const alongV = (b[0] - a[0]) * v[0] + dy * v[1] + dz * v[2];
  const alongU = (b[0] - a[0]) * u[0] + dy * u[1] + dz * u[2];
  const reciprocal = 1 / determinant;
  const secondDistance = (alongU * uv - alongV * uu) * reciprocal;
  const firstDistance = (alongU * vv - alongV * uv) * reciprocal;
  return {
    first: u.map((value, i) => value * firstDistance + a[i]),
    second: v.map((value, i) => secondDistance * value + b[i]),
  };
}

/** Preserve the native inclusive normalization threshold and operation order. */
export function nativeReferenceNormalize(vector: readonly number[]): number[] {
  const result = [...vector];
  const length = Math.sqrt(
    vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2],
  );
  if (Number.EPSILON <= length) {
    const reciprocal = 1 / length;
    for (let i = 0; i < 3; i++) result[i] = vector[i] * reciprocal;
  }
  return result;
}

/**
 * Center/radius input helper with the observed native local +X/+Y basis.
 * Callers validate finite bounded coordinates/radius. These are ordered inputs,
 * not a built circle: the child still projects to local Z=0 and fits its center.
 * Keep zero products and additions; copying coordinates changes signed zero.
 */
export function nativeReferenceCircleInputPoints(
  center: readonly number[],
  radius: number,
): [number[], number[], number[]] | undefined {
  if (!(2 ** -23 <= radius)) return undefined;
  const x = [1, 0, 0];
  const y = [0, 1, 0];
  return [
    x.map((value, i) => value * radius + center[i]),
    y.map((value, i) => value * radius + center[i]),
    x.map((value, i) => center[i] - value * radius),
  ];
}

/**
 * Circumcenter arithmetic used by sketch arc and three-point circle sources.
 * Callers validate coordinates and own provider admission. A degenerate input
 * still writes its centroid; that fallback is not a successful circle center.
 */
export function nativeReferenceCircumcenter(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  requireFiniteIntermediates = false,
): { center: number[]; nondegenerate: boolean } {
  const checked = (values: number[]): number[] => {
    if (requireFiniteIntermediates && !values.every(Number.isFinite))
      throw new Error("Sketch circumcenter arithmetic overflow.");
    return values;
  };
  const atA =
    (c[1] - a[1]) * (b[1] - a[1]) +
    (c[0] - a[0]) * (b[0] - a[0]) +
    (c[2] - a[2]) * (b[2] - a[2]);
  const atB =
    (c[1] - b[1]) * (a[1] - b[1]) +
    (c[0] - b[0]) * (a[0] - b[0]) +
    (c[2] - b[2]) * (a[2] - b[2]);
  const atC =
    (a[1] - c[1]) * (b[1] - c[1]) +
    (a[0] - c[0]) * (b[0] - c[0]) +
    (a[2] - c[2]) * (b[2] - c[2]);
  const ca = atC * atA;
  const cb = atC * atB;
  const ab = atB * atA;
  const cSum = ca + cb;
  const determinant = cSum + ab;
  checked([atA, atB, atC, ca, cb, ab, cSum, determinant]);
  if (!(Number.EPSILON <= Math.abs(determinant))) {
    return {
      center: checked([
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ]),
      nondegenerate: false,
    };
  }
  const halfReciprocal = 0.5 / determinant;
  const weightC = cSum * halfReciprocal;
  const weightB = (ab + cb) * halfReciprocal;
  const weightA = (ab + ca) * halfReciprocal;
  checked([halfReciprocal, weightA, weightB, weightC]);
  return {
    center: checked([
      a[0] * weightA + b[0] * weightB + c[0] * weightC,
      weightA * a[1] + weightB * b[1] + weightC * c[1],
      weightA * a[2] + weightB * b[2] + weightC * c[2],
    ]),
    nondegenerate: true,
  };
}

/** Native plane-equation intersection; its chosen anchor is not minimum-norm. */
export function nativeReferencePlaneIntersection(
  n1: readonly number[],
  d1: number,
  n2: readonly number[],
  d2: number,
  tolerance: number,
): { point: number[]; direction: number[] } | undefined {
  const cross = [
    n2[2] * n1[1] - n2[1] * n1[2],
    n2[0] * n1[2] - n1[0] * n2[2],
    n1[0] * n2[1] - n2[0] * n1[1],
  ];
  const squared =
    cross[1] * cross[1] + cross[0] * cross[0] + cross[2] * cross[2];
  if (!(tolerance <= squared)) return undefined;
  const direction = nativeReferenceNormalize(cross);
  let dominant = 0;
  const y = Math.abs(direction[1]),
    z = Math.abs(direction[2]);
  if (Math.abs(direction[0]) < Math.max(y, z)) dominant = y < z ? 2 : 1;
  const j = (dominant + 1) % 3,
    k = (dominant + 2) % 3;
  const determinant = n2[k] * n1[j] - n2[j] * n1[k];
  if (!(2 ** -23 <= Math.abs(determinant))) return undefined;
  const reciprocal = 1 / determinant;
  const point = [0, 0, 0];
  const anchor = (n2[dominant] * d2 + n1[dominant] * d1) * -0.5;
  point[dominant] = anchor;
  const shifted2 = n2[dominant] * anchor + d2;
  const shifted1 = n1[dominant] * anchor + d1;
  point[j] = (-shifted1 * n2[k] - -shifted2 * n1[k]) * reciprocal;
  point[k] = (-shifted2 * n1[j] - -shifted1 * n2[j]) * reciprocal;
  return { point, direction };
}

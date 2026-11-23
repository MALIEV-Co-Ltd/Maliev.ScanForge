import type { ReferenceVector } from "./reference-construction-values";

export type NativeSketchLineConversion = {
  origin: ReferenceVector;
  direction: ReferenceVector;
  interval: readonly [number, number];
};

export function requireSketchLineCoordinateScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(
      "Line conversion requires an explicit finite positive coordinate scale.",
    );
  return value;
}

function point(value: unknown): ReferenceVector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n))
  )
    throw new Error("Line conversion requires finite XYZ evaluated points.");
  return [value[0], value[1], value[2]];
}

function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("Line conversion arithmetic overflow.");
  return value;
}

/**
 * Evaluate the prepared provider line with separate component multiplication
 * and addition. Do not renormalize its direction, clamp to an interval, or
 * return the origin directly at parameter zero: those change native rounding
 * or signed-zero behavior. This is point evaluation, not body admission.
 */
export function evaluateNativeSketchLinePoint(
  origin: unknown,
  preparedDirection: unknown,
  parameter: unknown,
): ReferenceVector {
  const o = point(origin),
    d = point(preparedDirection);
  if (d.every((n) => n === 0))
    throw new Error("Line evaluation requires a nonzero prepared direction.");
  if (
    typeof parameter !== "number" ||
    !Number.isFinite(parameter) ||
    parameter === -31415800000000
  )
    throw new Error(
      "Line evaluation requires an explicit finite, set parameter.",
    );
  return [
    finite(d[0] * parameter + o[0]),
    finite(d[1] * parameter + o[1]),
    finite(d[2] * parameter + o[2]),
  ];
}

function length([x, y, z]: ReferenceVector): number {
  // Preserve the recovered XYZ addition order; hypot has different rounding.
  return Math.sqrt(finite(x * x + y * y + z * z));
}

function normalize(value: ReferenceVector): ReferenceVector {
  const magnitude = length(value);
  if (magnitude < Number.EPSILON) return value;
  const reciprocal = 1 / magnitude;
  return [value[0] * reciprocal, value[1] * reciprocal, value[2] * reciprocal];
}

/**
 * Prepare analytic provider-curve parameters from EVALUATED primary-edge
 * endpoints. This is neither curve allocation nor wire/body admission. The
 * caller must supply its coordinate scale; no captured session value is a
 * universal default. Scaled interval underflow is left for body admission.
 */
export function prepareNativeSketchLineConversion(
  evaluatedFirst: unknown,
  evaluatedLast: unknown,
  coordinateScale: unknown,
): NativeSketchLineConversion | undefined {
  const scale = requireSketchLineCoordinateScale(coordinateScale);
  const first = point(evaluatedFirst),
    last = point(evaluatedLast);
  const delta: ReferenceVector = [
    last[0] - first[0],
    last[1] - first[1],
    last[2] - first[2],
  ];
  const sourceLength = length(delta);
  if (sourceLength < 1e-8) return undefined;
  // The conversion and provider-line preparation each normalize once. Do not
  // collapse them or replace reciprocal multiplication with division.
  const direction = normalize(normalize(delta));
  return {
    origin: [
      finite(first[0] * scale),
      finite(first[1] * scale),
      finite(first[2] * scale),
    ],
    direction,
    interval: [0, finite(sourceLength * scale)],
  };
}

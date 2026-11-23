import type { ReferenceVector } from "./reference-construction-values";

export type NativeSketchLinePointProjection = {
  point: ReferenceVector;
  parameter: number;
};

export type NativeSketchLineParameterOrder = {
  orientedSpan: number;
  ordered: boolean;
};

/** Selected normal-return preprocessing path; not complete wire admission. */
export type NativeSketchLineInputInterval = {
  firstMinusLast: number;
  separated: boolean;
  forward: boolean;
  usable: boolean;
  nativeRangeStatus: 0 | 3;
};

/**
 * Earlier input check for a nonperiodic analytic line with known parameters,
 * starting status zero. The parameter-zero threshold is a separate runtime
 * setting, not the linear resolution, vertex or connection tolerance. Unset
 * recovery and diagnostic exceptions remain outside this selected path.
 */
export function checkNativeSketchLineInputInterval(
  firstParameter: unknown,
  lastParameter: unknown,
  parameterZeroThreshold: unknown,
): NativeSketchLineInputInterval {
  if (
    typeof firstParameter !== "number" ||
    !Number.isFinite(firstParameter) ||
    typeof lastParameter !== "number" ||
    !Number.isFinite(lastParameter) ||
    firstParameter === -31415800000000 ||
    lastParameter === -31415800000000
  )
    throw new Error("Line input interval requires known finite parameters.");
  if (
    typeof parameterZeroThreshold !== "number" ||
    !Number.isFinite(parameterZeroThreshold) ||
    parameterZeroThreshold < 0
  )
    throw new Error(
      "Line input interval requires an explicit finite nonnegative parameter threshold.",
    );
  const firstMinusLast = finite(firstParameter - lastParameter);
  const separated = Math.abs(firstMinusLast) > parameterZeroThreshold;
  const forward = firstMinusLast < 0;
  const usable = separated && forward;
  return {
    firstMinusLast,
    separated,
    forward,
    usable,
    nativeRangeStatus: usable ? 0 : 3,
  };
}

/**
 * The ordinary nonperiodic-line check after endpoint projection. Orientation
 * is already decoded by the caller; the forward native line uses +1 and the
 * reverse line -1. This isolated check adds no minimum span. Reentrancy guards,
 * unset-parameter recovery, protected-call errors and complete body admission
 * belong to the surrounding operation.
 */
export function checkNativeSketchLineParameterOrder(
  firstParameter: unknown,
  lastParameter: unknown,
  forward: unknown,
): NativeSketchLineParameterOrder {
  if (
    typeof firstParameter !== "number" ||
    !Number.isFinite(firstParameter) ||
    typeof lastParameter !== "number" ||
    !Number.isFinite(lastParameter)
  )
    throw new Error("Line order requires finite endpoint parameters.");
  if (typeof forward !== "boolean")
    throw new Error("Line order requires an explicit boolean orientation.");
  const orientedSpan = finite(
    (lastParameter - firstParameter) * (forward ? 1 : -1),
  );
  return { orientedSpan, ordered: orientedSpan > 0 };
}

function xyz(value: unknown): ReferenceVector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n))
  )
    throw new Error("Line projection requires finite XYZ vectors.");
  return [value[0], value[1], value[2]];
}

function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("Line projection arithmetic overflow.");
  return value;
}

/**
 * Project onto an already prepared analytic line in provider coordinates.
 * The direction must come from the line preparation path; do not normalize it
 * again here. Effective tolerance and residual-zero threshold are explicit:
 * the native default tolerance is a separate per-thread setting, not the
 * previously captured linear resolution. Nonpositive tolerance or excessive
 * residual returns no projection. This does not test a trimmed interval or
 * establish edge/body validity, first-edge availability or editor acceptance.
 */
export function projectNativeSketchLinePoint(
  point: unknown,
  origin: unknown,
  preparedDirection: unknown,
  effectiveTolerance: unknown,
  deltaZeroThreshold: unknown,
): NativeSketchLinePointProjection | undefined {
  const p = xyz(point),
    o = xyz(origin),
    d = xyz(preparedDirection);
  if (d.every((n) => n === 0))
    throw new Error(
      "Line projection requires a nonzero prepared XYZ direction.",
    );
  if (
    typeof effectiveTolerance !== "number" ||
    !Number.isFinite(effectiveTolerance)
  )
    throw new Error("Line projection requires an explicit finite tolerance.");
  if (
    typeof deltaZeroThreshold !== "number" ||
    !Number.isFinite(deltaZeroThreshold) ||
    deltaZeroThreshold < 0
  )
    throw new Error(
      "Line projection requires an explicit finite nonnegative zero threshold.",
    );
  if (effectiveTolerance <= 0) return undefined;

  // Preserve the recovered Y-X-Z dot-product and squared-residual order.
  const parameter = finite(
    (p[1] - o[1]) * d[1] + (p[0] - o[0]) * d[0] + (p[2] - o[2]) * d[2],
  );
  const projected: ReferenceVector = [
    finite(d[0] * parameter + o[0]),
    finite(d[1] * parameter + o[1]),
    finite(d[2] * parameter + o[2]),
  ];
  const residual = (axis: number) => {
    const value = finite(p[axis] - projected[axis]);
    return Math.abs(value) < deltaZeroThreshold ? 0 : value;
  };
  const dx = residual(0),
    dy = residual(1),
    dz = residual(2);
  const distanceSquared = finite(dy * dy + dx * dx + dz * dz);
  const toleranceSquared = finite(effectiveTolerance * effectiveTolerance);
  return distanceSquared <= toleranceSquared
    ? { point: projected, parameter }
    : undefined;
}

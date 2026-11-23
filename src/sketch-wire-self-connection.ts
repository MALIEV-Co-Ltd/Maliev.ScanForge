import type { ReferenceVector } from "./reference-construction-values";

export type NativeSketchWireSelfConnection = {
  candidate: boolean;
  squaredThreshold: number;
  endpointDistanceSquared: number;
  endpoints: { start: ReferenceVector; end: ReferenceVector };
  witness?: ReferenceVector;
  startWitnessDistanceSquared?: number;
  endWitnessDistanceSquared?: number;
};

function point(value: unknown): ReferenceVector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Array.from(value).every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  )
    throw new Error("Wire self-connection requires finite XYZ points.");
  return [value[0], value[1], value[2]];
}

function distanceSquared(a: ReferenceVector, b: ReferenceVector) {
  const dx = a[0] - b[0],
    dy = a[1] - b[1],
    dz = a[2] - b[2];
  // Preserve native Y-X-Z accumulation and underflow, without a delta clamp.
  const value = dy * dy + dx * dx + dz * dz;
  if (!Number.isFinite(value))
    throw new Error("Wire self-connection arithmetic overflow.");
  return value;
}

/**
 * Recovered scalar candidate test in provider units. The caller supplies the
 * squared comparison threshold and lazy curve witness; no sampling policy is
 * guessed here. A candidate is not a closed wire or complete body admission.
 */
export function checkNativeSketchWireSelfConnection(
  start: unknown,
  end: unknown,
  squaredThreshold: unknown,
  sample: unknown,
): NativeSketchWireSelfConnection {
  const a = point(start),
    b = point(end);
  if (
    typeof squaredThreshold !== "number" ||
    !Number.isFinite(squaredThreshold) ||
    squaredThreshold < 0
  )
    throw new Error(
      "Wire self-connection requires a finite nonnegative squared threshold.",
    );
  if (typeof sample !== "function")
    throw new Error(
      "Wire self-connection requires an explicit witness sampler.",
    );
  const endpointDistanceSquared = distanceSquared(a, b);
  const result: NativeSketchWireSelfConnection = {
    candidate: false,
    squaredThreshold,
    endpointDistanceSquared,
    endpoints: { start: a, end: b },
  };
  if (!(endpointDistanceSquared < squaredThreshold)) return result;
  result.witness = point(sample());
  result.startWitnessDistanceSquared = distanceSquared(a, result.witness);
  if (!(result.startWitnessDistanceSquared > squaredThreshold)) return result;
  result.endWitnessDistanceSquared = distanceSquared(b, result.witness);
  result.candidate = result.endWitnessDistanceSquared > squaredThreshold;
  return result;
}

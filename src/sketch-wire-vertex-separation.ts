import type { ReferenceVector } from "./reference-construction-values";

export type NativeSketchWireVertexSeparation = {
  tolerances: readonly [number, number];
  distanceSquared: number;
  toleranceSquared: number;
  overlap: boolean;
};

function vertex(value: unknown, defaultTolerance: number) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Wire separation requires vertex records.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "point" && key !== "tolerance"))
    throw new Error("Invalid wire separation vertex record.");
  if (
    !Array.isArray(record.point) ||
    record.point.length !== 3 ||
    !Array.from(record.point).every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  )
    throw new Error("Wire separation requires finite XYZ points.");
  const tolerance =
    record.tolerance === undefined ? defaultTolerance : record.tolerance;
  if (
    typeof tolerance !== "number" ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  )
    throw new Error("Wire vertex tolerance must be finite and nonnegative.");
  const point: ReferenceVector = [
    record.point[0],
    record.point[1],
    record.point[2],
  ];
  return { point, tolerance };
}

function finite(value: number) {
  if (!Number.isFinite(value))
    throw new Error("Wire vertex separation arithmetic overflow.");
  return value;
}

/**
 * One recovered wire check, using provider coordinates and tolerances in the
 * same units. An omitted vertex tolerance selects half the explicit runtime
 * resolution. This is NOT complete body admission: overlap false cannot
 * authorize a body, first edge, child midpoint or editor publication.
 */
export function checkNativeSketchWireVertexSeparation(
  first: unknown,
  second: unknown,
  defaultResolution: unknown,
): NativeSketchWireVertexSeparation {
  return compare(first, second, defaultResolution, 0);
}

/**
 * The earlier edge check for DISTINCT vertex objects. It zeros each coordinate
 * difference strictly below an explicit threshold before comparing separation.
 * Shared-vertex topology has a different native branch, outside this helper.
 * A non-overlap result still does not establish complete edge/body validity.
 */
export function checkNativeSketchDistinctEdgeVertexSeparation(
  first: unknown,
  second: unknown,
  defaultResolution: unknown,
  deltaZeroThreshold: unknown,
): NativeSketchWireVertexSeparation {
  if (
    typeof deltaZeroThreshold !== "number" ||
    !Number.isFinite(deltaZeroThreshold) ||
    deltaZeroThreshold < 0
  )
    throw new Error(
      "Edge separation requires an explicit finite nonnegative zero threshold.",
    );
  return compare(first, second, defaultResolution, deltaZeroThreshold);
}

function compare(
  first: unknown,
  second: unknown,
  defaultResolution: unknown,
  deltaZeroThreshold: number,
): NativeSketchWireVertexSeparation {
  if (
    typeof defaultResolution !== "number" ||
    !Number.isFinite(defaultResolution) ||
    defaultResolution <= 0
  )
    throw new Error(
      "Wire separation requires an explicit finite positive resolution.",
    );
  const a = vertex(first, defaultResolution * 0.5);
  const b = vertex(second, defaultResolution * 0.5);
  const delta = (axis: number) => {
    const value = a.point[axis] - b.point[axis];
    return Math.abs(value) < deltaZeroThreshold ? 0 : value;
  };
  const dx = delta(0);
  const dy = delta(1);
  const dz = delta(2);
  // Keep the recovered squared-distance comparison, including underflow.
  // Comparing hypot to a tolerance would change the boundary behavior.
  const distanceSquared = finite(dy * dy + dx * dx + dz * dz);
  const sum = b.tolerance + a.tolerance;
  const toleranceSquared = finite(sum * sum);
  return {
    tolerances: [a.tolerance, b.tolerance],
    distanceSquared,
    toleranceSquared,
    overlap: distanceSquared <= toleranceSquared,
  };
}

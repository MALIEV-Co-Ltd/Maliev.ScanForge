import type { ReferenceVector } from "./reference-construction-values";

export type NativeSketchLineVertexBounds = {
  minimum: ReferenceVector;
  maximum: ReferenceVector;
};

export type NativeSketchLineBoundsEnvelope =
  | { halfExtent: number; inside: true }
  | {
      halfExtent: number;
      inside: false;
      failure: {
        axis: "x" | "y" | "z";
        side: "minimum" | "maximum";
        coordinate: number;
        relativeDifference: number;
      };
    };

/**
 * Check one canonical edge box against the recovered signed half-envelope.
 * Bounds are visited in native X min/max, Y min/max, Z min/max order. Exact
 * boundary equality is allowed; outside values use the native division order
 * for the inclusive relative-tolerance comparison. Runtime settings remain
 * explicit. This does not traverse a body or handle cache/metadata failures.
 */
export function checkNativeSketchLineBoundsEnvelope(
  bounds: unknown,
  coordinateEnvelope: unknown,
  relativeTolerance: unknown,
): NativeSketchLineBoundsEnvelope {
  if (
    typeof coordinateEnvelope !== "number" ||
    !Number.isFinite(coordinateEnvelope) ||
    coordinateEnvelope <= 0
  )
    throw new Error(
      "Line envelope requires an explicit finite positive coordinate envelope.",
    );
  if (
    typeof relativeTolerance !== "number" ||
    !Number.isFinite(relativeTolerance) ||
    relativeTolerance < 0
  )
    throw new Error(
      "Line envelope requires an explicit finite nonnegative relative tolerance.",
    );
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds))
    throw new Error("Line envelope requires a minimum/maximum bounds record.");
  const record = bounds as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "minimum" && key !== "maximum"))
    throw new Error("Line envelope bounds contain an unsupported field.");
  const minimum = vertexPoint(record.minimum),
    maximum = vertexPoint(record.maximum);
  if (minimum.some((n, axis) => n > maximum[axis]))
    throw new Error("Line envelope bounds must be ordered.");

  const halfExtent = coordinateEnvelope * 0.5;
  const axes = ["x", "y", "z"] as const;
  for (const index of [0, 1, 2] as const) {
    for (const side of ["minimum", "maximum"] as const) {
      const coordinate = side === "minimum" ? minimum[index] : maximum[index];
      const boundary = side === "minimum" ? -halfExtent : halfExtent;
      const outside =
        side === "minimum" ? coordinate < boundary : coordinate > boundary;
      if (!outside) continue;
      const relativeDifference = Math.abs(1 - boundary / coordinate);
      if (relativeDifference > relativeTolerance)
        return {
          halfExtent,
          inside: false,
          failure: { axis: axes[index], side, coordinate, relativeDifference },
        };
    }
  }
  return { halfExtent, inside: true };
}

function vertexPoint(value: unknown): ReferenceVector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n))
  )
    throw new Error("Line bounds require finite XYZ vertex points.");
  return [value[0], value[1], value[2]];
}

/**
 * The uncached bounds calculation for a fresh analytic line with default edge
 * tolerance and two attached vertex points. These are the actual vertices,
 * not independently projected or sampled curve endpoints. Native min/max ties
 * retain the first coordinate, including its signed zero. Its X-maximum unset
 * sentinel causes the merge to replace all six bounds with the second point.
 * Cache publication, other topology/tolerances and coordinate-envelope/body
 * acceptance belong to the surrounding operation.
 */
export function prepareNativeSketchLineVertexBounds(
  firstPoint: unknown,
  lastPoint: unknown,
): NativeSketchLineVertexBounds {
  const first = vertexPoint(firstPoint),
    last = vertexPoint(lastPoint);
  if (first[0] === -31415800000000) {
    return {
      minimum: [last[0], last[1], last[2]],
      maximum: [last[0], last[1], last[2]],
    };
  }
  return {
    minimum: [
      last[0] < first[0] ? last[0] : first[0],
      last[1] < first[1] ? last[1] : first[1],
      last[2] < first[2] ? last[2] : first[2],
    ],
    maximum: [
      last[0] > first[0] ? last[0] : first[0],
      last[1] > first[1] ? last[1] : first[1],
      last[2] > first[2] ? last[2] : first[2],
    ],
  };
}

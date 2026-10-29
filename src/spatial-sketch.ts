import {
  evaluateBoundaryCurve,
  type BoundaryCurveFit,
} from "./scan-boundary-fit";
import type { SpatialBoundaryCurve } from "./scan-boundary-spatial";
import type { Vec3 } from "./types";

export function validateSpatialCurves(
  value: unknown,
): asserts value is SpatialBoundaryCurve[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1024)
    throw new Error("Spatial sketch requires 1–1024 curves.");
  for (const curve of value) {
    if (
      !curve ||
      typeof curve !== "object" ||
      Array.isArray(curve) ||
      Object.keys(curve).some(
        (key) =>
          ![
            "degree",
            "poles",
            "knots",
            "periodic",
            "maxError",
            "meanError",
            "toleranceMet",
          ].includes(key),
      ) ||
      curve.degree !== 3 ||
      !Array.isArray(curve.poles) ||
      curve.poles.length < 12 ||
      curve.poles.length > 96 ||
      curve.poles.length % 3 !== 0 ||
      curve.poles.some(
        (x: unknown) =>
          typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > 1e9,
      ) ||
      !Array.isArray(curve.knots) ||
      curve.knots.length !== curve.poles.length / 3 + 4 ||
      curve.knots.some(
        (x: unknown, i: number) =>
          typeof x !== "number" ||
          !Number.isFinite(x) ||
          (i > 0 && x < curve.knots[i - 1]),
      ) ||
      curve.knots[3] !== 0 ||
      curve.knots[curve.poles.length / 3] !== 1 ||
      typeof curve.periodic !== "boolean" ||
      !Number.isFinite(curve.maxError) ||
      curve.maxError < 0 ||
      !Number.isFinite(curve.meanError) ||
      curve.meanError < 0 ||
      typeof curve.toleranceMet !== "boolean"
    )
      throw new Error("Invalid spatial sketch curve.");
  }
}

/** Validate and visit bounded line segments without changing authoritative curves. */
export function visitSpatialSegments(
  curves: SpatialBoundaryCurve[],
  emit?: (a: Vec3, b: Vec3) => void,
): void {
  validateSpatialCurves(curves);
  const segmentCount = (curve: SpatialBoundaryCurve) =>
    Math.max(32, Math.min(1024, (curve.poles.length / 3 - 3) * 16));
  const total = curves.reduce((sum, curve) => sum + segmentCount(curve), 0);
  const work = curves.reduce(
    (sum, curve) =>
      sum +
      (segmentCount(curve) + 1) * (curve.poles.length / 3) * curve.knots.length,
    0,
  );
  if (total > 1000000 || work > 2000000)
    throw new Error("Spatial sketch display exceeds the work limit.");
  for (const curve of curves) {
    const fit: BoundaryCurveFit = {
      ...curve,
      poles: Float64Array.from(curve.poles),
      parameters: new Float64Array(),
      refinements: 0,
    };
    const segments = segmentCount(curve);
    let previous = evaluateBoundaryCurve(fit, 0);
    if (!previous.every(Number.isFinite))
      throw new Error("Spatial sketch display is nonfinite.");
    for (let i = 1; i <= segments; i++) {
      const next = evaluateBoundaryCurve(fit, i / segments);
      if (!next.every(Number.isFinite))
        throw new Error("Spatial sketch display is nonfinite.");
      emit?.(previous, next);
      previous = next;
    }
  }
}

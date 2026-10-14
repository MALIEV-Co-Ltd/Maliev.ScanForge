import type { FitResult } from "./types";

export interface NativeDatumConeGeometry {
  origin: number[];
  direction: number[];
  opening: number;
  start: number;
  length: number;
}

/** Geometry-equivalent native apex/outward-axis representation of an authored frustum. */
export function nativeDatumConeGeometry(
  fit: FitResult,
): NativeDatumConeGeometry {
  if (
    fit.kind !== "cone" ||
    fit.center.length !== 3 ||
    fit.axis.length !== 3 ||
    !fit.center.every(Number.isFinite) ||
    !fit.axis.every(Number.isFinite)
  )
    throw new Error("Cone reference requires finite center and axis vectors.");
  const radius = fit.radius,
    top = fit.topRadius ?? 0,
    height = fit.height;
  if (
    radius === undefined ||
    height === undefined ||
    !Number.isFinite(radius) ||
    !Number.isFinite(top) ||
    !Number.isFinite(height) ||
    !(radius > top && top >= 0 && height > 0)
  )
    throw new Error(
      "Cone reference requires positive height and a base radius greater than its nonnegative top radius.",
    );
  const length = Math.sqrt(
    fit.axis[0] * fit.axis[0] +
      fit.axis[1] * fit.axis[1] +
      fit.axis[2] * fit.axis[2],
  );
  if (!(length > 0 && Number.isFinite(length)))
    throw new Error("Cone reference has an invalid axis.");
  const reciprocal = 1 / length,
    unit = fit.axis.map((value) => value * reciprocal);
  const taper = radius - top,
    apexDistance = (radius * height) / taper;
  const origin = fit.center.map((value, i) => value + unit[i] * apexDistance);
  const opening = Math.atan(taper / height),
    start = (top * height) / taper;
  if (
    !origin.every(Number.isFinite) ||
    !Number.isFinite(start) ||
    !(opening > 0 && opening < Math.PI / 2)
  )
    throw new Error("Cone reference exceeds finite native cone geometry.");
  return {
    origin,
    direction: unit.map((value) => -value),
    opening,
    start,
    length: height,
  };
}

/** Original cone model handle routine: small end, large end, then apex. */
export function nativeDatumConeHandles(
  cone: NativeDatumConeGeometry,
): number[] {
  const end = cone.start + cone.length;
  return [
    ...cone.direction.map((value, i) => cone.start * value + cone.origin[i]),
    ...cone.direction.map((value, i) => end * value + cone.origin[i]),
    ...cone.origin,
  ];
}

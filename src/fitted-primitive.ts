import type { FitResult, KernelPrimitive, Vec3 } from "./types";

/** Persist detached finite fit diagnostics alongside the geometry they describe. */
export function copyFitResult(value: unknown): FitResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid fitted primitive metadata.");
  const input = value as Record<string, unknown>;
  const kind = input.kind;
  const vector = (value: unknown): Vec3 => {
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      !value.every((item) => typeof item === "number" && Number.isFinite(item))
    )
      throw new Error("Invalid fitted primitive vector.");
    return [...value] as Vec3;
  };
  const number = (value: unknown, positive = false): number => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (positive ? value <= 0 : value < 0)
    )
      throw new Error("Invalid fitted primitive dimension or residual.");
    return value;
  };
  if (
    kind !== "plane" &&
    kind !== "sphere" &&
    kind !== "cylinder" &&
    kind !== "cone"
  )
    throw new Error("Invalid fitted primitive kind.");
  const result: FitResult = {
    kind,
    center: vector(input.center),
    axis: vector(input.axis),
    rms: number(input.rms),
    maxError: number(input.maxError),
  };
  if (!(Math.hypot(...result.axis) > Number.EPSILON))
    throw new Error("Invalid fitted primitive axis.");
  if (kind !== "plane") result.radius = number(input.radius, kind !== "cone");
  if (kind === "cylinder" || kind === "cone")
    result.height = number(input.height, true);
  if (kind === "cone") {
    result.topRadius = number(input.topRadius);
    if (result.radius === 0 && result.topRadius === 0)
      throw new Error("Invalid fitted cone radii.");
  }
  return result;
}
/** Convert fitting conventions into the CAD worker's midpoint-based solids. */
export function fittedPrimitive(fit: FitResult): KernelPrimitive {
  if (fit.kind === "sphere")
    return { kind: "sphere", center: fit.center, radius: fit.radius! };
  if (fit.kind === "cylinder")
    return {
      kind: "cylinder",
      center: fit.center,
      axis: fit.axis,
      radius: fit.radius!,
      height: fit.height!,
    };
  if (fit.kind === "cone")
    return {
      kind: "cone",
      center: fit.center.map(
        (value, index) => value + (fit.axis[index] * fit.height!) / 2,
      ) as Vec3,
      axis: fit.axis,
      radius: fit.radius!,
      topRadius: fit.topRadius!,
      height: fit.height!,
    };
  throw new Error(
    "A fitted plane is a reference surface, not a solid primitive.",
  );
}

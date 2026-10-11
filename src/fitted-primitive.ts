import type { FitResult, KernelPrimitive, Vec3 } from "./types";
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

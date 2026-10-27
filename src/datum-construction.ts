import type { Entity, Vec3 } from "./types";
import { datumFrame } from "./origin";
import { validateSketchFrame, type SketchFrame } from "./sketch-frame";
import { validatePlaneFrame } from "./plane-frame";
import { DEFAULT_REFERENCE_COLOR } from "./appearance";

function vector(value: unknown): Vec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    Array.from(value).some(
      (v) => typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e9,
    )
  )
    throw new Error(
      "Datum vectors require three finite coordinates within +/-1e9.",
    );
  return [...value] as Vec3;
}
function unit(value: Vec3): Vec3 {
  const length = Math.hypot(...value);
  if (length <= 1e-12) throw new Error("Datum direction must be nonzero.");
  return value.map((v) => v / length) as Vec3;
}
/** Numeric datum placement is detached and retains an explicit rotation about Z. */
export function numericDatumFrame(
  origin: unknown,
  normal: unknown,
  xDirection?: unknown,
): SketchFrame {
  const center = vector(origin),
    n = unit(vector(normal));
  if (xDirection === undefined) return datumFrame(center, n);
  const direction = unit(vector(xDirection));
  const dot = direction.reduce((sum, v, i) => sum + v * n[i], 0);
  const projected = direction.map((v, i) => v - dot * n[i]) as Vec3;
  if (Math.hypot(...projected) < 1e-9)
    throw new Error("Datum X direction must not be parallel to its normal.");
  const u = unit(projected);
  const frame: SketchFrame = {
    origin: center,
    u,
    v: [
      n[1] * u[2] - n[2] * u[1],
      n[2] * u[0] - n[0] * u[2],
      n[0] * u[1] - n[1] * u[0],
    ],
    normal: n,
  };
  validateSketchFrame(frame);
  return frame;
}
/** Display triangles stay in binary64 so translated small planes remain coplanar. */
export function createNumericDatumPlane(
  frame: SketchFrame,
  size: number,
  id: string,
  name: string,
): Entity {
  validateSketchFrame(frame);
  if (
    typeof size !== "number" ||
    !Number.isFinite(size) ||
    size <= 0 ||
    size > 2e9
  )
    throw new Error("Datum display size must be positive and at most 2e9 mm.");
  const positions: number[] = [];
  for (const [x, y] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const point = frame.origin.map(
      (v, i) => v + (frame.u[i] * x * size) / 2 + (frame.v[i] * y * size) / 2,
    );
    vector(point);
    positions.push(...point);
  }
  const planeFrame = {
    center: [...frame.origin] as Vec3,
    normal: [...frame.normal] as Vec3,
    tangent: [...frame.u] as Vec3,
    displaySize: size,
  };
  validatePlaneFrame(planeFrame, positions, "plane");
  return {
    id,
    name,
    kind: "plane",
    positions,
    planeFrame,
    color: DEFAULT_REFERENCE_COLOR,
    visible: true,
    opacity: 0.5,
  };
}

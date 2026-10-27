import type { Entity, Positions, Vec3 } from "./types";
import { transformPositions } from "./geometry";

export function validatePlaneFrame(
  value: unknown,
  positions: Positions,
  kind: Entity["kind"],
): asserts value is NonNullable<Entity["planeFrame"]> {
  const frame = value as Entity["planeFrame"];
  const vector = (v: unknown): v is Vec3 =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every(
      (x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e9,
    );
  if (
    !frame ||
    !["plane", "cad"].includes(kind) ||
    !vector(frame.center) ||
    !vector(frame.normal) ||
    !vector(frame.tangent) ||
    Math.abs(Math.hypot(...frame.normal) - 1) > 1e-9 ||
    Math.hypot(...frame.tangent) === 0 ||
    (frame.displaySize !== undefined &&
      (typeof frame.displaySize !== "number" ||
        !Number.isFinite(frame.displaySize) ||
        frame.displaySize <= 0 ||
        frame.displaySize > 2e9))
  )
    throw new Error("Invalid construction plane frame.");
  for (let i = 0; i < positions.length; i += 3) {
    const distance = frame.normal.reduce(
      (sum, n, axis) => sum + n * (positions[i + axis] - frame.center[axis]),
      0,
    );
    if (!Number.isFinite(distance) || Math.abs(distance) > 0.001)
      throw new Error("Construction plane frame does not match its geometry.");
  }
}

/** The stored tangent can be nonunit and need not be perpendicular to the normal. */
export function planeFrameBasis(frame: NonNullable<Entity["planeFrame"]>) {
  const n = frame.normal;
  const dot = frame.tangent.reduce((sum, value, i) => sum + value * n[i], 0);
  const tangent = frame.tangent.map((value, i) => value - dot * n[i]) as Vec3;
  const length = Math.hypot(...tangent);
  if (!Number.isFinite(length) || length < 1e-9)
    throw new Error(
      "Construction plane tangent must not be parallel to its normal.",
    );
  const u = tangent.map((value) => value / length) as Vec3;
  const v: Vec3 = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ];
  return { u, v };
}

/** Positive uniform transforms retain a plane's stored tangent orientation. */
export function transformPlaneFrame(
  frame: NonNullable<Entity["planeFrame"]>,
  translation: Vec3,
  rotation: Vec3,
  scale: number,
): NonNullable<Entity["planeFrame"]> {
  const center = transformPositions(
    [...frame.center, ...frame.center, ...frame.center],
    translation,
    rotation,
    scale,
  ).slice(0, 3) as Vec3;
  const axes = transformPositions(
    [...frame.normal, ...frame.tangent, ...frame.normal],
    [0, 0, 0],
    rotation,
    1,
  );
  return {
    center,
    normal: axes.slice(0, 3) as Vec3,
    tangent: axes.slice(3, 6) as Vec3,
    ...(frame.displaySize === undefined
      ? {}
      : { displaySize: frame.displaySize * scale }),
  };
}

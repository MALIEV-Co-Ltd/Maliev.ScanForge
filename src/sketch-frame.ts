import type { Vec3 } from "./types";

/** Rigid, right-handed placement of local sketch UV coordinates in millimetres. */
export interface SketchFrame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  normal: Vec3;
}

export function validateSketchFrame(
  input: unknown,
): asserts input is SketchFrame {
  if (!input || typeof input !== "object")
    throw new Error("Sketch frame must be an object.");
  const frame = input as SketchFrame;
  for (const key of ["origin", "u", "v", "normal"] as const) {
    const vector = frame[key];
    if (
      !Array.isArray(vector) ||
      vector.length !== 3 ||
      vector.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9)
    )
      throw new Error(
        "Sketch frame vectors must contain three finite coordinates.",
      );
  }
  const dot = (a: Vec3, b: Vec3) => a.reduce((sum, n, i) => sum + n * b[i], 0);
  const { u, v, normal } = frame;
  const cross: Vec3 = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  if (
    [u, v, normal].some((axis) => Math.abs(dot(axis, axis) - 1) > 1e-8) ||
    Math.abs(dot(u, v)) > 1e-8 ||
    Math.abs(dot(u, normal)) > 1e-8 ||
    Math.abs(dot(v, normal)) > 1e-8 ||
    cross.some((n, i) => Math.abs(n - normal[i]) > 1e-8)
  )
    throw new Error("Sketch frame must be orthonormal and right-handed.");
}

/** Declared world conventions: OXZ has local U=Z, V=X, positive Y normal. */
export function coordinateSketchFrame(
  plane: "OXY" | "OYZ" | "OXZ",
  offset: number,
): SketchFrame {
  if (!["OXY", "OYZ", "OXZ"].includes(plane))
    throw new Error("Unsupported sketch plane.");
  const frame: SketchFrame =
    plane === "OXY"
      ? {
          origin: [0, 0, offset],
          u: [1, 0, 0],
          v: [0, 1, 0],
          normal: [0, 0, 1],
        }
      : plane === "OYZ"
        ? {
            origin: [offset, 0, 0],
            u: [0, 1, 0],
            v: [0, 0, 1],
            normal: [1, 0, 0],
          }
        : {
            origin: [0, offset, 0],
            u: [0, 0, 1],
            v: [1, 0, 0],
            normal: [0, 1, 0],
          };
  validateSketchFrame(frame);
  return frame;
}

export function sketchWorldPoint(
  frame: SketchFrame,
  point: [number, number],
): Vec3 {
  validateSketchFrame(frame);
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    point.some((n) => !Number.isFinite(n))
  )
    throw new Error("Sketch point must be finite.");
  const world = frame.origin.map(
    (n, i) => n + frame.u[i] * point[0] + frame.v[i] * point[1],
  ) as Vec3;
  if (world.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9))
    throw new Error("Placed sketch coordinates must be finite and bounded.");
  return world;
}

import type { Vec3 } from "./types";

/** Native plane-frame policy with a stable tangent hint for origin planes. */
export function mirrorPlaneFrame(
  center: Vec3,
  normal: Vec3,
  tangent?: Vec3,
): number[] {
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  // The picked-plane handler uses normal cross stored tangent as its hint.
  let hint: Vec3 = tangent
    ? cross(normal, tangent)
    : Math.abs(normal[2]) === 1
      ? [0, 1, 0]
      : [0, 0, 1];
  const candidate = cross(hint, normal);
  if (candidate.reduce((sum, value) => sum + value * value, 0) <= 0.0001) {
    let axis = 0;
    if (
      Math.min(Math.abs(normal[1]), Math.abs(normal[2])) < Math.abs(normal[0])
    )
      axis = Math.abs(normal[2]) < Math.abs(normal[1]) ? 2 : 1;
    hint = [0, 0, 0];
    hint[axis] = 1;
  }
  const u = cross(hint, normal),
    v = cross(normal, u);
  for (const vector of [u, v]) {
    const length = Math.sqrt(
      vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2],
    );
    if (length >= Number.EPSILON) {
      const reciprocal = 1 / length;
      for (let axis = 0; axis < 3; axis++) vector[axis] *= reciprocal;
    }
  }
  return [
    u[0],
    v[0],
    normal[0],
    center[0],
    u[1],
    v[1],
    normal[1],
    center[1],
    u[2],
    v[2],
    normal[2],
    center[2],
  ];
}

/** Preserve the original transpose and translation summation order. */
export function inverseMirrorFrame(m: number[]): number[] {
  return [
    m[0],
    m[4],
    m[8],
    -(m[7] * m[4] + m[3] * m[0] + m[11] * m[8]),
    m[1],
    m[5],
    m[9],
    -(m[7] * m[5] + m[1] * m[3] + m[11] * m[9]),
    m[2],
    m[6],
    m[10],
    -(m[2] * m[3] + m[7] * m[6] + m[11] * m[10]),
  ];
}

/** The original handler rounds local coordinates before reflecting local Z. */
export function mirrorFramePoint(
  x: number,
  y: number,
  z: number,
  m: number[],
  inverse: number[],
): Vec3 {
  const u = Math.fround(
    inverse[0] * x + inverse[1] * y + inverse[2] * z + inverse[3],
  );
  const v = Math.fround(
    inverse[4] * x + inverse[5] * y + inverse[6] * z + inverse[7],
  );
  const w = -Math.fround(
    inverse[8] * x + inverse[9] * y + inverse[10] * z + inverse[11],
  );
  return [
    u * m[0] + v * m[1] + w * m[2] + m[3],
    v * m[5] + u * m[4] + w * m[6] + m[7],
    v * m[9] + u * m[8] + w * m[10] + m[11],
  ];
}

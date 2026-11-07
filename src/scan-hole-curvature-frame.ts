import { nativeGlobalPlane } from "./scan-native-global-plane";
import { nativeAlignmentEigen3 } from "./scan-native-alignment-eigen";
import { nativeJacobiEigen3 } from "./scan-native-jacobi-eigen";
import { nativeReferenceNormalize as normalize } from "./reference-geometry-numerics";
import {
  nativeGlobalSine,
  nativeGlobalCosine,
} from "./scan-native-global-trig";
import { mirrorPlaneFrame } from "./scan-mirror-frame";
import type { Vec3 } from "./types";

/** Native automatic rectangle, followed by the internal fitting ten-percent margin. */
export function nativeCurvatureFrame(
  points: readonly (readonly number[])[],
  normals: readonly (readonly number[])[],
  check?: () => void,
): { center: Vec3; x: Vec3; y: Vec3; z: Vec3; halfU: number; halfV: number } {
  check?.();
  if (points.length < 3)
    throw new Error("Curvature requires a nondegenerate collar plane.");
  const plane = nativeGlobalPlane(points, { normals });
  if (!plane.accepted)
    throw new Error("Curvature collar has no usable graph plane.");
  const cross = (a: readonly number[], b: readonly number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const center = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    if (i % 4096 === 0) check?.();
    for (let a = 0; a < 3; a++) center[a] += points[i][a];
  }
  for (let a = 0; a < 3; a++) center[a] *= 1 / points.length;
  const moments = Array<number>(9).fill(0);
  for (let i = 0; i < points.length; i++) {
    if (i % 4096 === 0) check?.();
    const d = center.map((v, a) => v - points[i][a]);
    for (let row = 0; row < 3; row++)
      for (let column = row; column < 3; column++) {
        moments[row * 3 + column] += d[row] * d[column];
        if (row !== column)
          moments[column * 3 + row] = moments[row * 3 + column];
      }
  }
  const ql = nativeAlignmentEigen3(moments, true);
  const eigen = ql.accepted ? ql : nativeJacobiEigen3(moments, true);
  if (
    !eigen.values.every(Number.isFinite) ||
    !eigen.vectors.every(Number.isFinite)
  )
    throw new Error("Curvature collar has a degenerate plane.");
  const normal = plane.normal;
  let secondary = normalize([
    eigen.vectors[1],
    eigen.vectors[4],
    eigen.vectors[7],
  ]);
  const across = normalize(cross(secondary, normal));
  secondary = normalize(cross(normal, across));
  const distance =
    center[1] * normal[1] +
    normal[0] * center[0] +
    center[2] * normal[2] +
    plane.coefficient;
  for (let a = 0; a < 3; a++) center[a] -= normal[a] * distance;
  function bounds(axis: readonly number[], second: boolean) {
    let low = 0,
      high = 0;
    for (let i = 0; i < points.length; i++) {
      if (i % 4096 === 0) check?.();
      const p = points[i];
      const along =
        (p[1] - center[1]) * axis[1] +
        (p[0] - center[0]) * axis[0] +
        (p[2] - center[2]) * axis[2];
      const projected = axis.map((v, a) => v * along + center[a]);
      const d = center.map((v, a) => v - projected[a]);
      let value = Math.sqrt(
        second
          ? d[1] * d[1] + d[0] * d[0] + d[2] * d[2]
          : d[0] * d[0] + d[1] * d[1] + d[2] * d[2],
      );
      if (
        (projected[1] - center[1]) * axis[1] +
          (projected[0] - center[0]) * axis[0] +
          (projected[2] - center[2]) * axis[2] <=
        0
      )
        value = -value;
      if (value < low) low = value;
      if (high < value) high = value;
    }
    return { low, high };
  }
  let u = secondary,
    v = across;
  let ub = bounds(u, false),
    vb = bounds(v, true);
  let area = (ub.high - ub.low) * (vb.high - vb.low);
  for (let degrees = -90; degrees <= 90; degrees += 3) {
    check?.();
    const angle = degrees * (Math.PI / 180),
      s = nativeGlobalSine(angle),
      c = nativeGlobalCosine(angle),
      d = 1 - c;
    const [x, y, z] = normal;
    const xy = x * y * d,
      xz = x * z * d,
      yz = z * y * d;
    const m = [
      x * x * d + c,
      xy - z * s,
      y * s + xz,
      z * s + xy,
      y * y * d + c,
      yz - x * s,
      xz - y * s,
      x * s + yz,
      z * z * d + c,
    ];
    const rotate = (p: readonly number[]) => [
      m[1] * p[1] + m[0] * p[0] + p[2] * m[2],
      m[4] * p[1] + m[3] * p[0] + p[2] * m[5],
      m[7] * p[1] + m[6] * p[0] + p[2] * m[8],
    ];
    const cu = rotate(secondary),
      cv = rotate(across);
    const cuBounds = bounds(cu, false),
      cvBounds = bounds(cv, true);
    const candidateArea =
      (cuBounds.high - cuBounds.low) * (cvBounds.high - cvBounds.low);
    if (candidateArea < area) {
      area = candidateArea;
      u = cu;
      v = cv;
      ub = cuBounds;
      vb = cvBounds;
    }
  }
  const halfU = (ub.high - ub.low) * 0.5,
    halfV = (vb.high - vb.low) * 0.5;
  for (let a = 0; a < 3; a++)
    center[a] = u[a] * ub.high + center[a] - u[a] * halfU;
  for (let a = 0; a < 3; a++)
    center[a] = v[a] * vb.high + center[a] - v[a] * halfV;
  const z = normalize(normal) as Vec3;
  u = normalize(cross(z, cross(u, z)));
  const m = mirrorPlaneFrame(center as Vec3, z, u as Vec3);
  const x: Vec3 = [m[0], m[4], m[8]],
    y: Vec3 = [m[1], m[5], m[9]];
  if (
    ![...center, ...x, ...y, ...z, halfU, halfV].every(Number.isFinite) ||
    !(halfU > 0 && halfV > 0)
  )
    throw new Error("Curvature frame is degenerate or nonfinite.");
  return {
    center: center as Vec3,
    x,
    y,
    z,
    halfU: halfU * 1.1,
    halfV: halfV * 1.1,
  };
}

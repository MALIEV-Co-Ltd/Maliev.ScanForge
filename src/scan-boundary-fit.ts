import type { MeshProcessingOptions } from "./mesh-processing";
import type { Vec3 } from "./types";
import {
  nativeBasis,
  nativeDerivative,
  nativeFactor,
  nativeSubstitute,
} from "./native-surface-fitting";

export interface BoundaryCurveFit {
  poles: Float64Array;
  knots: number[];
  parameters: Float64Array;
  maxError: number;
  meanError: number;
  refinements: number;
  toleranceMet: boolean;
  periodic: boolean;
}

function check(options: MeshProcessingOptions) {
  if (options.signal?.aborted)
    throw new DOMException("Boundary fitting cancelled.", "AbortError");
}

function basis(
  knots: number[],
  index: number,
  u: number,
  derivative: 0 | 1 | 2,
) {
  if (!derivative) return nativeBasis(knots, 4, index, u);
  // The scalar helper's last-knot derivative is zero; the curve uses the left limit.
  if (u === knots.at(-1)) {
    const reversed = knots.map((v) => -v).reverse();
    return (
      (-1) ** derivative *
      nativeDerivative(reversed, 4, knots.length - 5 - index, derivative, -u)
    );
  }
  return nativeDerivative(knots, 4, index, derivative, u);
}

export function evaluateBoundaryCurve(
  curve: BoundaryCurveFit,
  parameter: number,
  derivative: 0 | 1 | 2 = 0,
): Vec3 {
  if (!Number.isFinite(parameter) || parameter < 0 || parameter > 1)
    throw new Error("Boundary curve parameter must be within zero and one.");
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < curve.poles.length / 3; i++) {
    const weight = basis(curve.knots, i, parameter, derivative);
    for (let axis = 0; axis < 3; axis++)
      out[axis] += weight * curve.poles[i * 3 + axis];
  }
  return out;
}

function knotsFor(count: number, closed: boolean) {
  const spans = count - 3;
  if (closed)
    return Array.from({ length: count + 4 }, (_, i) => (i - 3) / spans);
  return [
    0,
    0,
    0,
    0,
    ...Array.from({ length: spans - 1 }, (_, i) => (i + 1) / spans),
    1,
    1,
    1,
    1,
  ];
}

function fitAtCount(
  points: Float64Array,
  parameters: Float64Array,
  count: number,
  closed: boolean,
  options: MeshProcessingOptions,
): BoundaryCurveFit | undefined {
  const knots = knotsFor(count, closed),
    constraints = closed ? 3 : 0;
  const size = count + constraints;
  const matrix = new Float64Array(size * size);
  const rhs = Array.from({ length: 3 }, () => new Float64Array(size));
  for (let row = 0; row < parameters.length; row++) {
    if (row % 1024 === 0) check(options);
    const weights = Array.from({ length: count }, (_, i) =>
      basis(knots, i, parameters[row], 0),
    );
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++)
        matrix[i * size + j] += weights[i] * weights[j];
      for (let axis = 0; axis < 3; axis++)
        rhs[axis][i] += weights[i] * points[row * 3 + axis];
    }
  }
  if (closed) {
    for (const [constraint, derivative] of ([1, 2, 0] as const).entries()) {
      for (let i = 0; i < count; i++) {
        const weight =
          basis(knots, i, parameters[0], derivative) -
          basis(knots, i, parameters.at(-1)!, derivative);
        matrix[(count + constraint) * size + i] = weight;
        matrix[i * size + count + constraint] = weight;
      }
    }
  }
  check(options);
  const factor = nativeFactor(matrix, size, 1e-20);
  if (!factor.accepted) return undefined;
  const poles = new Float64Array(count * 3);
  for (let axis = 0; axis < 3; axis++) {
    const solved = nativeSubstitute(factor.lu, size, factor.pivots, rhs[axis]);
    for (let i = 0; i < count; i++) poles[i * 3 + axis] = solved[i];
  }
  const curve: BoundaryCurveFit = {
    poles,
    knots,
    parameters,
    maxError: 0,
    meanError: 0,
    refinements: 0,
    toleranceMet: false,
    periodic: closed,
  };
  for (let row = 0; row < parameters.length; row++) {
    if (row % 1024 === 0) check(options);
    const p = evaluateBoundaryCurve(curve, parameters[row]);
    const dx = p[0] - points[row * 3],
      dy = p[1] - points[row * 3 + 1],
      dz = p[2] - points[row * 3 + 2];
    const error = Math.sqrt(dx * dx + dy * dy + dz * dz);
    curve.maxError = Math.max(curve.maxError, error);
    curve.meanError += error;
  }
  curve.meanError /= parameters.length;
  return curve;
}

function refineParameters(
  curve: BoundaryCurveFit,
  points: Float64Array,
  options: MeshProcessingOptions,
) {
  const next = curve.parameters.slice();
  for (let row = 0; row < next.length; row++) {
    if (row % 1024 === 0) check(options);
    const original = next[row];
    let u = original;
    for (let step = 0; step < 10; step++) {
      const p = evaluateBoundaryCurve(curve, u),
        d1 = evaluateBoundaryCurve(curve, u, 1),
        d2 = evaluateBoundaryCurve(curve, u, 2);
      const delta = p.map((v, axis) => v - points[row * 3 + axis]);
      const numerator = d1[1] * delta[1] + d1[0] * delta[0] + d1[2] * delta[2];
      const denominator =
        d2[1] * delta[1] +
        d2[0] * delta[0] +
        d2[2] * delta[2] +
        (d1[1] * d1[1] + d1[0] * d1[0] + d1[2] * d1[2]);
      const change = numerator / denominator;
      if (!Number.isFinite(change)) break;
      u -= change;
      if (u < 0 || u > 1) {
        u = original;
        break;
      }
      if (Math.abs(change) <= 1e-6) break;
    }
    next[row] = u;
  }
  return next;
}

/** Native boundary fitting uses a bounded cubic solve, independently of planar sketches. */
export function fitBoundaryCurve(
  points: Float64Array,
  closed: boolean,
  tolerance: number,
  options: MeshProcessingOptions = {},
): BoundaryCurveFit {
  check(options);
  if (!points.length || points.length % 3 || points.length < 12)
    throw new Error("Boundary fitting requires at least four complete points.");
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Boundary fitting tolerance must be positive and finite.");
  const samples = points.length / 3;
  const parameters = new Float64Array(samples);
  for (let row = 0; row < samples; row++) {
    if (row % 1024 === 0) check(options);
    if (
      !Number.isFinite(points[row * 3]) ||
      !Number.isFinite(points[row * 3 + 1]) ||
      !Number.isFinite(points[row * 3 + 2])
    )
      throw new Error("Boundary fitting coordinates must be finite.");
    if (!row) continue;
    const dx = points[row * 3] - points[(row - 1) * 3],
      dy = points[row * 3 + 1] - points[(row - 1) * 3 + 1],
      dz = points[row * 3 + 2] - points[(row - 1) * 3 + 2];
    parameters[row] =
      parameters[row - 1] + Math.pow(dx * dx + dy * dy + dz * dz, 0.25);
  }
  const total = parameters.at(-1)!;
  if (!(total > 0) || !Number.isFinite(total))
    throw new Error("Boundary fitting points are coincident or degenerate.");
  for (let row = 0; row < samples; row++) parameters[row] /= total;
  parameters[samples - 1] = 1;
  const periodic =
    closed &&
    Math.hypot(
      points[0] - points.at(-3)!,
      points[1] - points.at(-2)!,
      points[2] - points.at(-1)!,
    ) <= 1e-5;
  let last: BoundaryCurveFit | undefined;
  for (
    let count = Math.min(samples, 5);
    count <= Math.min(samples, 100);
    count++
  ) {
    check(options);
    options.onProgress?.(
      (count - Math.min(samples, 5)) /
        Math.max(1, Math.min(samples, 100) - Math.min(samples, 5)),
      "Fitting boundary curve",
    );
    check(options);
    if (periodic && count < 7) continue;
    let curve = fitAtCount(points, parameters, count, periodic, options);
    if (!curve) continue;
    for (let iteration = 0; iteration < 10 && curve.maxError > 0; iteration++) {
      const previous = curve.maxError;
      const next = fitAtCount(
        points,
        refineParameters(curve, points, options),
        count,
        periodic,
        options,
      );
      if (!next) break;
      next.refinements = iteration + 1;
      curve = next;
      if ((previous - curve.maxError) / Math.max(curve.maxError, 1e-6) <= 0.001)
        break;
    }
    // Native candidate admission uses mean error; refinement still uses maximum error.
    curve.toleranceMet = curve.meanError <= tolerance;
    last = curve;
    if (curve.toleranceMet) break;
  }
  check(options);
  if (!last)
    throw new Error(
      "Boundary fitting has a singular or insufficient point set.",
    );
  return last;
}

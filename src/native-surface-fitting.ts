/** Recovered native approximation arithmetic. Whole native fitting/controller parity is not claimed.
 * Captured 4x4 cubic/default-weight fixtures compare bit for bit; no arithmetic reassociation.
 * GUI and MCP use the shared fitting adapter owned by surfaces.ts.
 */
import {
  NATIVE_SURFACE_QUADRATURE,
  type NativeSurfaceQuadrature,
} from "./native-surface-quadrature";
type NumericInput = readonly number[] | Float64Array;
export interface NativeFactorResult {
  accepted: boolean;
  lu: number[];
  pivots: number[];
  sign: number;
}
export type NativeSolveResult =
  | { accepted: false; lu?: number[]; pivots?: number[]; sign?: number }
  | {
      accepted: true;
      output: number[];
      lu: number[];
      pivots: number[];
      sign: number;
    };
export interface NativeSurfaceMatrices {
  columns: number[][];
  gram: number[];
  penalty1: number[];
  penalty2: number[];
  system: number[];
  rhs: number[][];
  coordinates: NativeSolveResult[];
}
export const NATIVE_SURFACE_MAX_BYTES = 64 * 1024 * 1024;
export const NATIVE_SURFACE_MAX_SCALAR_WORK = 250_000_000;
export const NATIVE_SURFACE_MAX_COEFFICIENTS = 256;
export const NATIVE_SURFACE_MAX_SAMPLES = 10_000;
function basisUnchecked(
  knots: readonly number[],
  order: number,
  index: number,
  t: number,
): number {
  if (
    (index === 0 && t === knots[0]) ||
    (index === knots.length - order - 1 && t === knots.at(-1))
  )
    return 1;
  if (t < knots[index] || knots[index + order] <= t) return 0;
  const b: number[] = Array.from({ length: order }, (_, j) =>
    knots[index + j] <= t && t < knots[index + j + 1] ? 1 : 0,
  );
  for (let d = 1; d < order; d++) {
    let left =
      b[0] === 0
        ? 0
        : ((t - knots[index]) * b[0]) / (knots[index + d] - knots[index]);
    for (let j = 1; j <= order - d; j++) {
      if (b[j] === 0) {
        b[j - 1] = left;
        left = 0;
      } else {
        const scale = b[j] / (knots[index + j + d] - knots[index + j]);
        b[j - 1] = (knots[index + j + d] - t) * scale + left;
        left = (t - knots[index + j]) * scale;
      }
    }
  }
  return b[0];
}
function derivativeUnchecked(
  knots: readonly number[],
  order: number,
  index: number,
  derivative: number,
  t: number,
): number {
  if (derivative === 0) return basisUnchecked(knots, order, index, t);
  if (derivative >= order || !(knots[index] <= t && t < knots[index + order]))
    return 0;
  const table = Array.from({ length: order }, () => Array(order).fill(0));
  for (let j = 0; j < order; j++)
    table[j][0] = knots[index + j] <= t && t < knots[index + j + 1] ? 1 : 0;
  for (let d = 1; d < order; d++) {
    let left =
      table[0][d - 1] === 0
        ? 0
        : ((t - knots[index]) * table[0][d - 1]) /
          (knots[index + d] - knots[index]);
    for (let j = 1; j <= order - d; j++) {
      if (table[j][d - 1] === 0) {
        table[j - 1][d] = left;
        left = 0;
      } else {
        const scale =
          table[j][d - 1] / (knots[index + j + d] - knots[index + j]);
        table[j - 1][d] = (knots[index + j + d] - t) * scale + left;
        left = (t - knots[index + j]) * scale;
      }
    }
  }
  const degree = order - 1,
    b = Array.from(
      { length: derivative + 1 },
      (_, j) => table[j][degree - derivative],
    );
  for (let step = 1; step <= derivative; step++) {
    const d = degree - derivative + step;
    let left = b[0] === 0 ? 0 : b[0] / (knots[index + d] - knots[index]);
    for (let j = 1; j <= derivative - step + 1; j++) {
      if (b[j] === 0) {
        b[j - 1] = d * left;
        left = 0;
      } else {
        const right = b[j] / (knots[index + j + d] - knots[index + j]);
        b[j - 1] = (left - right) * d;
        left = right;
      }
    }
  }
  return b[0];
}
function integralUnchecked(
  knots: readonly number[],
  order: number,
  i: number,
  j: number,
  p: number,
  q: number,
  quadratures: readonly NativeSurfaceQuadrature[],
): number {
  const degree = order * 2 - p - q - 2;
  const selector =
    degree < 0
      ? 0
      : degree < 4
        ? 1
        : degree < 8
          ? 3
          : degree < 12
            ? 5
            : degree < 16
              ? 7
              : degree < 20
                ? 9
                : 11;
  const rule = quadratures.find((r) => r.selector === selector)!;
  let end = order + Math.min(i, j);
  if (end === knots.length - 1) end--;
  let result = 0;
  for (let span = Math.max(i, j); span < end; span++) {
    const left = knots[span],
      right = knots[span + 1];
    if (!(left < right)) continue;
    const width = right - left;
    for (let n = 0; n < rule.count; n++) {
      const t = (rule.nodes.float64[n] + 1) * 0.5 * width + left;
      const a = derivativeUnchecked(knots, order, i, p, t),
        b = derivativeUnchecked(knots, order, j, q, t);
      // Assembly precomputes half-span*weight, scales first derivative, then multiplies second.
      result = result + b * (a * (width * 0.5 * rule.weights.float64[n]));
    }
  }
  return result;
}
function factorUnchecked(
  input: NumericInput,
  n: number,
  tolerance: number,
): NativeFactorResult {
  const lu = Array.from(input),
    scaling = Array(n).fill(0),
    pivots = Array(n).fill(0);
  let sign = 1;
  for (let i = 0; i < n; i++) {
    let largest = 0;
    for (let j = 0; j < n; j++)
      if (!(Math.abs(lu[i * n + j]) <= largest))
        largest = Math.abs(lu[i * n + j]);
    if (Math.abs(largest) < tolerance)
      return { accepted: false, lu, pivots, sign };
    scaling[i] = 1 / largest;
  }
  let pivot = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < j; i++) {
      let value = lu[i * n + j];
      for (let k = 0; k < i; k++) value = value - lu[k * n + j] * lu[i * n + k];
      lu[i * n + j] = value;
    }
    let largest = 0;
    for (let i = j; i < n; i++) {
      let value = lu[i * n + j];
      for (let k = 0; k < j; k++) value = value - lu[k * n + j] * lu[i * n + k];
      lu[i * n + j] = value;
      const scaled = Math.abs(value) * scaling[i];
      if (!(scaled < largest)) {
        largest = scaled;
        pivot = i;
      }
    }
    if (j !== pivot) {
      for (let k = 0; k < n; k++)
        [lu[pivot * n + k], lu[j * n + k]] = [lu[j * n + k], lu[pivot * n + k]];
      sign = -sign;
      scaling[pivot] = scaling[j];
    }
    pivots[j] = pivot;
    const diagonal = lu[j * n + j];
    if (Math.abs(diagonal) < tolerance)
      return { accepted: false, lu, pivots, sign };
    if (j !== n - 1)
      for (let i = j + 1; i < n; i++)
        lu[i * n + j] = (1 / diagonal) * lu[i * n + j];
  }
  return { accepted: true, lu, pivots, sign };
}
function substituteUnchecked(
  lu: NumericInput,
  n: number,
  pivots: readonly number[],
  rhs: NumericInput,
): number[] {
  const b = Array.from(rhs);
  let first = -1;
  for (let i = 0; i < n; i++) {
    const pivot = pivots[i];
    let value = b[pivot];
    b[pivot] = b[i];
    if (first === -1) {
      if (value !== 0) first = i;
    } else for (let j = first; j < i; j++) value = value - lu[i * n + j] * b[j];
    b[i] = value;
  }
  for (let i = n - 1; i >= 0; i--) {
    let value = b[i];
    for (let j = i + 1; j < n; j++) value = value - lu[i * n + j] * b[j];
    b[i] = value / lu[i * n + i];
  }
  return b;
}
function solveUnchecked(
  input: NumericInput,
  rhs: NumericInput,
  tolerance: number = 2 ** -23,
): NativeSolveResult {
  const n = rhs.length,
    a = Array.from(input),
    scale = Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    let largest = 0;
    for (let i = 0; i < n; i++)
      if (largest <= Math.abs(a[i * n + j])) largest = Math.abs(a[i * n + j]);
    if (largest <= Number.EPSILON) return { accepted: false };
    scale[j] = 1 / largest;
    for (let i = 0; i < n; i++) a[i * n + j] = (1 / largest) * a[i * n + j];
  }
  const factored = factorUnchecked(a, n, tolerance);
  if (!factored.accepted)
    return {
      accepted: false,
      lu: factored.lu,
      pivots: factored.pivots,
      sign: factored.sign,
    };
  const solved = substituteUnchecked(factored.lu, n, factored.pivots, rhs);
  return {
    accepted: true,
    output: solved.map((v, i) => v * scale[i]),
    lu: factored.lu,
    pivots: factored.pivots,
    sign: factored.sign,
  };
}
function matricesUnchecked(
  points: readonly (readonly number[])[],
  uv: readonly (readonly number[])[],
  nU: number,
  nV: number,
  orderU: number,
  orderV: number,
  knotsU: readonly number[],
  knotsV: readonly number[],
  quadratures: readonly NativeSurfaceQuadrature[],
  lambda: number = 0.0001,
): NativeSurfaceMatrices {
  const n = nU * nV,
    columns: number[][] = [];
  for (let i = 0; i < nU; i++)
    for (let j = 0; j < nV; j++)
      columns.push(
        uv.map(
          ([u, v]) =>
            basisUnchecked(knotsU, orderU, i, u) *
            basisUnchecked(knotsV, orderV, j, v),
        ),
      );
  const gram = Array(n * n).fill(0),
    r1 = Array(n * n).fill(0),
    r2 = Array(n * n).fill(0);
  for (let a = 0; a < n; a++)
    for (let b = a; b < n; b++) {
      let value = 0;
      for (let q = 0; q < points.length; q++)
        value = value + columns[a][q] * columns[b][q];
      gram[b * n + a] = value;
      gram[a * n + b] = value;
    }
  const cache = new Map<string, number>();
  const integral = (
    axis: number,
    i: number,
    j: number,
    p: number,
    q: number,
  ): number => {
    const key = [axis, i, j, p, q].join(",");
    if (cache.has(key)) return cache.get(key)!;
    const value = integralUnchecked(
      axis === 0 ? knotsU : knotsV,
      axis === 0 ? orderU : orderV,
      i,
      j,
      p,
      q,
      quadratures,
    );
    cache.set(key, value);
    return value;
  };
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++) {
      const iu = Math.floor(b / nV),
        ju = Math.floor(a / nV),
        iv = b % nV,
        jv = a % nV;
      const u = (p: number, q: number) => integral(0, iu, ju, p, q),
        v = (p: number, q: number) => integral(1, iv, jv, p, q);
      const mixed = v(1, 1) * (u(1, 1) * 2);
      r1[a * n + b] = v(2, 2) * u(0, 0) + (v(0, 0) * u(2, 2) + mixed);
      let third = v(0, 0) * u(3, 3);
      third = v(0, 2) * u(3, 1) + third;
      third = v(2, 0) * u(1, 3) + third;
      third = v(2, 2) * u(1, 1) + third;
      third = v(1, 1) * u(2, 2) + third;
      third = v(3, 1) * u(0, 2) + third;
      third = v(1, 3) * u(2, 0) + third;
      r2[a * n + b] = v(3, 3) * u(0, 0) + third;
    }
  const system = gram.map((v, i) => v + lambda * (r1[i] + 0.1 * r2[i]));
  const rhs = [0, 1, 2].map((axis) =>
    columns.map((column) => {
      let value = 0;
      for (let q = 0; q < points.length; q++)
        value = value + column[q] * points[q][axis];
      return value;
    }),
  );
  return {
    columns,
    gram,
    penalty1: r1,
    penalty2: r2,
    system,
    rhs,
    coordinates: rhs.map((b) => solveUnchecked(system, b)),
  };
}

function integer(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
}
function finiteArray(values: NumericInput, label: string): void {
  if (!Array.isArray(values) && !(values instanceof Float64Array))
    throw new Error(`${label} must be a numeric array.`);
  for (let i = 0; i < values.length; i++)
    if (!Number.isFinite(values[i]))
      throw new Error(`${label} contains nonfinite values.`);
}
function validateBasis(
  knots: readonly number[],
  order: number,
  index: number,
  t: number,
): void {
  integer(order, 1, 6, "Native basis order");
  if (!Array.isArray(knots) || knots.length > 64)
    throw new Error("Native basis needs a bounded expanded knot array.");
  finiteArray(knots, "Native knots");
  const count = knots.length - order;
  integer(count, order, 32, "Native basis control count");
  integer(index, 0, count - 1, "Native basis index");
  if (!Number.isFinite(t)) throw new Error("Native parameter must be finite.");
  for (let i = 1; i < knots.length; i++)
    if (knots[i] < knots[i - 1])
      throw new Error("Native knots must be nondecreasing.");
  if (!(knots[0] < knots[knots.length - 1]))
    throw new Error("Native knots must span a positive interval.");
}
function validateRules(rules: readonly NativeSurfaceQuadrature[]): void {
  const selectors = [0, 1, 3, 5, 7, 9, 11];
  const counts = [1, 2, 4, 6, 8, 10, 12];
  if (!Array.isArray(rules) || rules.length !== selectors.length)
    throw new Error("Native quadrature requires seven bounded rules.");
  for (let i = 0; i < selectors.length; i++) {
    const rule = rules[i];
    if (
      !rule ||
      rule.selector !== selectors[i] ||
      rule.count !== counts[i] ||
      rule.nodes?.float64?.length !== rule.count ||
      rule.weights?.float64?.length !== rule.count
    )
      throw new Error(
        "Native quadrature shape does not match the captured rules.",
      );
    finiteArray(rule.nodes.float64, "Native quadrature nodes");
    finiteArray(rule.weights.float64, "Native quadrature weights");
  }
}
function validateMatrix(
  input: NumericInput,
  n: number,
  tolerance: number,
): void {
  integer(n, 1, NATIVE_SURFACE_MAX_COEFFICIENTS, "Native matrix dimension");
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Native pivot tolerance must be finite and positive.");
  if (!input || input.length !== n * n)
    throw new Error("Native matrix must be square.");
  finiteArray(input, "Native matrix");
}
function finiteResult(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("Native arithmetic exceeded the finite numeric range.");
  return value;
}

/** Evaluate the original scalar recurrence, including exact endpoint handling. */
export function nativeBasis(
  knots: readonly number[],
  order: number,
  index: number,
  t: number,
): number {
  validateBasis(knots, order, index, t);
  return finiteResult(basisUnchecked(knots, order, index, t));
}
/** Original derivative recurrence; positive derivatives at the last endpoint return zero. */
export function nativeDerivative(
  knots: readonly number[],
  order: number,
  index: number,
  derivative: number,
  t: number,
): number {
  validateBasis(knots, order, index, t);
  integer(derivative, 0, 6, "Native derivative order");
  return finiteResult(derivativeUnchecked(knots, order, index, derivative, t));
}
/** Original quadrature constants and multiplication/addition order. */
export function nativeIntegral(
  knots: readonly number[],
  order: number,
  i: number,
  j: number,
  p: number,
  q: number,
  rules: readonly NativeSurfaceQuadrature[] = NATIVE_SURFACE_QUADRATURE,
): number {
  validateBasis(knots, order, i, knots[0]);
  validateBasis(knots, order, j, knots[0]);
  integer(p, 0, 6, "First derivative order");
  integer(q, 0, 6, "Second derivative order");
  validateRules(rules);
  return finiteResult(integralUnchecked(knots, order, i, j, p, q, rules));
}
/** Scaled partial-pivot LU. Equal scaled candidates select the later row. */
export function nativeFactor(
  input: NumericInput,
  n: number,
  tolerance = 2 ** -23,
): NativeFactorResult {
  validateMatrix(input, n, tolerance);
  const result = factorUnchecked(input, n, tolerance);
  finiteArray(result.lu, "Native LU result");
  return result;
}
/** Original permutation, forward substitution and backward substitution. */
export function nativeSubstitute(
  lu: NumericInput,
  n: number,
  pivots: readonly number[],
  rhs: NumericInput,
): number[] {
  validateMatrix(lu, n, 2 ** -23);
  if (!Array.isArray(pivots) || pivots.length !== n || !rhs || rhs.length !== n)
    throw new Error("Native substitution dimensions do not match.");
  for (const pivot of pivots) integer(pivot, 0, n - 1, "Native pivot");
  finiteArray(rhs, "Native RHS");
  for (let i = 0; i < n; i++)
    if (lu[i * n + i] === 0)
      throw new Error("Native substitution requires nonzero pivots.");
  const result = substituteUnchecked(lu, n, pivots, rhs);
  finiteArray(result, "Native substituted coordinates");
  return result;
}
/** Column-normalized native solve; input buffers remain unchanged on success and failure. */
export function nativeSolve(
  input: NumericInput,
  rhs: NumericInput,
  tolerance = 2 ** -23,
): NativeSolveResult {
  if (!rhs) throw new Error("Native solve requires an RHS array.");
  validateMatrix(input, rhs.length, tolerance);
  finiteArray(rhs, "Native RHS");
  const result = solveUnchecked(input, rhs, tolerance);
  if (result.accepted) finiteArray(result.output, "Native solved coordinates");
  return result;
}
/** Conservative workspace admission; estimates include ordinary JS array overhead. */
export function nativeSurfaceWorkingSet(
  countU: number,
  countV: number,
  samples: number,
): { bytes: number; scalarWork: number } {
  integer(countU, 2, 32, "Native U control count");
  integer(countV, 2, 32, "Native V control count");
  const n = countU * countV;
  integer(n, 4, NATIVE_SURFACE_MAX_COEFFICIENTS, "Native coefficient count");
  integer(samples, n, NATIVE_SURFACE_MAX_SAMPLES, "Native sample count");
  const bytes =
    16 *
    (n * samples +
      6 * n * n +
      32 * n +
      8 * samples +
      36 * (countU * countU + countV * countV));
  const scalarWork =
    n * n * samples +
    3 * n * n * n +
    12 * 36 * 36 * (countU * countU + countV * countV);
  if (
    bytes > NATIVE_SURFACE_MAX_BYTES ||
    scalarWork > NATIVE_SURFACE_MAX_SCALAR_WORK
  )
    throw new Error(
      "Native surface fit exceeds the bounded workspace or scalar-work limit. Lower control resolution or sample count.",
    );
  return { bytes, scalarWork };
}
/** Build all three coordinate systems with the captured default weights [0, 1, 0.1].
 * Parameters are supplied by the shared adapter; original native UV/controller parity is separate.
 */
export function nativeMatrices(
  points: readonly (readonly number[])[],
  uv: readonly (readonly number[])[],
  countU: number,
  countV: number,
  orderU: number,
  orderV: number,
  knotsU: readonly number[],
  knotsV: readonly number[],
  rules: readonly NativeSurfaceQuadrature[] = NATIVE_SURFACE_QUADRATURE,
  lambda = 0.0001,
): NativeSurfaceMatrices {
  if (
    !Array.isArray(points) ||
    !Array.isArray(uv) ||
    points.length !== uv.length
  )
    throw new Error(
      "Native surface points and parameters must have matching array lengths.",
    );
  nativeSurfaceWorkingSet(countU, countV, points.length);
  validateBasis(knotsU, orderU, 0, 0);
  validateBasis(knotsV, orderV, 0, 0);
  if (knotsU.length - orderU !== countU || knotsV.length - orderV !== countV)
    throw new Error("Native knot and control dimensions do not match.");
  if (
    knotsU[0] !== 0 ||
    knotsU.at(-1) !== 1 ||
    knotsV[0] !== 0 ||
    knotsV.at(-1) !== 1
  )
    throw new Error(
      "Native approximation requires normalized knot domains [0,1].",
    );
  if (!Number.isFinite(lambda) || lambda < 0)
    throw new Error("Native regularization must be finite and nonnegative.");
  validateRules(rules);
  for (let i = 0; i < points.length; i++) {
    if (
      !Array.isArray(points[i]) ||
      points[i].length !== 3 ||
      !Array.isArray(uv[i]) ||
      uv[i].length !== 2
    )
      throw new Error(
        "Native points require XYZ triples and parameters require UV pairs.",
      );
    finiteArray(points[i], "Native XYZ");
    finiteArray(uv[i], "Native UV");
    if (uv[i].some((value: number) => value < 0 || value > 1))
      throw new Error("Native UV parameters must lie in [0,1].");
  }
  const result = matricesUnchecked(
    points,
    uv,
    countU,
    countV,
    orderU,
    orderV,
    knotsU,
    knotsV,
    rules,
    lambda,
  );
  for (const field of [
    result.gram,
    result.penalty1,
    result.penalty2,
    result.system,
    ...result.rhs,
  ])
    finiteArray(field, "Native surface matrix result");
  for (const coordinate of result.coordinates)
    if (coordinate.accepted)
      finiteArray(coordinate.output, "Native surface controls");
  return result;
}

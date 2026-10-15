import { nativeFiniteFma as fma } from "./scan-native-fma";

// Original CRT mode-3 polynomial path. This private alignment kernel only
// accepts the half-atan2 range used by the Jacobi plane fallback.
const sine = [
  -1 / 6,
  0.00833333333333095,
  -0.00019841269836761127,
  2.7557316103728802e-6,
  -2.5051132068021698e-8,
  1.5918144304485914e-10,
];
const cosine = [
  0.041666666666666664, -0.0013888888888887398, 2.4801587298767044e-5,
  -2.755731727234489e-7, 2.0876146382372144e-9, -1.138263981623609e-11,
];
const bytes = new DataView(new ArrayBuffer(8));
function number(hex: bigint) {
  bytes.setBigUint64(0, hex, true);
  return bytes.getFloat64(0, true);
}
const reductionHigh = number(0x3ff921fb54442d18n);
const reductionMiddle = number(0x3c91a62633145c00n);
const reductionLow = number(0x397b839a252049c0n);
function polynomial(coefficients: number[], z: number, first = 0) {
  let value = coefficients[coefficients.length - 1];
  for (let i = coefficients.length - 2; i >= first; i--)
    value = fma(value, z, coefficients[i]);
  return value;
}
function reduce(x: number) {
  const n = fma(x, 0.6366197723675814, 6755399441055744) - 6755399441055744;
  const initial = fma(-n, reductionHigh, x);
  const product = n * reductionMiddle;
  const productError = fma(n, reductionMiddle, -product);
  const difference = initial - product;
  const residual = initial - difference - product;
  const high = fma(-n, reductionMiddle, initial);
  const tail = fma(
    -n,
    reductionLow,
    difference - high + residual - productError,
  );
  return { n, high, tail };
}
function reducedSine(high: number, tail: number) {
  const z = high * high,
    t = high * z;
  let error = z * (tail * 0.5 - t * polynomial(sine, z, 1));
  error -= tail;
  error = fma(-t, sine[0], error);
  return high - error;
}
function reducedCosine(high: number, tail: number) {
  const z = high * high,
    half = z * 0.5,
    base = 1 - half;
  const residual = fma(-high, tail, 1 - base - half);
  return fma(polynomial(cosine, z), z * z, residual) + base;
}
function check(angle: number) {
  if (!Number.isFinite(angle) || Math.abs(angle) > Math.PI / 2)
    throw new Error(
      "Native alignment trigonometry requires an angle within half pi.",
    );
}
export function nativeGlobalSine(angle: number): number {
  check(angle);
  const magnitude = Math.abs(angle);
  if (magnitude < Math.PI / 4) {
    if (magnitude < 2 ** -27) return angle;
    if (magnitude < 2 ** -13)
      return fma(-(angle * angle * angle), 1 / 6, angle);
    const z = angle * angle;
    return fma(angle * z, polynomial(sine, z), angle);
  }
  const { n, high, tail } = reduce(magnitude);
  let value = n & 1 ? reducedCosine(high, tail) : reducedSine(high, tail);
  if (angle < 0 !== Boolean((n >> 1) & 1)) value = -value;
  return value;
}
export function nativeGlobalCosine(angle: number): number {
  check(angle);
  if (Math.abs(angle) <= Math.PI / 4) {
    if (Math.abs(angle) < 2 ** -27) return 1;
    if (Math.abs(angle) < 2 ** -13) return fma(-angle, angle * 0.5, 1);
    const z = angle * angle;
    return fma(fma(polynomial(cosine, z), z, -0.5), z, 1);
  }
  const { n, high, tail } = reduce(Math.abs(angle));
  const value = n & 1 ? reducedSine(high, tail) : reducedCosine(high, tail);
  return (n + 1) & 2 ? -value : value;
}

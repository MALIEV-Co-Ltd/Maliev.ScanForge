import { nativeAtanHigh, nativeAtanLow } from "./scan-native-atan-table";
import { nativeFiniteFma as fma } from "./scan-native-fma";
const bytes = new DataView(new ArrayBuffer(8));
function bits(x: number) {
  bytes.setFloat64(0, x, true);
  return bytes.getBigUint64(0, true);
}
function number(x: bigint) {
  bytes.setBigUint64(0, x, true);
  return bytes.getFloat64(0, true);
}
function exponent(x: number) {
  return Number((bits(x) >> 52n) & 0x7ffn);
}
function truncate(x: number, mask: bigint) {
  return number(bits(x) & mask);
}
function scaleSmall(x: number) {
  const b = bits(x);
  if (exponent(x)) return number(b + 0x4000000000000000n);
  return number(b | 0x4010000000000000n) + (b >> 63n ? 4 : -4);
}
/** Finite-input original CRT mode-3 atan2 used by the plane Jacobi fallback.
 * Preserve the explicit FMA instructions in the compensated quotient,
 * polynomial and table corrections; decompiled expressions hide them. */
export function nativeGlobalAtan2(y: number, x: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw new Error("Native alignment atan2 requires finite inputs.");
  const negativeY = Boolean(bits(y) >> 63n),
    negativeX = Boolean(bits(x) >> 63n);
  const sign = (value: number) => (negativeY ? -value : value);
  if (y === 0) return negativeX ? sign(Math.PI) : y;
  if (x === 0) return sign(Math.PI / 2);
  let numerator = y,
    denominator = x;
  if (exponent(x) < 0x3fd && exponent(y) < 0x3fd) {
    numerator = scaleSmall(y);
    denominator = scaleSmall(x);
  }
  const difference = exponent(numerator) - exponent(denominator);
  if (difference >= 57) return sign(Math.PI / 2);
  if (difference < -28 && !negativeX) return numerator / denominator;
  if (difference <= -57 && negativeX) return sign(Math.PI);
  numerator = Math.abs(numerator);
  denominator = Math.abs(denominator);
  const swapped = denominator < numerator;
  if (swapped) [numerator, denominator] = [denominator, numerator];
  let ratio = numerator / denominator,
    high = 0,
    low: number;
  if (ratio <= 0.0625) {
    low = ratio;
    if (ratio >= 1e-8) {
      const z = ratio * ratio;
      const hi = truncate(ratio, 0xffffffff00000000n);
      const denHi = truncate(denominator, 0xffffffff00000000n);
      let p = fma(-z, 0.09002981028544979, 0.11110736283514526);
      p = fma(-z, p, 0.1428571356180717);
      p = fma(-z, p, 0.19999999999393223);
      p = fma(-z, p, 0.3333333333333317);
      let residual = fma(-denHi, hi, numerator);
      residual = fma(-hi, denominator - denHi, residual);
      residual = fma(-denominator, ratio - hi, residual);
      low = fma(-(z * ratio), p, residual / denominator) + ratio;
    }
  } else {
    const index = Math.trunc(fma(ratio, 256, 0.5)),
      offset = index - 16;
    high = nativeAtanHigh[offset];
    ratio = index * 0.00390625;
    const power = 1023 - exponent(denominator),
      half = Math.trunc(power / 2);
    const first = 2 ** half,
      second = 2 ** (power - half);
    denominator = first * denominator * second;
    numerator = first * numerator * second;
    const denHi = truncate(denominator, 0xfffffffff8000000n);
    let residual = fma(-denHi, ratio, numerator);
    residual =
      fma(-ratio, denominator - denHi, residual) /
      fma(numerator, ratio, denominator);
    const z = residual * residual;
    const correction = fma(-0.19999918038989142, z, 0.33333333333224097) * z;
    low = fma(-residual, correction, residual + nativeAtanLow[offset]);
  }
  if (swapped) {
    high = Math.PI / 2 - high;
    low = 6.123233995736766e-17 - low;
  }
  if (negativeX) {
    high = 3.1415926218032837 - high;
    low = 3.178650954705639e-8 - low;
  }
  return sign(high + low);
}

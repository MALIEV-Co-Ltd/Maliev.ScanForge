const view = new DataView(new ArrayBuffer(8));
const fraction = (1n << 52n) - 1n;

function integerParts(value: number) {
  view.setFloat64(0, value, true);
  const bits = view.getBigUint64(0, true);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  let significand = bits & fraction;
  if (exponent) significand |= 1n << 52n;
  if (bits >> 63n) significand = -significand;
  return { significand, exponent: exponent ? exponent - 1075 : -1074 };
}

function roundedShift(value: bigint, shift: number): bigint {
  if (shift <= 0) return value << BigInt(-shift);
  const n = BigInt(shift),
    result = value >> n;
  const remainder = value - (result << n),
    halfway = 1n << (n - 1n);
  return (
    result +
    (remainder > halfway || (remainder === halfway && (result & 1n) !== 0n)
      ? 1n
      : 0n)
  );
}

/** Finite-input IEEE round-to-nearest/even a*b+c with one rounding. Used only
 * by the original CRT numerical fallback: JavaScript multiplication/addition
 * cannot stand in for the FMA instructions used in its polynomial kernels.
 */
export function nativeFiniteFma(a: number, b: number, c: number): number {
  if (![a, b, c].every(Number.isFinite))
    throw new Error("Native finite FMA requires finite operands.");
  if (a === 0 || b === 0) return a * b + c;
  if (c === 0) return a * b;
  const x = integerParts(a),
    y = integerParts(b),
    z = integerParts(c);
  const product = x.significand * y.significand,
    productExponent = x.exponent + y.exponent;
  const exponent = Math.min(productExponent, z.exponent);
  let value =
    (product << BigInt(productExponent - exponent)) +
    (z.significand << BigInt(z.exponent - exponent));
  if (value === 0n) return 0;
  const negative = value < 0n;
  if (negative) value = -value;
  const length = value.toString(2).length,
    top = exponent + length - 1;
  const result =
    top < -1022
      ? Number(roundedShift(value, -1074 - exponent)) * Number.MIN_VALUE
      : Number(roundedShift(value, length - 53)) *
        2 ** (exponent + length - 53);
  return negative ? -result : result;
}

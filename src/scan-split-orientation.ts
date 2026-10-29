/** Exact sign of the determinant of three finite binary64 points. */
export function orient2dSign(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): -1 | 0 | 1 {
  const left = (ax - cx) * (by - cy),
    right = (ay - cy) * (bx - cx);
  const value = left - right;
  const bound = 3.3306690738754716e-16 * (Math.abs(left) + Math.abs(right));
  if (value > bound) return 1;
  if (value < -bound) return -1;
  const input = [ax, ay, bx, by, cx, cy];
  if (!input.every(Number.isFinite))
    throw new Error("Finite orientation coordinates required.");
  const view = new DataView(new ArrayBuffer(8));
  const parts = input.map((n) => {
    view.setFloat64(0, n, false);
    const high = view.getUint32(0, false),
      low = view.getUint32(4, false);
    const exponent = (high >>> 20) & 0x7ff;
    let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    if (exponent) mantissa |= 1n << 52n;
    if (high >>> 31) mantissa = -mantissa;
    return { mantissa, exponent: exponent ? exponent - 1075 : -1074 };
  });
  const minExponent = Math.min(
    ...parts.filter((p) => p.mantissa !== 0n).map((p) => p.exponent),
    0,
  );
  const scaled = parts.map(
    (p) => p.mantissa << BigInt(p.exponent - minExponent),
  );
  const [a, b, c, d, e, f] = scaled;
  const exact = (a - e) * (d - f) - (b - f) * (c - e);
  return exact > 0n ? 1 : exact < 0n ? -1 : 0;
}

/** Exact orientation of four finite binary64 points; intended for near-plane cases. */
export function orient3dSign(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  d: readonly number[],
): -1 | 0 | 1 {
  const input = [...a, ...b, ...c, ...d];
  if ([a, b, c, d].some((p) => p.length !== 3) || !input.every(Number.isFinite))
    throw new Error("Finite orientation coordinates required.");
  const view = new DataView(new ArrayBuffer(8));
  const parts = input.map((n) => {
    view.setFloat64(0, n, false);
    const high = view.getUint32(0, false),
      low = view.getUint32(4, false);
    const exponent = (high >>> 20) & 0x7ff;
    let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    if (exponent) mantissa |= 1n << 52n;
    if (high >>> 31) mantissa = -mantissa;
    return { mantissa, exponent: exponent ? exponent - 1075 : -1074 };
  });
  const minExponent = Math.min(
    ...parts.filter((p) => p.mantissa !== 0n).map((p) => p.exponent),
    0,
  );
  const v = parts.map((p) => p.mantissa << BigInt(p.exponent - minExponent));
  const ax = v[0] - v[9],
    ay = v[1] - v[10],
    az = v[2] - v[11];
  const bx = v[3] - v[9],
    by = v[4] - v[10],
    bz = v[5] - v[11];
  const cx = v[6] - v[9],
    cy = v[7] - v[10],
    cz = v[8] - v[11];
  const determinant =
    ax * (by * cz - bz * cy) -
    ay * (bx * cz - bz * cx) +
    az * (bx * cy - by * cx);
  return determinant > 0n ? 1 : determinant < 0n ? -1 : 0;
}

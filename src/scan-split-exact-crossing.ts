import type { Vec3 } from "./types";

export type ExactEdgeWitness = {
  segment: [Vec3, Vec3];
  triangle: [Vec3, Vec3, Vec3];
  edge: 0 | 1 | 2;
};

/** Verify that a cutter segment crosses the named source edge. */
export function exactEdgeWitnessCrossing(
  a: Vec3,
  b: Vec3,
  witness: ExactEdgeWitness,
): {
  exactPoint: [string, string, string];
  roundedPoint: Vec3;
  edgeFraction: number;
  edgeOpposite: number;
} {
  const { triangle, edge, segment } = witness;
  if (![0, 1, 2].includes(edge))
    throw new Error("Exact witness edge is invalid.");
  const equal = (p: Vec3, q: Vec3) => p.every((n, i) => n === q[i]);
  const start = triangle[edge],
    end = triangle[(edge + 1) % 3];
  if (
    !(equal(a, start) && equal(b, end)) &&
    !(equal(a, end) && equal(b, start))
  )
    throw new Error("Exact witness edge does not match the source edge.");
  const crossing = exactSegmentTriangleCrossing(
    segment[0],
    segment[1],
    triangle,
    { exactPoint: true },
  );
  if (
    !crossing?.inside ||
    !crossing.edges.includes(edge) ||
    !crossing.exactPoint ||
    !crossing.roundedPoint
  )
    throw new Error("Exact witness does not cross the source edge.");
  const axis = [0, 1, 2].reduce(
    (best, i) =>
      Math.abs(b[i] - a[i]) > Math.abs(b[best] - a[best]) ? i : best,
    0,
  );
  if (a[axis] === b[axis])
    throw new Error("Exact witness source edge is degenerate.");
  const parse = (fraction: string) =>
    fraction.split("/").map(BigInt) as [bigint, bigint];
  const [pn, pd] = parse(crossing.exactPoint[axis]);
  const [an, ad] = parse(exactVertexPointIdentity(a)[axis]);
  const [bn, bd] = parse(exactVertexPointIdentity(b)[axis]);
  const numerator = (pn * ad - an * pd) * bd;
  const denominator = pd * (bn * ad - an * bd);
  return {
    exactPoint: crossing.exactPoint,
    roundedPoint: crossing.roundedPoint,
    edgeFraction: roundExactRational(numerator, denominator),
    edgeOpposite: roundExactRational(denominator - numerator, denominator),
  };
}

/** Round a rational to binary64 using IEEE nearest, ties to even. */
export function roundExactRational(
  numerator: bigint,
  denominator: bigint,
): number {
  if (denominator === 0n)
    throw new Error("Exact rational denominator must be nonzero.");
  const negative = numerator < 0n !== denominator < 0n;
  let n = numerator < 0n ? -numerator : numerator;
  let d = denominator < 0n ? -denominator : denominator;
  if (n === 0n) return negative ? -0 : 0;
  let exponent = n.toString(2).length - d.toString(2).length;
  if (exponent >= 0 ? n < d << BigInt(exponent) : n << BigInt(-exponent) < d)
    exponent--;
  if (exponent > 1023) return negative ? -Infinity : Infinity;
  if (exponent < -1075) return negative ? -0 : 0;
  const shift = exponent < -1022 ? 1074 : 52 - exponent;
  if (shift >= 0) n <<= BigInt(shift);
  else d <<= BigInt(-shift);
  let quotient = n / d;
  const remainder = n % d;
  if (remainder * 2n > d || (remainder * 2n === d && (quotient & 1n) === 1n))
    quotient++;
  const value =
    Number(quotient) * 2 ** (exponent < -1022 ? -1074 : exponent - 52);
  return negative ? -value : value;
}

/** Canonical exact binary64 coordinates for matching a source vertex. */
export function exactVertexPointIdentity(
  point: Vec3,
): [string, string, string] {
  if (!point.every(Number.isFinite))
    throw new Error("Finite point coordinates required.");
  const view = new DataView(new ArrayBuffer(8));
  return point.map((value) => {
    view.setFloat64(0, value, false);
    const hi = view.getUint32(0, false),
      lo = view.getUint32(4, false),
      exponent = (hi >>> 20) & 0x7ff;
    let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    if (exponent) mantissa |= 1n << 52n;
    if (mantissa === 0n) return "0/1";
    let power = exponent ? exponent - 1075 : -1074;
    while (power < 0 && (mantissa & 1n) === 0n) {
      mantissa >>= 1n;
      power++;
    }
    if (hi >>> 31) mantissa = -mantissa;
    return power >= 0
      ? `${mantissa << BigInt(power)}/1`
      : `${mantissa}/${1n << BigInt(-power)}`;
  }) as [string, string, string];
}

/** Classify a unique segment/triangle-plane crossing before rounding its point. */
export function exactSegmentTriangleCrossing(
  a: Vec3,
  b: Vec3,
  triangle: [Vec3, Vec3, Vec3],
  options: { exactPoint?: boolean } = {},
):
  | {
      inside: boolean;
      edges: number[];
      fraction: number;
      opposite: number;
      exactPoint?: [string, string, string];
      roundedPoint?: Vec3;
    }
  | undefined {
  const input = [...a, ...b, ...triangle.flat()];
  if (!input.every(Number.isFinite))
    throw new Error("Finite crossing coordinates required.");
  const view = new DataView(new ArrayBuffer(8));
  const parts = input.map((n) => {
    view.setFloat64(0, n, false);
    const hi = view.getUint32(0, false),
      lo = view.getUint32(4, false),
      exponent = (hi >>> 20) & 0x7ff;
    let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    if (exponent) mantissa |= 1n << 52n;
    if (hi >>> 31) mantissa = -mantissa;
    return { mantissa, exponent: exponent ? exponent - 1075 : -1074 };
  });
  const min = Math.min(
    ...parts.filter((p) => p.mantissa !== 0n).map((p) => p.exponent),
    0,
  );
  const v = parts.map((p) => p.mantissa << BigInt(p.exponent - min));
  const point = (i: number) => v.slice(i * 3, i * 3 + 3);
  const sub = (p: bigint[], q: bigint[]) => p.map((x, i) => x - q[i]);
  const cross = (p: bigint[], q: bigint[]) => [
    p[1] * q[2] - p[2] * q[1],
    p[2] * q[0] - p[0] * q[2],
    p[0] * q[1] - p[1] * q[0],
  ];
  const dot = (p: bigint[], q: bigint[]) =>
    p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const [aa, bb, x, y, z] = [0, 1, 2, 3, 4].map(point);
  const normal = cross(sub(y, x), sub(z, x));
  const da = dot(normal, sub(aa, x)),
    db = dot(normal, sub(bb, x));
  const denominator = da - db;
  if (denominator === 0n || (da > 0n && db > 0n) || (da < 0n && db < 0n))
    return undefined;
  const abs = (n: bigint) => (n < 0n ? -n : n);
  const ratio = (numerator: bigint, divisor: bigint) => {
    numerator = abs(numerator);
    divisor = abs(divisor);
    if (numerator === 0n) return 0;
    const shift =
      Math.max(0, divisor.toString(2).length - numerator.toString(2).length) +
      55;
    const quotient = (numerator << BigInt(shift)) / divisor;
    return (
      Number(quotient) *
      2 ** -Math.min(shift, 1022) *
      2 ** -Math.max(0, shift - 1022)
    );
  };
  const fraction = ratio(da, denominator),
    opposite = ratio(db, denominator);
  let drop = 0;
  if (abs(normal[1]) > abs(normal[drop])) drop = 1;
  if (abs(normal[2]) > abs(normal[drop])) drop = 2;
  if (normal[drop] === 0n) throw new Error("Finite triangle is degenerate.");
  const axes = [0, 1, 2].filter((i) => i !== drop);
  const orient = (p: bigint[], q: bigint[], r: bigint[]) =>
    (q[axes[0]] - p[axes[0]]) * (r[axes[1]] - p[axes[1]]) -
    (q[axes[1]] - p[axes[1]]) * (r[axes[0]] - p[axes[0]]);
  const face = [x, y, z],
    sign = orient(x, y, z) > 0n ? 1n : -1n,
    denomSign = denominator > 0n ? 1n : -1n;
  const edges: number[] = [];
  for (let edge = 0; edge < 3; edge++) {
    const oa = orient(face[edge], face[(edge + 1) % 3], aa),
      ob = orient(face[edge], face[(edge + 1) % 3], bb);
    const side = (oa * -db + ob * da) * sign * denomSign;
    if (side < 0n) return { inside: false, edges: [], fraction, opposite };
    if (side === 0n) edges.push(edge);
  }
  let exactPoint: [string, string, string] | undefined;
  let roundedPoint: Vec3 | undefined;
  if (options.exactPoint) {
    const gcd = (a: bigint, b: bigint): bigint => {
      a = abs(a);
      b = abs(b);
      while (b !== 0n) [a, b] = [b, a % b];
      return a;
    };
    const rounded: number[] = [];
    exactPoint = aa.map((coordinate, i) => {
      let numerator = coordinate * denominator + (bb[i] - coordinate) * da;
      let divisor = denominator;
      if (min < 0) divisor <<= BigInt(-min);
      else numerator <<= BigInt(min);
      if (divisor < 0n) {
        numerator = -numerator;
        divisor = -divisor;
      }
      rounded.push(roundExactRational(numerator, divisor));
      const common = gcd(numerator, divisor);
      return `${numerator / common}/${divisor / common}`;
    }) as [string, string, string];
    roundedPoint = rounded as Vec3;
  }
  return {
    inside: true,
    edges,
    fraction,
    opposite,
    ...(exactPoint ? { exactPoint, roundedPoint } : {}),
  };
}

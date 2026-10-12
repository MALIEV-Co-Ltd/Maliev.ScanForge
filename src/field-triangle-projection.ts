const f = Math.fround;
const MAX = f(3.4028234663852886e38);
type V = Float32Array;
const subtract = (a: V, b: V): V =>
  new Float32Array(a.map((v, i) => f(v - b[i])));
const dot = (a: V, b: V, yFirst = true): number => {
  const x = f(a[0] * b[0]);
  const y = f(a[1] * b[1]);
  return f(f(yFirst ? y + x : x + y) + f(a[2] * b[2]));
};
const length = (v: V, yFirst = true): number => f(Math.sqrt(dot(v, v, yFirst)));
function unit(v: V, yFirst: boolean, threshold = 0): V {
  const size = length(v, yFirst);
  if (size === 0 || size < threshold) return new Float32Array(3);
  const inverse = f(1 / size);
  return new Float32Array(v.map((value) => f(value * inverse)));
}

function planeProjection(point: V, normal: V, offset: number): V {
  const direction = unit(normal, false, f(1e-14));
  const denominator = dot(normal, direction, false);
  const projected = new Float32Array(3);
  if (Math.abs(denominator) >= f(1e-5)) {
    const parameter = -f(f(dot(normal, point) + offset) / denominator);
    for (let i = 0; i < 3; i++)
      projected[i] = f(f(direction[i] * parameter) + point[i]);
  }
  return projected;
}

function segmentProjection(
  point: V,
  a: V,
  b: V,
): { point: V; distance: number } {
  const edge = subtract(b, a);
  if (!(dot(subtract(point, a), edge) > 0))
    return { point: a.slice(), distance: length(subtract(point, a)) };
  if (!(-dot(edge, subtract(point, b)) > 0))
    return { point: b.slice(), distance: length(subtract(point, b)) };
  const direction = unit(edge, true, f(1e-14));
  const delta = subtract(point, a);
  const parameter = dot(delta, direction);
  const remainder = new Float32Array(
    delta.map((v, i) => f(v - f(direction[i] * parameter))),
  );
  // Original helper subtracts the remainder from the query, rather than adding to a.
  return { point: subtract(point, remainder), distance: length(remainder) };
}

/** Mutates only output; a degenerate triangle leaves output unchanged and returns MAX. */
export function projectGuideTriangle(
  point: V,
  a: V,
  b: V,
  c: V,
  normal: V,
  output: V,
): number {
  if (
    [point, a, b, c, normal, output].some(
      (v) => v.length !== 3 || !v.every(Number.isFinite),
    )
  )
    throw new Error("Triangle projection requires finite float triples");
  if ([point, a, b, c, normal].some((v) => v.buffer === output.buffer))
    throw new Error("Projection output must use independent storage");
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const determinant = f(
    f(f(f(ac[1] * normal[2]) - f(ac[2] * normal[1])) * ab[0]) -
      f(f(f(ac[0] * normal[2]) - f(ac[2] * normal[0])) * ab[1]),
  );
  const orientedArea = f(
    determinant + f(f(f(ac[0] * normal[1]) - f(ac[1] * normal[0])) * ab[2]),
  );
  if (orientedArea === 0) return MAX;
  const n = unit(normal, false);
  const projected = planeProjection(point, n, -dot(n, a));
  const ap = subtract(projected, a);
  const abSquared = dot(ab, ab);
  const mixed = dot(ac, ab);
  const abPoint = dot(ap, ab);
  const acPoint = dot(ap, ac);
  const acSquared = dot(ac, ac);
  const inverse = f(1 / f(f(acSquared * abSquared) - f(mixed * mixed)));
  const u = f(f(f(acSquared * abPoint) - f(acPoint * mixed)) * inverse);
  const v = f(f(f(acPoint * abSquared) - f(abPoint * mixed)) * inverse);
  if (u < 0 || v < 0 || f(u + v) > 1) {
    const first = segmentProjection(point, a, b);
    const second = segmentProjection(point, b, c);
    const third = segmentProjection(point, c, a);
    const candidate = first.distance < second.distance ? first : second;
    // Third edge wins an equal-distance tie; second wins the first/second tie.
    output.set(
      candidate.distance < third.distance ? candidate.point : third.point,
    );
    return length(subtract(output, point));
  }
  output.set(projected);
  return length(subtract(output, point), false);
}

type Point = [number, number, number];
type ExactPoint = [bigint, bigint, bigint];
const FLOAT32_INTEGER_SCALE = 2 ** 149;
const equal = (a: Point, b: Point) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const sign = (value: number | bigint): number =>
  value > 0 ? 1 : value < 0 ? -1 : 0;

/** Exact area-zero test for one represented Float32 facet. A certified nonzero
 * projected determinant exits without allocating exact-coordinate storage. */
export function isDegenerateFloat32Triangle(
  positions: Float32Array,
  face: number,
): boolean {
  if (
    positions.length % 9 ||
    !Number.isInteger(face) ||
    face < 0 ||
    face >= positions.length / 9
  )
    throw Error("Expected complete Float32 triangles and a valid face index.");
  const i = face * 9;
  for (let k = 0; k < 9; k++)
    if (!Number.isFinite(positions[i + k]))
      throw Error("Triangle coordinates must be finite.");
  for (const [x, y] of [
    [0, 1],
    [1, 2],
    [2, 0],
  ]) {
    const left =
      (positions[i + x] - positions[i + 6 + x]) *
      (positions[i + 3 + y] - positions[i + 6 + y]);
    const right =
      (positions[i + y] - positions[i + 6 + y]) *
      (positions[i + 3 + x] - positions[i + 6 + x]);
    if (
      Math.abs(left - right) >
      8 * Number.EPSILON * (Math.abs(left) + Math.abs(right))
    )
      return false;
  }
  const p = Array.from(positions.subarray(i, i + 9), (value) =>
    BigInt(value * FLOAT32_INTEGER_SCALE),
  );
  for (const [x, y] of [
    [0, 1],
    [1, 2],
    [2, 0],
  ])
    if (
      (p[x] - p[6 + x]) * (p[3 + y] - p[6 + y]) !==
      (p[y] - p[6 + y]) * (p[3 + x] - p[6 + x])
    )
      return false;
  return true;
}

/** Exact classification of the represented Float32 facets, with no geometric
 * tolerance. A shared vertex/edge is permitted only when it is the entire
 * intersection. Callers must separately validate welded vertex fans: two
 * disconnected shells touching at an identical corner are not a valid fan.
 * Scratch storage and exact-coordinate memoization are bounded to this pair. */
export function trianglesIntersectBeyondSharedTopology(
  positions: Float32Array,
  faceA: number,
  faceB: number,
): boolean {
  if (
    positions.length % 9 ||
    ![faceA, faceB].every(
      (face) =>
        Number.isInteger(face) && face >= 0 && face < positions.length / 9,
    )
  )
    throw Error("Expected complete Float32 triangles and valid face indices.");
  const read = (face: number): Point[] =>
    Array.from({ length: 3 }, (_, corner) => {
      const i = face * 9 + corner * 3;
      const p: Point = [positions[i], positions[i + 1], positions[i + 2]];
      if (!p.every(Number.isFinite))
        throw Error("Triangle coordinates must be finite.");
      return p;
    });
  const a = read(faceA),
    b = read(faceB);
  let exact: Map<Point, ExactPoint> | undefined;
  const integer = (p: Point): ExactPoint => {
    let value = exact?.get(p);
    if (!value) {
      // Every finite Float32 multiplied by 2^149 is an exactly represented
      // integer in Float64, including subnormals. BigInt preserves that integer.
      value = p.map((x) => BigInt(x * FLOAT32_INTEGER_SCALE)) as ExactPoint;
      (exact ??= new Map()).set(p, value);
    }
    return value;
  };
  const orient2 = (p: Point, q: Point, r: Point, axes: [number, number]) => {
    const [x, y] = axes;
    if (
      (p[x] === r[x] && p[y] === r[y]) ||
      (q[x] === r[x] && q[y] === r[y]) ||
      (p[x] === q[x] && p[y] === q[y])
    )
      return 0;
    const left = (p[x] - r[x]) * (q[y] - r[y]);
    const right = (p[y] - r[y]) * (q[x] - r[x]);
    const value = left - right;
    // Conservative forward-error filter; zero/uncertain signs go to dyadics.
    if (
      Math.abs(value) >
      8 * Number.EPSILON * (Math.abs(left) + Math.abs(right))
    )
      return sign(value);
    const u = integer(p),
      v = integer(q),
      w = integer(r);
    return sign((u[x] - w[x]) * (v[y] - w[y]) - (u[y] - w[y]) * (v[x] - w[x]));
  };
  const orient3 = (p: Point, q: Point, r: Point, s: Point) => {
    if (
      equal(p, s) ||
      equal(q, s) ||
      equal(r, s) ||
      equal(p, q) ||
      equal(p, r) ||
      equal(q, r)
    )
      return 0;
    const u = p.map((x, k) => x - s[k]);
    const v = q.map((x, k) => x - s[k]);
    const w = r.map((x, k) => x - s[k]);
    const value =
      u[0] * (v[1] * w[2] - v[2] * w[1]) +
      u[1] * (v[2] * w[0] - v[0] * w[2]) +
      u[2] * (v[0] * w[1] - v[1] * w[0]);
    const permanent =
      Math.abs(u[0]) * (Math.abs(v[1] * w[2]) + Math.abs(v[2] * w[1])) +
      Math.abs(u[1]) * (Math.abs(v[2] * w[0]) + Math.abs(v[0] * w[2])) +
      Math.abs(u[2]) * (Math.abs(v[0] * w[1]) + Math.abs(v[1] * w[0]));
    if (Math.abs(value) > 32 * Number.EPSILON * permanent) return sign(value);
    const pi = integer(p),
      qi = integer(q),
      ri = integer(r),
      si = integer(s);
    const x = pi.map((n, k) => n - si[k]);
    const y = qi.map((n, k) => n - si[k]);
    const z = ri.map((n, k) => n - si[k]);
    return sign(
      x[0] * (y[1] * z[2] - y[2] * z[1]) +
        x[1] * (y[2] * z[0] - y[0] * z[2]) +
        x[2] * (y[0] * z[1] - y[1] * z[0]),
    );
  };
  const projection = (triangle: Point[]): [number, number] => {
    for (const axes of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as [number, number][])
      if (orient2(triangle[0], triangle[1], triangle[2], axes)) return axes;
    throw Error(
      "Self-intersection predicates require nondegenerate triangles.",
    );
  };
  const shared = a.filter((p) => b.some((q) => equal(p, q)));
  const permitted = (p: Point) => shared.some((q) => equal(p, q));
  if (shared.length === 2) {
    const u = shared[0],
      v = shared[1];
    const thirdA = a.find((p) => !permitted(p));
    const thirdB = b.find((p) => !permitted(p));
    if (!thirdA || !thirdB)
      throw Error(
        "Self-intersection predicates require nondegenerate triangles.",
      );
    // A nonzero volume proves both facets nondegenerate and their intersection
    // confined to the common edge. Avoid projections/exact shared-corner zeros.
    if (orient3(a[0], a[1], a[2], thirdB)) return false;
    const axes = projection(a);
    const sideA = orient2(u, v, thirdA, axes),
      sideB = orient2(u, v, thirdB, axes);
    if (!sideB)
      throw Error(
        "Self-intersection predicates require nondegenerate triangles.",
      );
    return sideA === sideB;
  }
  const axesA = projection(a),
    axesB = projection(b);
  if (shared.length === 3) return true;
  const sidesB = b.map((p) => orient3(a[0], a[1], a[2], p));
  const coplanar = sidesB.every((s) => s === 0);
  const onSegment = (p: Point, q: Point, r: Point, axes: [number, number]) =>
    orient2(p, q, r, axes) === 0 &&
    axes.every(
      (k) => r[k] >= Math.min(p[k], q[k]) && r[k] <= Math.max(p[k], q[k]),
    );
  const inside = (p: Point, triangle: Point[], axes: [number, number]) => {
    const sides = triangle.map((q, k) =>
      orient2(q, triangle[(k + 1) % 3], p, axes),
    );
    return sides.every((s) => s >= 0) || sides.every((s) => s <= 0);
  };
  const segmentsBeyondShared = (
    p: Point,
    q: Point,
    r: Point,
    s: Point,
    axes: [number, number],
  ) => {
    const pqR = orient2(p, q, r, axes),
      pqS = orient2(p, q, s, axes);
    const rsP = orient2(r, s, p, axes),
      rsQ = orient2(r, s, q, axes);
    if (pqR * pqS < 0 && rsP * rsQ < 0) return true;
    return (
      (!pqR && onSegment(p, q, r, axes) && !permitted(r)) ||
      (!pqS && onSegment(p, q, s, axes) && !permitted(s)) ||
      (!rsP && onSegment(r, s, p, axes) && !permitted(p)) ||
      (!rsQ && onSegment(r, s, q, axes) && !permitted(q))
    );
  };
  const coplanarSegment = (
    p: Point,
    q: Point,
    triangle: Point[],
    axes: [number, number],
  ) =>
    (!permitted(p) && inside(p, triangle, axes)) ||
    (!permitted(q) && inside(q, triangle, axes)) ||
    triangle.some((r, k) =>
      segmentsBeyondShared(p, q, r, triangle[(k + 1) % 3], axes),
    );
  if (coplanar) {
    if (
      a.some((p) => !permitted(p) && inside(p, b, axesA)) ||
      b.some((p) => !permitted(p) && inside(p, a, axesA))
    )
      return true;
    return a.some((p, k) => coplanarSegment(p, a[(k + 1) % 3], b, axesA));
  }
  const segmentTriangle = (
    p: Point,
    q: Point,
    triangle: Point[],
    axes: [number, number],
  ) => {
    const first = orient3(triangle[0], triangle[1], triangle[2], p);
    const second = orient3(triangle[0], triangle[1], triangle[2], q);
    if (first * second > 0) return false;
    if (!first && !second) return coplanarSegment(p, q, triangle, axes);
    if (!first) return !permitted(p) && inside(p, triangle, axes);
    if (!second) return !permitted(q) && inside(q, triangle, axes);
    const sides = triangle.map((r, k) =>
      orient3(p, q, r, triangle[(k + 1) % 3]),
    );
    return sides.every((s) => s >= 0) || sides.every((s) => s <= 0);
  };
  return (
    a.some((p, k) => segmentTriangle(p, a[(k + 1) % 3], b, axesB)) ||
    b.some((p, k) => segmentTriangle(p, b[(k + 1) % 3], a, axesA))
  );
}

type Vector = [number, number, number];
const f = Math.fround;
const mul = (a: number, b: number) => f(a * b);
const add = (a: number, b: number) => f(a + b);
const sub = (a: number, b: number) => f(a - b);
const dot = (a: Vector, b: Vector) =>
  add(add(mul(a[0], b[0]), mul(a[1], b[1])), mul(a[2], b[2]));
const cross = (a: Vector, b: Vector): Vector => [
  sub(mul(a[1], b[2]), mul(a[2], b[1])),
  sub(mul(a[2], b[0]), mul(a[0], b[2])),
  sub(mul(a[0], b[1]), mul(a[1], b[0])),
];
const length = (v: Vector) => f(Math.sqrt(dot(v, v)));
const normalized = (v: Vector): Vector => {
  const magnitude = length(v);
  return magnitude < 1e-24
    ? v
    : (v.map((value) => f(value / magnitude)) as Vector);
};
const at = (values: Float32Array, face: number): Vector => [
  values[face * 3],
  values[face * 3 + 1],
  values[face * 3 + 2],
];
const signedAngle = (a: Vector, b: Vector, normal: Vector) => {
  const divisor = length(a) * length(b);
  const cosine = divisor === 0 ? 1 : dot(a, b) / divisor;
  const angle = cosine <= -1 ? Math.PI : cosine < 1 ? Math.acos(cosine) : 0;
  return dot(normal, cross(a, b)) > 0 || angle === 0
    ? angle
    : 2 * Math.PI - angle;
};
const wrapped = (angle: number) => {
  const value = f(angle);
  return value > f(Math.PI) ? add(value, -f(2 * Math.PI)) : value;
};

// Recovered bounded SIMD sine polynomial, scalarized with default nearest-even rounding.
function sineLane(angle: number): number {
  const scaled = mul(angle, f(0.31830987));
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const turns =
    fraction === 0.5
      ? lower % 2 === 0
        ? lower
        : lower + 1
      : Math.round(scaled);
  let reduced = sub(angle, mul(f(3.140625), turns));
  reduced = sub(reduced, mul(f(0.0009675026), turns));
  reduced = sub(reduced, mul(f(1.5099067e-7), turns));
  const fine = sub(reduced, mul(f(5.126688e-12), turns));
  const square = mul(reduced, reduced);
  let polynomial = f(2.608e-6);
  for (const coefficient of [-0.000198107, 0.008333075, -0.16666658])
    polynomial = add(mul(polynomial, square), f(coefficient));
  const value = add(mul(mul(polynomial, square), fine), fine);
  return turns % 2 ? -value : value;
}

function rotate(v: Vector, axis: Vector, angle: number): Vector {
  const magnitude = length(axis);
  if (magnitude < f(1e-7)) return v;
  const half = mul(angle, 0.5);
  const absolute = Math.abs(half);
  const sine = absolute < 0.0001220703125 ? half : sineLane(half);
  const cosine =
    absolute < 0.0001220703125
      ? sub(1, mul(mul(absolute, absolute), 0.5))
      : sineLane(add(absolute, f(Math.PI / 2)));
  const scale = f(sine / magnitude);
  const q = axis.map((value) => mul(value, scale)) as Vector;
  const twiceSquare = add(mul(cosine, cosine), mul(cosine, cosine));
  const diagonal = (index: number) =>
    sub(
      add(add(mul(q[index], q[index]), mul(q[index], q[index])), twiceSquare),
      1,
    );
  const pair = (a: number, b: number, c: number, sign: number) => {
    const product = mul(q[a], q[b]);
    const rotation = mul(cosine, q[c]);
    return sign > 0
      ? add(add(add(product, product), rotation), rotation)
      : add(sub(product, rotation), sub(product, rotation));
  };
  const rows: Vector[] = [
    [diagonal(0), pair(0, 1, 2, -1), pair(0, 2, 1, 1)],
    [pair(0, 1, 2, 1), diagonal(1), pair(1, 2, 0, -1)],
    [pair(0, 2, 1, -1), pair(1, 2, 0, 1), diagonal(2)],
  ];
  return rows.map((row) =>
    add(add(mul(row[1], v[1]), mul(row[0], v[0])), mul(row[2], v[2])),
  ) as Vector;
}

function validateFrames(normals: Float32Array, tangents: Float32Array) {
  if (normals.length % 3 || normals.length !== tangents.length)
    throw new Error("Field angle frame dimensions are inconsistent.");
  for (const values of [normals, tangents])
    for (const value of values)
      if (!Number.isFinite(value))
        throw new Error("Field angle frames must be finite.");
}

/** Project upstream directions into each face and derive the native double-stored reference angle. */
export function deriveFieldReferenceAngles(
  normals: Float32Array,
  tangents: Float32Array,
  directions: Float32Array,
): Float64Array {
  validateFrames(normals, tangents);
  validateFrames(normals, directions);
  const angles = new Float64Array(normals.length / 3);
  for (let face = 0; face < angles.length; face++) {
    const normal = at(normals, face);
    const direction = at(directions, face);
    const projection = dot(direction, normal);
    const planar = direction.map((value, axis) =>
      sub(value, mul(normal[axis], projection)),
    ) as Vector;
    if (planar.some((value) => !Number.isFinite(value)))
      throw new Error("Field direction projection arithmetic overflowed.");
    const angle = f(signedAngle(at(tangents, face), planar, normal));
    // The native reference array stores doubles: wrapping follows float promotion.
    angles[face] = angle > f(Math.PI) ? angle - f(2 * Math.PI) : angle;
  }
  return angles;
}

/** Recovered edge transport policy over upstream indexed halfedge incidence. */
export function deriveFieldTransportAngles(
  normals: Float32Array,
  tangents: Float32Array,
  edgeOffsets: Uint32Array,
  halfedges: Uint32Array,
): Float32Array {
  validateFrames(normals, tangents);
  if (
    !edgeOffsets.length ||
    edgeOffsets[0] !== 0 ||
    edgeOffsets.at(-1) !== halfedges.length
  )
    throw new Error("Field edge incidence dimensions are inconsistent.");
  for (let edge = 1; edge < edgeOffsets.length; edge++)
    if (edgeOffsets[edge] < edgeOffsets[edge - 1])
      throw new Error("Field edge incidence offsets must be ascending.");
  for (const halfedge of halfedges)
    if (halfedge >= normals.length)
      throw new Error("Field edge incidence references an invalid halfedge.");
  const angles = new Float32Array(edgeOffsets.length - 1);
  for (let edge = 0; edge < angles.length; edge++) {
    const start = edgeOffsets[edge];
    if (edgeOffsets[edge + 1] - start !== 2) continue;
    const left = Math.floor(halfedges[start] / 3);
    const right = Math.floor(halfedges[start + 1] / 3);
    const a = at(normals, left);
    const b = at(normals, right);
    let transported = at(tangents, right);
    let axis = cross(b, a);
    if (dot(axis, axis) >= f(1e-7)) {
      axis = normalized(axis);
      transported = rotate(transported, axis, f(signedAngle(b, a, axis)));
    } else if (dot(a, b) < 0) {
      const absolute = b.map(Math.abs);
      const coordinate: Vector =
        absolute[0] <= absolute[1]
          ? absolute[2] < absolute[0]
            ? [0, 0, 1]
            : [1, 0, 0]
          : absolute[1] <= absolute[2]
            ? [0, 1, 0]
            : [0, 0, 1];
      axis = cross(coordinate, b);
      transported = rotate(transported, axis, f(Math.PI));
    }
    angles[edge] = wrapped(signedAngle(at(tangents, left), transported, a));
    if (!Number.isFinite(angles[edge]))
      throw new Error("Field angle transport arithmetic overflowed.");
  }
  return angles;
}

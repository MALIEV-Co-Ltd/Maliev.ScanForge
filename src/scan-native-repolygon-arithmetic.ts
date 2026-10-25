import type {
  ReconstructionVector as Vector,
  ReconstructionSample,
} from "./scan-native-repolygon-types";
export function reconstructionGridFrame(
  bounds: ArrayLike<number>,
  spacing: number,
) {
  if (!(spacing > 2 ** -23) || !Number.isFinite(spacing))
    throw new RangeError(
      "Point resolution must be finite and greater than Float32 epsilon.",
    );
  const f = Math.fround,
    inverseSpacing = 1 / spacing;
  const extent = Math.max(
    f(bounds[3] - bounds[0]),
    f(bounds[4] - bounds[1]),
    f(bounds[5] - bounds[2]),
  );
  let halfWidth = spacing + spacing,
    depth = 2;
  const required = extent * 0.5 + halfWidth;
  while (halfWidth < required) {
    halfWidth += halfWidth;
    depth++;
    if (!Number.isFinite(halfWidth) || depth > 30)
      throw Error("Reconstruction grid exceeds supported depth.");
  }
  const half = f(halfWidth),
    result = new Float32Array(6);
  for (let axis = 0; axis < 3; axis++) {
    const midpoint = f(f(bounds[axis + 3] + bounds[axis]) * 0.5);
    const center = f(Math.floor(midpoint * inverseSpacing) * spacing + spacing);
    result[axis] = f(center - half);
    result[axis + 3] = f(half + center);
  }
  if (!result.every(Number.isFinite))
    throw Error("Reconstruction bounds exceed coordinate precision.");
  return { spacing, inverseSpacing, depth, bounds: result };
}

export function reconstructionChildBounds(
  bounds: ArrayLike<number>,
  index: number,
) {
  const result = new Float64Array(6);
  for (let axis = 0; axis < 3; axis++) {
    const quarter = (bounds[axis + 3] - bounds[axis]) * 0.5 * 0.5;
    let center = (bounds[axis] + bounds[axis + 3]) * 0.5;
    center = index & (1 << axis) ? center - quarter : center + quarter;
    result[axis] = center - quarter;
    result[axis + 3] = quarter + center;
  }
  return result;
}
export function reconstructionChildIndex(
  point: ArrayLike<number>,
  center: ArrayLike<number>,
) {
  return (
    Number(point[0] <= center[0]) |
    (Number(point[1] <= center[1]) << 1) |
    (Number(point[2] <= center[2]) << 2)
  );
}
function quantizeOutput(value: number) {
  const scaled = Math.fround(value) * 10000;
  // Mirror x86-64 CVTTSD2SI's indefinite integer, including finite overflow.
  if (!Number.isFinite(scaled) || scaled < -(2 ** 63) || scaled >= 2 ** 63)
    return -(1n << 63n);
  return BigInt(Math.trunc(scaled));
}
export function reconstructionVertexKey(point: ArrayLike<number>) {
  return `${quantizeOutput(point[0])},${quantizeOutput(point[1])},${quantizeOutput(point[2])}`;
}

export function reconstructionCornerKey(
  point: number[],
  spacing: number,
  origin: number[],
) {
  const offset = spacing * 0.01,
    inverse = 1 / spacing;
  return point
    .map((value, axis) => {
      const key = Math.floor((offset + value - origin[axis]) * inverse);
      return !Number.isFinite(key) || key < -(2 ** 31) || key >= 2 ** 31
        ? -(2 ** 31)
        : Math.trunc(key);
    })
    .join(",");
}

export function reconstructionSegmentSample(
  point: Vector,
  a: Vector,
  b: Vector,
) {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2];
  const lengthSquared = uy * uy + ux * ux + uz * uz;
  let qx = point[0] - a[0],
    qy = point[1] - a[1],
    qz = point[2] - a[2];
  const parameter =
    lengthSquared <= 9.999999974752427e-7
      ? 0
      : (uy * qy + ux * qx + uz * qz) / lengthSquared;
  const closest = new Float32Array(3);
  let squared;
  if (parameter > 1) {
    closest.set(b);
    const x = point[0] - b[0],
      y = point[1] - b[1],
      z = point[2] - b[2];
    squared = x * x + y * y + z * z;
  } else {
    if (parameter > 0) {
      closest[0] = ux * parameter + a[0];
      closest[1] = uy * parameter + a[1];
      closest[2] = uz * parameter + a[2];
      qx -= ux * parameter;
      qy -= uy * parameter;
      qz -= uz * parameter;
    } else closest.set(a);
    squared = qy * qy + qx * qx + qz * qz;
  }
  return { parameter, closest, distance: Math.sqrt(squared) };
}

const f = Math.fround,
  MAX = 3.4028234663852886e38;
export function reconstructionProjectedSide(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  if (f(bx) === f(ax)) return ay < by ? px <= ax : ax <= px;
  if (f(px) !== f(ax))
    return f((px - ax) * (by - ay)) <= f((py - ay) * (bx - ax));
  return ax < bx ? ay <= py : py <= ay;
}
function projectedMask(p: Vector, n: Vector, triangle: Vector[]) {
  const magnitudes = [...n].map(Math.abs);
  const axis =
    magnitudes[0] >= Math.max(magnitudes[1], magnitudes[2])
      ? 0
      : magnitudes[1] < magnitudes[2]
        ? 2
        : 1;
  const u = (axis + 1) % 3,
    v = (axis + 2) % 3;
  let mask = 0;
  for (let edge = 0; edge < 3; edge++) {
    let a = triangle[edge],
      b = triangle[(edge + 1) % 3];
    if (n[axis] < 0) [a, b] = [b, a];
    if (reconstructionProjectedSide(p[u], p[v], a[u], a[v], b[u], b[v]))
      mask |= 1 << edge;
  }
  return mask;
}
function normalizeFloat(direction: Float32Array) {
  const squared = f(
    f(f(direction[0] * direction[0]) + f(direction[1] * direction[1])) +
      f(direction[2] * direction[2]),
  );
  const length = f(Math.sqrt(squared));
  if (length >= 2 ** -52) {
    const reciprocal = 1 / length;
    for (let axis = 0; axis < 3; axis++)
      direction[axis] = direction[axis] * reciprocal;
  }
}
export function reconstructionTriangleSample(
  point: Vector,
  normal: Vector,
  triangle: Vector[],
  maxDistance = MAX,
) {
  const a = triangle[0];
  const planeDistance =
    (point[1] - a[1]) * normal[1] +
    (point[0] - a[0]) * normal[0] +
    (point[2] - a[2]) * normal[2];
  const direction = new Float32Array(normal);
  if (!(Math.abs(planeDistance) < maxDistance))
    return { distance: MAX, direction, flags: 7 };
  const projected = Array.from(
    { length: 3 },
    (_, axis) => point[axis] - normal[axis] * planeDistance,
  );
  const mask = projectedMask(projected, normal, triangle);
  if (mask === 7) return { distance: planeDistance, direction, flags: 7 };
  let distance = MAX,
    closest = new Float32Array(3),
    flags = 0;
  for (let edge = 0; edge < 3; edge++) {
    if (mask & (1 << edge)) continue;
    flags |= 8 << edge;
    const candidate = reconstructionSegmentSample(
      point,
      triangle[edge],
      triangle[(edge + 1) % 3],
    );
    if (candidate.distance < distance) {
      distance = candidate.distance;
      closest = candidate.closest;
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    direction[axis] =
      planeDistance < 0
        ? f(closest[axis] - point[axis])
        : f(point[axis] - closest[axis]);
  }
  normalizeFloat(direction);
  return {
    distance: planeDistance < 0 ? -distance : distance,
    direction,
    flags,
  };
}

// Initial direction is explicit because the native global initializer is unresolved.
export function reconstructionCornerReduction(
  samples: ReconstructionSample[],
  initialDirection: number[],
) {
  if (!samples.length) throw Error("Reconstruction requires source samples.");
  const interior = {
    sum: 0,
    count: 0,
    direction: new Float64Array(initialDirection),
  };
  const boundary = {
    sum: 0,
    count: 0,
    direction: new Float64Array(initialDirection),
  };
  for (const sample of samples) {
    if (sample.distance === 3.4028234663852886e38) continue;
    const group = sample.boundary ? boundary : interior;
    group.sum += sample.distance;
    group.count++;
    for (let axis = 0; axis < 3; axis++)
      group.direction[axis] += sample.direction[axis];
  }
  const chosen = interior.count ? interior : boundary,
    direction = chosen.direction;
  let distance = chosen.sum;
  if (chosen.count) {
    const length = Math.sqrt(
      direction[0] * direction[0] +
        direction[1] * direction[1] +
        direction[2] * direction[2],
    );
    if (length >= 2 ** -52) {
      const reciprocal = 1 / length;
      for (let axis = 0; axis < 3; axis++) direction[axis] *= reciprocal;
    }
    distance /= chosen.count;
    if (distance > 0)
      for (let axis = 0; axis < 3; axis++) direction[axis] = -direction[axis];
  }
  return {
    changed: true,
    distance,
    direction,
    contributionCount: chosen.count,
  };
}

export function reconstructionEdgePosition(
  a: { distance: number; point: number[]; direction: Float64Array },
  b: { distance: number; point: number[]; direction: Float64Array },
  cellWidth: number,
) {
  const da = Math.abs(a.distance),
    db = Math.abs(b.distance);
  const threshold = cellWidth * 0.25;
  const projected = (
    sample: { point: number[]; direction: Float64Array },
    distance: number,
    axis: number,
  ) => sample.point[axis] + distance * sample.direction[axis];
  const out = new Float32Array(3);
  if (db <= da && db < threshold) {
    for (let axis = 0; axis < 3; axis++) out[axis] = projected(b, db, axis);
  } else if (da < db && da < threshold) {
    for (let axis = 0; axis < 3; axis++) out[axis] = projected(a, da, axis);
  } else {
    for (let axis = 0; axis < 3; axis++) {
      // Keep native left-to-right additions and the final Float32 store.
      out[axis] =
        (db * b.direction[axis] +
          b.point[axis] +
          da * a.direction[axis] +
          a.point[axis]) *
        0.5;
    }
  }
  return out;
}

export function reconstructionTriangleCellIntersects(
  center: number[],
  half: number[],
  triangle: Vector[],
) {
  const v = triangle.map((p) =>
    Array.from(p, (value, axis) => value - center[axis]),
  );
  const edges = [
    v[1].map((x, a) => x - v[0][a]),
    v[2].map((x, a) => x - v[1][a]),
    v[0].map((x, a) => x - v[2][a]),
  ];
  const [e0, e1] = edges;
  const n = [
    e1[2] * e0[1] - e1[1] * e0[2],
    e1[0] * e0[2] - e1[2] * e0[0],
    e1[1] * e0[0] - e1[0] * e0[1],
  ];
  const min = Array.from(half, (h, a) => (n[a] > 0 ? -h : h) - v[0][a]);
  const max = Array.from(half, (h, a) => (n[a] > 0 ? h : -h) - v[0][a]);
  if (
    n[1] * min[1] + n[0] * min[0] + n[2] * min[2] > 0 ||
    n[1] * max[1] + n[0] * max[0] + n[2] * max[2] < 0
  )
    return false;
  const pairs = [
    [
      [0, 2],
      [0, 2],
      [1, 2],
    ],
    [
      [0, 2],
      [0, 2],
      [1, 0],
    ],
    [
      [0, 1],
      [0, 1],
      [2, 1],
    ],
  ];
  for (let edge = 0; edge < 3; edge++) {
    const e = edges[edge];
    for (let axis = 0; axis < 3; axis++) {
      const [a, b] = pairs[edge][axis];
      const project = (p: number[]) =>
        axis === 0
          ? p[1] * e[2] - e[1] * p[2]
          : axis === 1
            ? p[2] * e[0] - p[0] * e[2]
            : p[0] * e[1] - p[1] * e[0];
      const p = project(v[a]),
        q = project(v[b]);
      const radius =
        axis === 0
          ? Math.abs(e[1]) * half[2] + Math.abs(e[2]) * half[1]
          : axis === 1
            ? Math.abs(e[2]) * half[0] + half[2] * Math.abs(e[0])
            : Math.abs(e[1]) * half[0] + half[1] * Math.abs(e[0]);
      if (Math.min(p, q) > radius || Math.max(p, q) < -radius) return false;
    }
  }
  return true;
}
export function* reconstructionTriangleCandidates(
  triangle: Vector[],
  spacing: number,
) {
  // Reconstruction reference lane: caller supplies finite coordinates and an advancing lattice.
  const inverse = 1 / spacing;
  const start = [0, 1, 2].map(
    (a) =>
      Math.floor(Math.min(...triangle.map((p) => p[a])) * inverse) * spacing,
  );
  const end = [0, 1, 2].map(
    (a) =>
      Math.floor(Math.max(...triangle.map((p) => p[a])) * inverse) * spacing +
      spacing,
  );
  for (let x = start[0]; x < end[0]; x += spacing)
    for (let y = start[1]; y < end[1]; y += spacing)
      for (let z = start[2]; z < end[2]; z += spacing)
        yield [x + spacing * 0.5, y + spacing * 0.5, z + spacing * 0.5];
}

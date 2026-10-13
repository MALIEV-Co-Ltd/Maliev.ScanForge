/** Native refinement worker arithmetic. Tree construction and scheduling are separate gates. */
export interface AlignmentQueryVertex {
  point: readonly number[];
  normal: readonly number[];
  flags: number;
}
export interface AlignmentQueryHit {
  distance: number;
  closest: readonly number[];
  normal: readonly number[];
  openBoundary: boolean;
}
export const ALIGNMENT_QUERY_SENTINEL = 3.4028234663852886e38;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const transformed = (p: readonly number[], m: readonly number[]) => [
  Math.fround(p[1] * m[1] + p[0] * m[0] + p[2] * m[2] + m[3]),
  Math.fround(p[0] * m[4] + p[1] * m[5] + p[2] * m[6] + m[7]),
  Math.fround(p[0] * m[8] + p[1] * m[9] + p[2] * m[10] + m[11]),
];
/** The orientation pass uses an unrestricted query and float32 transformed normals. */
export function nativeAlignmentOrientationWorker(
  vertices: readonly AlignmentQueryVertex[],
  query: (
    point: readonly number[],
    radius: number,
  ) => AlignmentQueryHit | undefined,
  options: {
    transform?: readonly number[];
    rotation?: readonly number[];
  } = {},
) {
  let positive = 0,
    negative = 0;
  for (const vertex of vertices) {
    if ((vertex.flags & 5) !== 4) continue;
    const hit = query(
      transformed(vertex.point, options.transform ?? identity),
      ALIGNMENT_QUERY_SENTINEL,
    );
    if (!hit || !(Math.abs(hit.distance) < ALIGNMENT_QUERY_SENTINEL)) continue;
    const normal = transformed(vertex.normal, options.rotation ?? identity);
    const dot =
      hit.normal[1] * normal[1] +
      hit.normal[0] * normal[0] +
      hit.normal[2] * normal[2];
    if (dot >= 0) positive++;
    else negative++;
  }
  return [positive, negative] as const;
}

/** Controller vote reduction; equal totals select the negative orientation. */
export function nativeAlignmentOrientationSign(
  workers: readonly (readonly [number, number])[],
) {
  let positive = 0,
    negative = 0;
  for (const votes of workers) {
    positive = (positive + votes[0]) | 0;
    negative = (negative + votes[1]) | 0;
  }
  return positive > negative ? 1 : -1;
}

/** Native controller reduces errors in worker order and rejects any empty worker. */
export function nativeAlignmentQueryError(
  workers: readonly { maximum: number; error: number }[],
  cancelled = false,
) {
  if (cancelled || workers.length === 0) return ALIGNMENT_QUERY_SENTINEL;
  let error = 0;
  for (const worker of workers) {
    if (worker.maximum === -ALIGNMENT_QUERY_SENTINEL)
      return ALIGNMENT_QUERY_SENTINEL;
    error += worker.error;
  }
  return error;
}

export function nativeAlignmentQueryWorker(
  vertices: readonly AlignmentQueryVertex[],
  query: (
    point: readonly number[],
    radius: number,
  ) => AlignmentQueryHit | undefined,
  options: {
    transform?: readonly number[];
    rotation?: readonly number[];
    radius?: number;
    best?: number;
    initializing?: boolean;
    output?: boolean;
    sign?: number;
  } = {},
) {
  const transform = options.transform ?? identity,
    rotation = options.rotation ?? identity;
  const radius = options.radius ?? ALIGNMENT_QUERY_SENTINEL;
  const best = options.best ?? Infinity,
    sign = options.sign ?? 1;
  const flags = vertices.map((v) => v.flags),
    closest: number[][] = [];
  let error = 0,
    maximum = -ALIGNMENT_QUERY_SENTINEL,
    minimum = ALIGNMENT_QUERY_SENTINEL;
  for (let id = 0; id < vertices.length; id++) {
    const vertex = vertices[id];
    if ((vertex.flags & 5) !== 4) {
      if (options.output) closest.push([ALIGNMENT_QUERY_SENTINEL, 0, 0]);
      continue;
    }
    const hit = query(transformed(vertex.point, transform), radius);
    if (!hit || !(Math.abs(hit.distance) < Math.abs(radius))) {
      if (options.initializing) flags[id] &= ~4;
      if (options.output) closest.push([ALIGNMENT_QUERY_SENTINEL, 0, 0]);
      continue;
    }
    const normal = transformed(vertex.normal, rotation);
    const dot =
      hit.normal[1] * normal[1] +
      normal[0] * hit.normal[0] +
      hit.normal[2] * normal[2];
    if (
      options.initializing &&
      (dot * sign < Math.cos(Math.PI / 3) || hit.openBoundary)
    ) {
      flags[id] &= ~4;
      if (options.output) closest.push([ALIGNMENT_QUERY_SENTINEL, 0, 0]);
      continue;
    }
    const distance = Math.abs(hit.distance);
    minimum = Math.min(minimum, distance);
    maximum = Math.max(maximum, distance);
    error += distance * distance;
    if (options.output) closest.push(hit.closest.map(Math.fround));
    else if (error > best) break;
  }
  return { error, maximum, minimum, flags, closest };
}

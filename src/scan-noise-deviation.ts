import { prepareNoiseOctree, type PackedNoiseTree } from "./scan-noise-octree";
import { prepareNoiseOctreeAsync } from "./scan-noise-tree-parallel";
import { queryNoiseOctree } from "./scan-noise-octree-query";
import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";

const f = Math.fround;
const add = (a: number, b: number) => f(a + b);
const mul = (a: number, b: number) => f(a * b);
const sub = (a: number, b: number) => f(a - b);
const dot = (a: number[], b: number[]) =>
  a[1] * b[1] + a[0] * b[0] + a[2] * b[2];

/** Caller-owned scratch for synchronous leaf queries; never retain it in a hit. */
export function createNoiseTriangleScratch() {
  return {
    u: [0, 0, 0],
    v: [0, 0, 0],
    q: [0, 0, 0],
    closest: [0, 0, 0],
    delta: [0, 0, 0],
  };
}

/** Float32 edge differences, double barycentric arithmetic and staged Float32
 * closest-point storage match the native numerical leaf.
 */
export function noiseTriangleDistance(
  p: readonly number[],
  a: number[],
  b: number[],
  c: number[],
  radius = Infinity,
  closestOut?: number[],
  regionOut?: number[],
  cachedNormal?: readonly number[],
  scratch = createNoiseTriangleScratch(),
): number {
  if (regionOut) regionOut[0] = 0;
  const { u, v, q, closest, delta } = scratch;
  for (let i = 0; i < 3; i++) {
    u[i] = sub(b[i], a[i]);
    v[i] = sub(c[i], a[i]);
    q[i] = sub(p[i], a[i]);
  }
  // Face normals use double cross products, a Float32 length denominator and storage.
  let n = cachedNormal;
  if (!n) {
    const du = b.map((x, i) => x - a[i]),
      dv = c.map((x, i) => x - a[i]);
    const computed = [
      du[1] * dv[2] - du[2] * dv[1],
      du[2] * dv[0] - du[0] * dv[2],
      du[0] * dv[1] - du[1] * dv[0],
    ];
    const length = f(
      Math.sqrt(
        computed[0] * computed[0] +
          computed[1] * computed[1] +
          computed[2] * computed[2],
      ),
    );
    if (!(length > Number.EPSILON)) return Infinity;
    for (let i = 0; i < 3; i++) computed[i] = f(computed[i] / length);
    n = computed;
  }
  if (
    Math.abs(add(add(mul(n[0], q[0]), mul(n[1], q[1])), mul(n[2], q[2]))) >
    radius
  )
    return Infinity;
  const aa = dot(u, u),
    bb = dot(u, v),
    cc = dot(v, v),
    d = dot(u, q),
    e = dot(v, q);
  const determinant = cc * aa - bb * bb;
  if (!(determinant > 0)) return Infinity;
  let s = d * cc - e * bb,
    t = e * aa - d * bb;
  let region = 0;
  const alongU = () => {
    s = d <= 0 ? 0 : aa <= d ? 1 : d / aa;
    t = 0;
  };
  const alongV = () => {
    s = 0;
    t = e <= 0 ? 0 : cc <= e ? 1 : e / cc;
  };
  const opposite = (numerator: number) => {
    const denominator = aa - (bb + bb) + cc;
    if (numerator < denominator) {
      s = numerator / denominator;
      t = 1 - s;
    } else {
      s = 1;
      t = 0;
    }
  };
  if (determinant < t + s) {
    if (s >= 0) {
      if (t < 0) {
        region = 3;
        const first = aa - d,
          second = bb - e;
        if (second < first) {
          // Region 3 measures the BC parameter from B toward C; regions 2/6
          // measure it in the opposite direction.
          opposite(first - second);
          [s, t] = [t, s];
        } else alongU();
      } else {
        region = 2;
        const numerator = cc - e - bb - -d;
        if (numerator <= 0) {
          s = 0;
          t = 1;
        } else opposite(numerator);
      }
    } else {
      region = 6;
      const first = cc - e,
        second = bb - d;
      if (first <= second) alongV();
      else opposite(first - second);
    }
  } else if (s >= 0) {
    if (t >= 0) {
      const reciprocal = 1 / determinant;
      s *= reciprocal;
      t *= reciprocal;
    } else {
      region = 1;
      alongU();
    }
  } else if (t >= 0) {
    region = 4;
    alongV();
  } else {
    region = 5;
    if (d > 0) alongU();
    else alongV();
  }
  if (regionOut) regionOut[0] = region;
  for (let i = 0; i < 3; i++) closest[i] = f(f(u[i] * s + a[i]) + v[i] * t);
  if (closestOut) for (let i = 0; i < 3; i++) closestOut[i] = closest[i];
  for (let i = 0; i < 3; i++) delta[i] = p[i] - closest[i];
  const distance = Math.sqrt(
    delta[1] * delta[1] + delta[0] * delta[0] + delta[2] * delta[2],
  );
  return n[1] * delta[1] + n[0] * delta[0] + n[2] * delta[2] < 0
    ? -distance
    : distance;
}

export interface NoiseDeviation {
  distances: Float64Array;
  matched: number;
  within: number;
  total: number;
  percentage: number;
  maximum: number;
}

/** Samples every original indexed vertex against the smoothed surface. */
export function compareNoiseSurface(
  original: MeshTopology,
  preview: Float64Array,
  threshold: number,
  options: MeshProcessingOptions = {},
): NoiseDeviation {
  if (!Number.isFinite(threshold) || threshold <= 0)
    throw new Error("Comparison threshold must be positive and finite.");
  if (preview.length !== original.vertices.length)
    throw new Error("Preview coordinates must match indexed vertices.");
  if (options.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  if (preview.some((value) => !Number.isFinite(value)))
    throw new Error("Preview coordinates must be finite.");
  const prepared = prepareNoiseOctree(
    { coordinates: preview, indices: original.triangles },
    0.5,
    10,
    options,
  );
  return comparePreparedNoiseSurface(original, prepared, threshold, options);
}

export async function compareNoiseSurfaceAsync(
  original: MeshTopology,
  preview: Float64Array,
  threshold: number,
  options: MeshProcessingOptions = {},
): Promise<NoiseDeviation> {
  if (!Number.isFinite(threshold) || threshold <= 0)
    throw new Error("Comparison threshold must be positive and finite.");
  if (preview.length !== original.vertices.length)
    throw new Error("Preview coordinates must match indexed vertices.");
  if (options.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  if (preview.some((value) => !Number.isFinite(value)))
    throw new Error("Preview coordinates must be finite.");
  const prepared = await prepareNoiseOctreeAsync(
    { coordinates: preview, indices: original.triangles },
    0.5,
    10,
    options,
  );
  return comparePreparedNoiseSurface(original, prepared, threshold, options);
}

export function comparePreparedNoiseSurface(
  original: MeshTopology,
  prepared: PackedNoiseTree,
  threshold: number,
  options: MeshProcessingOptions,
): NoiseDeviation {
  const total = original.vertices.length / 3,
    distances = new Float64Array(total).fill(NaN);
  let matched = 0,
    within = 0,
    maximum = 0;
  const p = [0, 0, 0],
    a = [0, 0, 0],
    b = [0, 0, 0],
    c = [0, 0, 0];
  for (let id = 0; id < total; id++) {
    if (id % 1024 === 0) {
      if (options.signal?.aborted)
        throw new DOMException("Mesh operation cancelled.", "AbortError");
      options.onProgress?.(
        id / total,
        "Comparing original vertices with smoothed surface",
      );
      if (options.signal?.aborted)
        throw new DOMException("Mesh operation cancelled.", "AbortError");
    }
    for (let axis = 0; axis < 3; axis++)
      p[axis] = Math.fround(original.vertices[id * 3 + axis]);
    const hit = queryNoiseOctree(
      prepared.root,
      p,
      5 * threshold,
      prepared.triangleBounds,
      (triangle, radius) => {
        for (let axis = 0; axis < 3; axis++) {
          a[axis] = prepared.points[triangle * 9 + axis];
          b[axis] = prepared.points[triangle * 9 + 3 + axis];
          c[axis] = prepared.points[triangle * 9 + 6 + axis];
        }
        return noiseTriangleDistance(p, a, b, c, radius);
      },
    );
    const value = hit?.distance ?? NaN;
    distances[id] = value;
    if (Number.isFinite(value)) {
      matched++;
      maximum = Math.max(maximum, Math.abs(value));
      if (Math.abs(value) <= threshold) within++;
    }
  }
  return {
    distances,
    matched,
    within,
    total,
    percentage: (100 * within) / total,
    maximum,
  };
}

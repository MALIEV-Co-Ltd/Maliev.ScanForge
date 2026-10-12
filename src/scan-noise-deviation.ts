import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";

const f = Math.fround;
const add = (a: number, b: number) => f(a + b);
const mul = (a: number, b: number) => f(a * b);
const sub = (a: number, b: number) => f(a - b);
const dot = (a: number[], b: number[]) =>
  a[1] * b[1] + a[0] * b[0] + a[2] * b[2];

/** Float32 edge differences, double barycentric arithmetic and staged Float32
 * closest-point storage match the native numerical leaf.
 */
export function noiseTriangleDistance(
  p: number[],
  a: number[],
  b: number[],
  c: number[],
  radius = Infinity,
  closestOut?: number[],
): number {
  const u = b.map((x, i) => sub(x, a[i]));
  const v = c.map((x, i) => sub(x, a[i]));
  const q = p.map((x, i) => sub(x, a[i]));
  // Face normals use double cross products, a Float32 length denominator and storage.
  const du = b.map((x, i) => x - a[i]),
    dv = c.map((x, i) => x - a[i]);
  const n = [
    du[1] * dv[2] - du[2] * dv[1],
    du[2] * dv[0] - du[0] * dv[2],
    du[0] * dv[1] - du[1] * dv[0],
  ];
  const length = f(Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]));
  if (!(length > Number.EPSILON)) return Infinity;
  for (let i = 0; i < 3; i++) n[i] = f(n[i] / length);
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
        const first = aa - d,
          second = bb - e;
        if (second < first) opposite(first - second);
        else alongU();
      } else {
        const numerator = cc - e - bb - -d;
        if (numerator <= 0) {
          s = 0;
          t = 1;
        } else opposite(numerator);
      }
    } else {
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
    } else alongU();
  } else if (t >= 0) alongV();
  else if (d > 0) alongU();
  else alongV();
  const closest = a.map((x, i) => f(f(u[i] * s + x) + v[i] * t));
  if (closestOut) for (let i = 0; i < 3; i++) closestOut[i] = closest[i];
  const delta = p.map((x, i) => x - closest[i]);
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
  const geometry = new BufferGeometry();
  try {
    geometry.setAttribute(
      "position",
      new BufferAttribute(Float32Array.from(preview), 3),
    );
    geometry.setIndex(new BufferAttribute(original.triangles, 1));
    const tree = new MeshBVH(geometry, { indirect: true });
    const total = original.vertices.length / 3,
      distances = new Float64Array(total).fill(NaN);
    let matched = 0,
      within = 0,
      maximum = 0;
    const point = new Vector3();
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
      point.fromArray(original.vertices, id * 3);
      const p = [point.x, point.y, point.z];
      let best = 5 * threshold,
        value = NaN;
      tree.shapecast({
        // Padding covers Float32 projection rounding near a triangle bound.
        intersectsBounds: (box) =>
          box.distanceToPoint(point) <=
          best +
            Math.max(
              1,
              Math.abs(point.x),
              Math.abs(point.y),
              Math.abs(point.z),
            ) *
              1e-6,
        intersectsTriangle: (triangle) => {
          const distance = noiseTriangleDistance(
            p,
            triangle.a.toArray(),
            triangle.b.toArray(),
            triangle.c.toArray(),
            best,
          );
          if (Math.abs(distance) < best) {
            best = Math.abs(distance);
            value = distance;
          }
          return false;
        },
      });
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
  } finally {
    geometry.dispose();
  }
}

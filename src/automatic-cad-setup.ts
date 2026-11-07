import { nativeAlignmentEigen3 } from "./scan-native-alignment-eigen";
import type { Entity } from "./types";
import type { DatumInstruction } from "./datum-alignment";
export interface AutomaticCadSetup {
  referenceEntityId: string;
  origin?: "center" | "corner";
  primaryAxis?: "X" | "Y";
  flipBase?: boolean;
  planeTolerance?: number;
}
type V = number[];
const dot = (a: V, b: V) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a: V, b: V) => a.map((v, i) => v - b[i]);
const cross = (a: V, b: V) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V) => {
  const l = Math.hypot(...a);
  return a.map((v) => v / l);
};
/** Bounded deterministic support-plane search; a scan cannot identify semantic front/bottom. */
export async function automaticCadSetup(
  targets: readonly Entity[],
  options: AutomaticCadSetup,
  check: () => void,
) {
  const reference = targets.find((e) => e.id === options.referenceEntityId);
  if (
    !reference ||
    reference.kernelId ||
    reference.parametric ||
    !["mesh", "pointcloud"].includes(reference.kind)
  )
    throw Error(
      "Choose a raw scan in the objects being aligned as the automatic setup reference.",
    );
  if (
    (options.origin !== undefined &&
      !["center", "corner"].includes(options.origin)) ||
    (options.primaryAxis !== undefined &&
      !["X", "Y"].includes(options.primaryAxis)) ||
    (options.flipBase !== undefined && typeof options.flipBase !== "boolean")
  )
    throw Error("Invalid automatic CAD setup options.");
  const points: V[] = [],
    count = Math.min(6000, reference.positions.length / 3);
  for (let i = 0; i < count; i++) {
    const slot = Math.floor((i * (reference.positions.length / 3)) / count) * 3;
    const p = Array.from(reference.positions.slice(slot, slot + 3));
    if (!p.every(Number.isFinite))
      throw Error("Automatic setup requires finite scan coordinates.");
    points.push(p);
  }
  if (points.length < 12)
    throw Error("Automatic setup requires at least twelve scan points.");
  const min = [0, 1, 2].map((a) => Math.min(...points.map((p) => p[a]))),
    max = [0, 1, 2].map((a) => Math.max(...points.map((p) => p[a])));
  const diagonal = Math.hypot(...sub(max, min)),
    tolerance = options.planeTolerance ?? Math.max(0.01, diagonal * 0.003);
  if (!(tolerance > 0) || !Number.isFinite(tolerance) || tolerance > 1e6)
    throw Error(
      "Plane tolerance must be a positive finite distance in mm, up to 1000000.",
    );
  let seed = 1753;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % points.length;
  };
  let best:
    { normal: V; offset: number; support: number; score: number } | undefined;
  const triangleTrials = reference.kind === "mesh" ? 384 : 0;
  for (let i = 0; i < 384 + triangleTrials; i++) {
    if (i % 32 === 0) {
      check();
      await new Promise((r) => setTimeout(r, 0));
    }
    const slot =
      Math.floor(
        ((i - 384) * Math.floor(reference.positions.length / 9)) /
          Math.max(1, triangleTrials),
      ) * 9;
    const a =
        i < 384
          ? points[rand()]
          : Array.from(reference.positions.slice(slot, slot + 3)),
      b =
        i < 384
          ? points[rand()]
          : Array.from(reference.positions.slice(slot + 3, slot + 6)),
      c =
        i < 384
          ? points[rand()]
          : Array.from(reference.positions.slice(slot + 6, slot + 9)),
      n = cross(sub(b, a), sub(c, a));
    if (Math.hypot(...n) < diagonal * diagonal * 1e-10) continue;
    for (const sign of [1, -1]) {
      const normal = unit(n).map((v) => v * sign),
        offset = dot(normal, a);
      let support = 0,
        below = 0;
      for (const p of points) {
        const d = dot(normal, p) - offset;
        if (Math.abs(d) <= tolerance) support++;
        if (d < -tolerance * 2) below++;
      }
      if (below > points.length * 0.02) continue;
      const score = support + normal[2] * points.length * 0.0001;
      if (!best || score > best.score)
        best = { normal, offset, support, score };
    }
  }
  if (!best || best.support < points.length * 0.08)
    throw Error(
      "No reliable flat supporting face found. Increase plane tolerance or use manual plane references.",
    );
  const inliers = points.filter(
    (p) => Math.abs(dot(best!.normal, p) - best!.offset) <= tolerance,
  );
  const center = [0, 1, 2].map(
      (a) => inliers.reduce((s, p) => s + p[a], 0) / inliers.length,
    ),
    cov = Array(9).fill(0);
  for (const p of inliers) {
    const d = sub(p, center);
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        cov[a * 3 + b] += (d[a] * d[b]) / inliers.length;
  }
  const eig = nativeAlignmentEigen3(cov);
  if (!eig.accepted || eig.values[1] <= diagonal * diagonal * 1e-12)
    throw Error("Detected support points cannot define a reliable plane.");
  let z = [eig.vectors[2], eig.vectors[5], eig.vectors[8]];
  if (dot(z, best.normal) < 0) z = z.map((v) => -v);
  if (options.flipBase) z = z.map((v) => -v);
  const helper = Math.abs(z[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0],
    u = unit(cross(helper, z)),
    v = cross(z, u);
  const projected = points
    .map((p) => [dot(p, u), dot(p, v)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (a: V, b: V, c: V) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const hull: V[] = [];
  for (const p of projected) {
    while (hull.length > 1 && turn(hull.at(-2)!, hull.at(-1)!, p) <= 0)
      hull.pop();
    hull.push(p);
  }
  const lower = hull.length;
  for (let i = projected.length - 2; i >= 0; i--) {
    const p = projected[i];
    while (hull.length > lower && turn(hull.at(-2)!, hull.at(-1)!, p) <= 0)
      hull.pop();
    hull.push(p);
  }
  hull.pop();
  let rectangle:
    { area: number; axis: V; width: number; height: number } | undefined;
  for (let i = 0; i < hull.length; i++) {
    const d = sub(hull[(i + 1) % hull.length], hull[i]),
      l = Math.hypot(...d);
    if (l < 1e-12) continue;
    const axis = d.map((x) => x / l),
      perp = [-axis[1], axis[0]],
      xs = hull.map((p) => dot(p, axis)),
      ys = hull.map((p) => dot(p, perp)),
      width = Math.max(...xs) - Math.min(...xs),
      height = Math.max(...ys) - Math.min(...ys),
      area = width * height;
    if (!rectangle || area < rectangle.area)
      rectangle = { area, axis, width, height };
  }
  if (!rectangle || rectangle.area < 1e-12)
    throw Error("Scan footprint cannot define CAD axes.");
  let axis = rectangle.axis;
  if (rectangle.width < rectangle.height) axis = [-axis[1], axis[0]];
  let x = u.map((value, a) => value * axis[0] + v[a] * axis[1]);
  if (options.primaryAxis === "Y") x = cross(x, z);
  const dominant = x.reduce(
    (m, _, i) => (Math.abs(x[i]) > Math.abs(x[m]) ? i : m),
    0,
  );
  if (x[dominant] < 0) x = x.map((value) => -value);
  const y = cross(z, x);
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity];
  // Exact group bounds, chunked so cancellation remains responsive on full scans.
  for (const e of targets)
    for (let start = 0; start < e.positions.length; start += 786432) {
      check();
      const end = Math.min(e.positions.length, start + 786432);
      for (let i = start; i < end; i += 3) {
        const p = [e.positions[i], e.positions[i + 1], e.positions[i + 2]];
        for (const [a, axis] of [x, y, z].entries()) {
          const value = dot(p, axis);
          if (!Number.isFinite(value))
            throw Error("Scan coordinates must be finite.");
          low[a] = Math.min(low[a], value);
          high[a] = Math.max(high[a], value);
        }
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  const local = [
    options.origin === "corner" ? low[0] : (low[0] + high[0]) / 2,
    options.origin === "corner" ? low[1] : (low[1] + high[1]) / 2,
    low[2],
  ];
  const origin = x.map(
    (_, a) => x[a] * local[0] + y[a] * local[1] + z[a] * local[2],
  );
  const constraints: DatumInstruction[] = [
    { kind: "plane", point: origin, direction: z, axis: 2 },
    { kind: "direction", point: origin, direction: x, axis: 0 },
  ];
  const distances = inliers.map((p) => dot(z, sub(p, center)));
  return {
    constraints,
    translationPoint: origin,
    diagnostics: {
      referenceEntityId: reference.id,
      planeTolerance: tolerance,
      sampleCount: points.length,
      planeSupportPercent: (inliers.length / points.length) * 100,
      planeRms: Math.sqrt(
        distances.reduce((s, d) => s + d * d, 0) / distances.length,
      ),
      axes: { x, y, z },
      origin,
      dimensions: sub(high, low),
      originMode: options.origin ?? "center",
      primaryAxis: options.primaryAxis ?? "X",
      warnings: [
        "Front/back direction and the intended base cannot be inferred uniquely from symmetric scans; review the preview.",
        ...(Math.abs(rectangle.width - rectangle.height) /
          Math.max(rectangle.width, rectangle.height) <
        0.05
          ? ["Nearly square footprint: X/Y orientation is ambiguous."]
          : []),
      ],
    },
  };
}

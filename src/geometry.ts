import type { FitResult, MeshStats, SectionResult, Vec3 } from "./types";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(...a);
const unit = (a: Vec3): Vec3 => mul(a, 1 / norm(a));

function points(positions: number[], mesh = false): Vec3[] {
  if (
    !positions.length ||
    positions.length % (mesh ? 9 : 3) ||
    !positions.every(Number.isFinite)
  ) {
    throw new Error(
      mesh
        ? "Expected finite triangle coordinates."
        : "Expected finite XYZ coordinates.",
    );
  }
  const result: Vec3[] = [];
  for (let i = 0; i < positions.length; i += 3)
    result.push([positions[i]!, positions[i + 1]!, positions[i + 2]!]);
  return result;
}

function frame(positions: number[]) {
  const pts = points(positions);
  const center: Vec3 = [0, 0, 0];
  for (const p of pts)
    for (let j = 0; j < 3; j++) center[j]! += p[j]! / pts.length;
  const scale = pts.reduce((max, p) => Math.max(max, norm(sub(p, center))), 0);
  if (pts.length < 3 || !Number.isFinite(scale) || scale <= 0)
    throw new Error("Insufficient distinct points for fitting.");
  const local = pts.map((p) => mul(sub(p, center), 1 / scale));
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const p of local)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        covariance[i]![j]! += (p[i]! * p[j]!) / pts.length;
  const eigen = eigenvectors(covariance);
  if (eigen[1]!.value < 1e-12)
    throw new Error("Collinear points cannot define a surface.");
  return { pts, center, scale, local, eigen };
}

// Jacobi rotations diagonalize a real symmetric covariance matrix.
function eigenvectors(matrix: number[][]) {
  const a = matrix.map((row) => [...row]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iteration = 0; iteration < 40; iteration++) {
    let p = 0,
      q = 1;
    for (const [i, j] of [
      [0, 2],
      [1, 2],
    ])
      if (Math.abs(a[i!]![j!]!) > Math.abs(a[p]![q]!)) {
        p = i!;
        q = j!;
      }
    if (Math.abs(a[p]![q]!) < 1e-15) break;
    const theta = 0.5 * Math.atan2(2 * a[p]![q]!, a[q]![q]! - a[p]![p]!);
    const c = Math.cos(theta),
      s = Math.sin(theta);
    const pp = a[p]![p]!,
      qq = a[q]![q]!,
      pq = a[p]![q]!;
    a[p]![p] = c * c * pp - 2 * s * c * pq + s * s * qq;
    a[q]![q] = s * s * pp + 2 * s * c * pq + c * c * qq;
    a[p]![q] = a[q]![p] = 0;
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const kp = a[k]![p]!,
          kq = a[k]![q]!;
        a[k]![p] = a[p]![k] = c * kp - s * kq;
        a[k]![q] = a[q]![k] = s * kp + c * kq;
      }
      const vp = v[k]![p]!,
        vq = v[k]![q]!;
      v[k]![p] = c * vp - s * vq;
      v[k]![q] = s * vp + c * vq;
    }
  }
  return [0, 1, 2]
    .map((i) => {
      let axis: Vec3 = [v[0]![i]!, v[1]![i]!, v[2]![i]!];
      const major = axis.reduce(
        (best, x, j) => (Math.abs(x) > Math.abs(axis[best]!) ? j : best),
        0,
      );
      if (axis[major]! < 0) axis = mul(axis, -1);
      return { value: a[i]![i]!, axis: unit(axis) };
    })
    .sort((x, y) => x.value - y.value);
}

// Pivoted normal equations on normalized coordinates; reject deficient rank.
function leastSquares(rows: number[][], target: number[]) {
  const n = rows[0]!.length;
  const a = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) =>
      rows.reduce(
        (sum, row, k) => sum + row[i]! * (j === n ? target[k]! : row[j]!),
        0,
      ),
    ),
  );
  const tolerance =
    Math.max(...a.flatMap((row) => row.slice(0, n).map(Math.abs))) * 1e-12;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    if (Math.abs(a[pivot]![col]!) <= tolerance)
      throw new Error("Surface fit is underdetermined.");
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const divisor = a[col]![col]!;
    for (let j = col; j <= n; j++) a[col]![j]! /= divisor;
    for (let row = 0; row < n; row++)
      if (row !== col) {
        const factor = a[row]![col]!;
        for (let j = col; j <= n; j++) a[row]![j]! -= factor * a[col]![j]!;
      }
  }
  return a.map((row) => row[n]!);
}

export function deviations(positions: number[], fit: FitResult): number[] {
  if (
    ![...fit.center, ...fit.axis].every(Number.isFinite) ||
    norm(fit.axis) <= 0
  )
    throw new Error("Invalid fitted surface.");
  if (
    fit.kind !== "plane" &&
    (!Number.isFinite(fit.radius) || fit.radius! <= 0)
  )
    throw new Error("Invalid surface radius.");
  const axis = unit(fit.axis);
  return points(positions).map((p) => {
    const d = sub(p, fit.center);
    if (fit.kind === "plane") return dot(d, axis);
    if (fit.kind === "sphere") return norm(d) - fit.radius!;
    return norm(sub(d, mul(axis, dot(d, axis)))) - fit.radius!;
  });
}

function errors(positions: number[], fit: FitResult): FitResult {
  const d = deviations(positions, fit);
  return {
    ...fit,
    rms: Math.sqrt(d.reduce((sum, x) => sum + x * x, 0) / d.length),
    maxError: d.reduce((max, x) => Math.max(max, Math.abs(x)), 0),
  };
}

export function fitPlane(positions: number[]): FitResult {
  const f = frame(positions);
  return errors(positions, {
    kind: "plane",
    center: f.center,
    axis: f.eigen[0]!.axis,
    rms: 0,
    maxError: 0,
  });
}

export function fitSphere(positions: number[]): FitResult {
  const f = frame(positions);
  const solution = leastSquares(
    f.local.map((p) => [2 * p[0], 2 * p[1], 2 * p[2], 1]),
    f.local.map((p) => dot(p, p)),
  );
  const localCenter: Vec3 = [solution[0]!, solution[1]!, solution[2]!];
  const radiusSquared = solution[3]! + dot(localCenter, localCenter);
  if (radiusSquared <= 1e-12) throw new Error("Sphere radius is degenerate.");
  return errors(positions, {
    kind: "sphere",
    center: add(f.center, mul(localCenter, f.scale)),
    radius: Math.sqrt(radiusSquared) * f.scale,
    axis: [0, 0, 1],
    rms: 0,
    maxError: 0,
  });
}

// Evaluate all PCA axes, since short cylinders have a smallest-variance axis.
// This estimate assumes a sufficiently sampled cylindrical side surface.
export function fitCylinder(positions: number[]): FitResult {
  const f = frame(positions);
  const candidates: FitResult[] = [];
  for (const { axis } of f.eigen) {
    const u = unit(
      cross(axis, Math.abs(axis[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]),
    );
    const v = cross(axis, u);
    const projected = f.local.map((p) => [dot(p, u), dot(p, v), dot(p, axis)]);
    try {
      const s = leastSquares(
        projected.map((p) => [2 * p[0]!, 2 * p[1]!, 1]),
        projected.map((p) => p[0]! ** 2 + p[1]! ** 2),
      );
      const r2 = s[2]! + s[0]! ** 2 + s[1]! ** 2;
      const lo = projected.reduce((m, p) => Math.min(m, p[2]!), Infinity),
        hi = projected.reduce((m, p) => Math.max(m, p[2]!), -Infinity);
      if (r2 <= 1e-12 || hi - lo <= 1e-8) continue;
      const localCenter = add(
        add(mul(u, s[0]!), mul(v, s[1]!)),
        mul(axis, (lo + hi) / 2),
      );
      candidates.push(
        errors(positions, {
          kind: "cylinder",
          center: add(f.center, mul(localCenter, f.scale)),
          axis,
          radius: Math.sqrt(r2) * f.scale,
          height: (hi - lo) * f.scale,
          rms: 0,
          maxError: 0,
        }),
      );
    } catch {
      /* An axis with a rank-deficient projection is not a candidate. */
    }
  }
  if (!candidates.length || f.eigen[0]!.value < 1e-12)
    throw new Error("Insufficient cylindrical surface samples.");
  return candidates.sort((a, b) => a.rms - b.rms)[0]!;
}

export function meshStats(positions: number[]): MeshStats {
  const pts = points(positions, true);
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts)
    for (let j = 0; j < 3; j++) {
      min[j] = Math.min(min[j]!, p[j]!);
      max[j] = Math.max(max[j]!, p[j]!);
    }
  const center = mul(add(min, max), 0.5);
  let area = 0,
    volume = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const a = pts[i]!,
      b = pts[i + 1]!,
      c = pts[i + 2]!;
    area += norm(cross(sub(b, a), sub(c, a))) / 2;
    volume += dot(sub(a, center), cross(sub(b, center), sub(c, center))) / 6;
  }
  // Volume is meaningful for closed meshes with consistent winding only.
  return {
    vertices: pts.length,
    triangles: pts.length / 3,
    area,
    volume: Math.abs(volume),
    min,
    max,
    size: sub(max, min),
    center,
  };
}

export function cleanupMesh(positions: number[]): number[] {
  const pts = points(positions, true),
    result: number[] = [];
  for (let i = 0; i < pts.length; i += 3) {
    const a = pts[i]!,
      b = pts[i + 1]!,
      c = pts[i + 2]!,
      ab = sub(b, a),
      ac = sub(c, a);
    const edgeScale = Math.max(norm(ab), norm(ac), norm(sub(c, b)));
    if (
      edgeScale > 0 &&
      norm(cross(mul(ab, 1 / edgeScale), mul(ac, 1 / edgeScale))) > 1e-12
    )
      result.push(...a, ...b, ...c);
  }
  return result;
}

export function transformPositions(
  positions: number[],
  translation: Vec3,
  rotation: Vec3,
  scale: number,
): number[] {
  if (
    ![...translation, ...rotation, scale].every(Number.isFinite) ||
    scale <= 0
  )
    throw new Error("Transform requires finite values and a positive scale.");
  const angles = rotation.map((d) => (d * Math.PI) / 180),
    [sx, sy, sz] = angles.map(Math.sin),
    [cx, cy, cz] = angles.map(Math.cos);
  return points(positions).flatMap((p) => {
    const x = p[0] * scale,
      y = p[1] * scale,
      z = p[2] * scale;
    const y1 = y * cx! - z * sx!,
      z1 = y * sx! + z * cx!;
    const x2 = x * cy! + z1 * sy!,
      z2 = -x * sy! + z1 * cy!;
    return [
      x2 * cz! - y1 * sz! + translation[0],
      x2 * sz! + y1 * cz! + translation[1],
      z2 + translation[2],
    ];
  });
}

export function sectionMesh(
  positions: number[],
  axis: "x" | "y" | "z",
  offset: number,
): SectionResult {
  if (!Number.isFinite(offset))
    throw new Error("Section offset must be finite.");
  const pts = points(positions, true),
    component = { x: 0, y: 1, z: 2 }[axis];
  const bounds = pts.reduce(
    (m, p) => Math.max(m, ...p.map(Math.abs)),
    Math.abs(offset),
  );
  const epsilon = Math.max(1e-9, bounds * Number.EPSILON * 32);
  const segments: number[] = [],
    seen = new Set<string>();
  let length = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const triangle = pts.slice(i, i + 3),
      hits: Vec3[] = [];
    if (triangle.every((p) => Math.abs(p[component]! - offset) <= epsilon))
      continue;
    const insert = (p: Vec3) => {
      if (!hits.some((q) => norm(sub(p, q)) <= epsilon)) hits.push(p);
    };
    for (let j = 0; j < 3; j++) {
      const a = triangle[j]!,
        b = triangle[(j + 1) % 3]!,
        da = a[component]! - offset,
        db = b[component]! - offset;
      if (Math.abs(da) <= epsilon) insert(a);
      if (da * db < 0 && Math.abs(da) > epsilon && Math.abs(db) > epsilon)
        insert(add(a, mul(sub(b, a), da / (da - db))));
    }
    if (hits.length !== 2) continue;
    const a = hits[0]!,
      b = hits[1]!,
      key = [a, b]
        .map((p) => p.map((x) => Math.round(x / epsilon)).join(","))
        .sort()
        .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    segments.push(...a, ...b);
    length += norm(sub(b, a));
  }
  return { segments, length };
}

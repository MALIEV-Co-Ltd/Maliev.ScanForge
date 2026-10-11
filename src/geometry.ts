import type {
  FitResult,
  MeshStats,
  SectionResult,
  Vec3,
  Positions,
} from "./types";

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

function validatePositions(positions: Positions, mesh = false): void {
  if (!positions.length || positions.length % (mesh ? 9 : 3))
    throw new Error(
      mesh
        ? "Expected finite triangle coordinates."
        : "Expected finite XYZ coordinates.",
    );
  for (let i = 0; i < positions.length; i++)
    if (!Number.isFinite(positions[i]))
      throw new Error(
        mesh
          ? "Expected finite triangle coordinates."
          : "Expected finite XYZ coordinates.",
      );
}

function points(positions: Positions, mesh = false): Vec3[] {
  validatePositions(positions, mesh);
  const result: Vec3[] = [];
  for (let i = 0; i < positions.length; i += 3)
    result.push([positions[i]!, positions[i + 1]!, positions[i + 2]!]);
  return result;
}

function frame(positions: Positions) {
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

export function deviations(positions: number[], fit: FitResult): number[];
export function deviations(
  positions: Float32Array,
  fit: FitResult,
): Float32Array;
export function deviations(positions: Positions, fit: FitResult): Positions;
export function deviations(positions: Positions, fit: FitResult): Positions {
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
  if (
    fit.kind === "cone" &&
    (!Number.isFinite(fit.topRadius) ||
      fit.topRadius! < 0 ||
      !Number.isFinite(fit.height) ||
      fit.height! <= 0)
  )
    throw new Error("Invalid cone dimensions.");
  const axis = unit(fit.axis);
  validatePositions(positions);
  const result =
    positions instanceof Float32Array
      ? new Float32Array(positions.length / 3)
      : new Array<number>(positions.length / 3);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]! - fit.center[0],
      y = positions[i + 1]! - fit.center[1],
      z = positions[i + 2]! - fit.center[2],
      projection = x * axis[0] + y * axis[1] + z * axis[2];
    const radial = Math.hypot(
      x - axis[0] * projection,
      y - axis[1] * projection,
      z - axis[2] * projection,
    );
    const slope =
      fit.kind === "cone" ? (fit.topRadius! - fit.radius!) / fit.height! : 0;
    result[i / 3] =
      fit.kind === "plane"
        ? projection
        : fit.kind === "sphere"
          ? Math.hypot(x, y, z) - fit.radius!
          : (radial - fit.radius! - slope * projection) /
            Math.sqrt(1 + slope * slope);
  }
  return result;
}

function errors(positions: Positions, fit: FitResult): FitResult {
  const d = deviations(positions, fit);
  let sum = 0,
    max = 0;
  for (const value of d) {
    sum += value * value;
    max = Math.max(max, Math.abs(value));
  }
  return {
    ...fit,
    rms: Math.sqrt(sum / d.length),
    maxError: max,
  };
}

export function fitPlane(positions: Positions): FitResult {
  const f = frame(positions);
  return errors(positions, {
    kind: "plane",
    center: f.center,
    axis: f.eigen[0]!.axis,
    rms: 0,
    maxError: 0,
  });
}

export function fitSphere(positions: Positions): FitResult {
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
export function fitCylinder(positions: Positions): FitResult {
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

/** Fit a circular cone side with independently authored damped Gauss-Newton refinement. */
export function fitCone(positions: Positions): FitResult {
  const f = frame(positions);
  if (f.local.length < 8 || f.eigen[0]!.value < 1e-12)
    throw new Error(
      "Cone fitting requires non-planar side samples at multiple heights.",
    );
  const candidates: FitResult[] = [];
  for (const { axis: initialAxis } of f.eigen) {
    const u = unit(
      cross(
        initialAxis,
        Math.abs(initialAxis[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0],
      ),
    );
    const v = cross(initialAxis, u);
    const projected = f.local.map(
      (p) => [dot(p, u), dot(p, v), dot(p, initialAxis)] as Vec3,
    );
    try {
      const circle = leastSquares(
        projected.map((p) => [2 * p[0], 2 * p[1], 1]),
        projected.map((p) => p[0] ** 2 + p[1] ** 2),
      );
      const radii = projected.map((p) =>
        Math.hypot(p[0] - circle[0]!, p[1] - circle[1]!),
      );
      const line = leastSquares(
        projected.map((p) => [1, p[2]]),
        radii,
      );
      let parameters = [circle[0]!, circle[1]!, 0, 0, line[0]!, line[1]!];
      const model = (a: number[]) => {
        const axis = unit(add(initialAxis, add(mul(u, a[2]!), mul(v, a[3]!))));
        const center = add(mul(u, a[0]!), mul(v, a[1]!));
        const divisor = Math.sqrt(1 + a[5]! ** 2);
        const residuals = f.local.map((point) => {
          const d = sub(point, center),
            z = dot(d, axis);
          return (norm(sub(d, mul(axis, z))) - a[4]! - a[5]! * z) / divisor;
        });
        return {
          axis,
          center,
          residuals,
          cost: residuals.reduce((sum, value) => sum + value * value, 0),
        };
      };
      let current = model(parameters),
        damping = 1e-5;
      for (let iteration = 0; iteration < 60; iteration++) {
        const columns = parameters.map((value, j) => {
          const step = 1e-5 * Math.max(1, Math.abs(value));
          const perturbed = [...parameters];
          perturbed[j]! += step;
          return model(perturbed).residuals.map(
            (residual, i) => (residual - current.residuals[i]!) / step,
          );
        });
        const rows = current.residuals.map((_, i) =>
          columns.map((column) => column[i]!),
        );
        for (let j = 0; j < 6; j++)
          rows.push(
            Array.from({ length: 6 }, (_, k) =>
              j === k ? Math.sqrt(damping * f.local.length) : 0,
            ),
          );
        const delta = leastSquares(rows, [
          ...current.residuals.map((value) => -value),
          0,
          0,
          0,
          0,
          0,
          0,
        ]);
        const trialParameters = parameters.map((value, j) => value + delta[j]!);
        const trial = model(trialParameters);
        if (
          Number.isFinite(trial.cost) &&
          trial.cost < current.cost &&
          trialParameters[4]! > 0
        ) {
          const improvement = current.cost - trial.cost;
          parameters = trialParameters;
          current = trial;
          damping = Math.max(1e-12, damping / 3);
          if (improvement < 1e-18 || current.cost < 1e-22) break;
        } else {
          damping *= 10;
          if (damping > 1e8) break;
        }
      }
      const axial = f.local.map((p) =>
        dot(sub(p, current.center), current.axis),
      );
      let lo = Infinity,
        hi = -Infinity;
      for (const z of axial) {
        lo = Math.min(lo, z);
        hi = Math.max(hi, z);
      }
      if (hi - lo <= 1e-6 || Math.abs(parameters[5]!) < 1e-5) continue;
      let baseRadius = parameters[4]! + parameters[5]! * lo,
        topRadius = parameters[4]! + parameters[5]! * hi;
      if (
        Math.min(baseRadius, topRadius) < -1e-6 ||
        Math.max(baseRadius, topRadius) <= 1e-6
      )
        continue;
      let axis = current.axis,
        base = lo;
      if (topRadius > baseRadius) {
        [baseRadius, topRadius] = [topRadius, baseRadius];
        axis = mul(axis, -1);
        base = hi;
      }
      candidates.push(
        errors(positions, {
          kind: "cone",
          center: add(
            f.center,
            mul(add(current.center, mul(current.axis, base)), f.scale),
          ),
          axis,
          radius: baseRadius * f.scale,
          topRadius: Math.max(0, topRadius) * f.scale,
          height: (hi - lo) * f.scale,
          rms: 0,
          maxError: 0,
        }),
      );
    } catch {
      // Rank-deficient initial projections cannot initialize a circular cone.
    }
  }
  if (!candidates.length)
    throw new Error("Insufficient tapered circular cone side samples.");
  const best = candidates.sort((a, b) => a.rms - b.rms)[0]!;
  // Reject numerical attempts to describe planar/cylindrical data as a remote apex.
  if (best.rms > best.radius! * 0.1)
    throw new Error("Samples do not define a circular cone side.");
  return best;
}

export function meshStats(positions: Positions): MeshStats {
  validatePositions(positions, true);
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let j = 0; j < 3; j++) {
      min[j] = Math.min(min[j]!, positions[i + j]!);
      max[j] = Math.max(max[j]!, positions[i + j]!);
    }
  const center = mul(add(min, max), 0.5);
  let area = 0,
    volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i]!,
      ay = positions[i + 1]!,
      az = positions[i + 2]!,
      bx = positions[i + 3]!,
      by = positions[i + 4]!,
      bz = positions[i + 5]!,
      cx = positions[i + 6]!,
      cy = positions[i + 7]!,
      cz = positions[i + 8]!;
    const abx = bx - ax,
      aby = by - ay,
      abz = bz - az,
      acx = cx - ax,
      acy = cy - ay,
      acz = cz - az;
    area +=
      Math.hypot(
        aby * acz - abz * acy,
        abz * acx - abx * acz,
        abx * acy - aby * acx,
      ) / 2;
    const x = ax - center[0],
      y = ay - center[1],
      z = az - center[2],
      ux = bx - center[0],
      uy = by - center[1],
      uz = bz - center[2],
      vx = cx - center[0],
      vy = cy - center[1],
      vz = cz - center[2];
    volume +=
      (x * (uy * vz - uz * vy) +
        y * (uz * vx - ux * vz) +
        z * (ux * vy - uy * vx)) /
      6;
  }
  // Volume is meaningful for closed meshes with consistent winding only.
  return {
    vertices: positions.length / 3,
    triangles: positions.length / 9,
    area,
    volume: Math.abs(volume),
    min,
    max,
    size: sub(max, min),
    center,
  };
}

function validTriangle(positions: Positions, i: number): boolean {
  const abx = positions[i + 3]! - positions[i]!,
    aby = positions[i + 4]! - positions[i + 1]!,
    abz = positions[i + 5]! - positions[i + 2]!,
    acx = positions[i + 6]! - positions[i]!,
    acy = positions[i + 7]! - positions[i + 1]!,
    acz = positions[i + 8]! - positions[i + 2]!;
  const scale = Math.max(
    Math.hypot(abx, aby, abz),
    Math.hypot(acx, acy, acz),
    Math.hypot(acx - abx, acy - aby, acz - abz),
  );
  if (scale <= 0) return false;
  const ux = abx / scale,
    uy = aby / scale,
    uz = abz / scale,
    vx = acx / scale,
    vy = acy / scale,
    vz = acz / scale;
  return (
    Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-12
  );
}

export function cleanupMesh(positions: number[]): number[];
export function cleanupMesh(positions: Float32Array): Float32Array;
export function cleanupMesh(positions: Positions): Positions;
export function cleanupMesh(positions: Positions): Positions {
  validatePositions(positions, true);
  let retained = 0;
  for (let i = 0; i < positions.length; i += 9)
    if (validTriangle(positions, i)) retained += 9;
  const result =
    positions instanceof Float32Array
      ? new Float32Array(retained)
      : new Array<number>(retained);
  let cursor = 0;
  for (let i = 0; i < positions.length; i += 9)
    if (validTriangle(positions, i))
      for (let j = 0; j < 9; j++) result[cursor++] = positions[i + j]!;
  return result;
}

export function transformPositions(
  positions: number[],
  translation: Vec3,
  rotation: Vec3,
  scale: number,
): number[];
export function transformPositions(
  positions: Float32Array,
  translation: Vec3,
  rotation: Vec3,
  scale: number,
): Float32Array;
export function transformPositions(
  positions: Positions,
  translation: Vec3,
  rotation: Vec3,
  scale: number,
): Positions;
export function transformPositions(
  positions: Positions,
  translation: Vec3,
  rotation: Vec3,
  scale: number,
): Positions {
  if (
    ![...translation, ...rotation, scale].every(Number.isFinite) ||
    scale <= 0
  )
    throw new Error("Transform requires finite values and a positive scale.");
  const angles = rotation.map((d) => (d * Math.PI) / 180),
    [sx, sy, sz] = angles.map(Math.sin),
    [cx, cy, cz] = angles.map(Math.cos);
  validatePositions(positions);
  const result =
    positions instanceof Float32Array
      ? new Float32Array(positions.length)
      : new Array<number>(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]! * scale,
      y = positions[i + 1]! * scale,
      z = positions[i + 2]! * scale;
    const y1 = y * cx! - z * sx!,
      z1 = y * sx! + z * cx!;
    const x2 = x * cy! + z1 * sy!,
      z2 = -x * sy! + z1 * cy!;
    result[i] = x2 * cz! - y1 * sz! + translation[0];
    result[i + 1] = x2 * sz! + y1 * cz! + translation[1];
    result[i + 2] = z2 + translation[2];
  }
  return result;
}

export function sectionMesh(
  positions: Positions,
  axis: "x" | "y" | "z",
  offset: number,
  options: {
    includeTriangle?: (slot: number) => boolean;
    onProgress?: (fraction: number, stage: string) => void;
  } = {},
): SectionResult {
  if (!["x", "y", "z"].includes(axis))
    throw new Error("Unsupported section axis.");
  if (!Number.isFinite(offset))
    throw new Error("Section offset must be finite.");
  validatePositions(positions, true);
  const component = { x: 0, y: 1, z: 2 }[axis];
  let bounds = Math.abs(offset);
  for (let i = 0; i < positions.length; i++)
    bounds = Math.max(bounds, Math.abs(positions[i]!));
  const epsilon = Math.max(1e-9, bounds * Number.EPSILON * 32);
  const segments: number[] = [],
    seen = new Set<string>();
  let length = 0;
  for (let i = 0; i < positions.length; i += 9) {
    if (i % (4096 * 9) === 0)
      options.onProgress?.(i / positions.length, "Extracting scan section");
    if (options.includeTriangle && !options.includeTriangle(i / 9)) continue;
    const triangle: Vec3[] = [
      [positions[i]!, positions[i + 1]!, positions[i + 2]!],
      [positions[i + 3]!, positions[i + 4]!, positions[i + 5]!],
      [positions[i + 6]!, positions[i + 7]!, positions[i + 8]!],
    ];
    const hits: Vec3[] = [];
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
  options.onProgress?.(1, "Scan section extracted");
  return { segments, length };
}

/** Center a scan and rotate its principal directions onto a right-handed XYZ frame. */
export function alignPrincipalAxes(positions: Positions): {
  positions: Positions;
  center: Vec3;
  axes: [Vec3, Vec3, Vec3];
} {
  validatePositions(positions);
  const count = positions.length / 3;
  if (count < 3)
    throw new Error("Alignment requires at least three non-collinear points.");
  // Shift the mean calculation away from large world-coordinate origins.
  const origin: Vec3 = [positions[0]!, positions[1]!, positions[2]!],
    center: Vec3 = [...origin];
  for (let j = 0; j < 3; j++) {
    let sum = 0,
      correction = 0;
    for (let i = j; i < positions.length; i += 3) {
      const value = (positions[i]! - origin[j]!) / count - correction;
      const next = sum + value;
      correction = next - sum - value;
      sum = next;
    }
    center[j] = origin[j]! + sum;
  }
  let scale = 0;
  for (let i = 0; i < positions.length; i += 3)
    scale = Math.max(
      scale,
      Math.hypot(
        positions[i]! - center[0],
        positions[i + 1]! - center[1],
        positions[i + 2]! - center[2],
      ),
    );
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("Alignment requires distinct points.");
  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < positions.length; i += 3) {
    const x = (positions[i]! - center[0]) / scale,
      y = (positions[i + 1]! - center[1]) / scale,
      z = (positions[i + 2]! - center[2]) / scale;
    covariance[0]![0]! += (x * x) / count;
    covariance[0]![1]! += (x * y) / count;
    covariance[0]![2]! += (x * z) / count;
    covariance[1]![1]! += (y * y) / count;
    covariance[1]![2]! += (y * z) / count;
    covariance[2]![2]! += (z * z) / count;
  }
  covariance[1]![0] = covariance[0]![1]!;
  covariance[2]![0] = covariance[0]![2]!;
  covariance[2]![1] = covariance[1]![2]!;
  const eigen = eigenvectors(covariance);
  if (eigen[1]!.value < 1e-12)
    throw new Error("Collinear points cannot define an alignment frame.");
  const axes: [Vec3, Vec3, Vec3] = [
    eigen[2]!.axis,
    eigen[1]!.axis,
    unit(cross(eigen[2]!.axis, eigen[1]!.axis)),
  ];
  const result =
    positions instanceof Float32Array
      ? new Float32Array(positions.length)
      : new Array<number>(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]! - center[0],
      y = positions[i + 1]! - center[1],
      z = positions[i + 2]! - center[2];
    for (let j = 0; j < 3; j++)
      result[i + j] = x * axes[j]![0] + y * axes[j]![1] + z * axes[j]![2];
  }
  return { positions: result, center, axes };
}

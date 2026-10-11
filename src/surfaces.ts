import type { Positions, Vec3 } from "./types";

/** Row-major tensor surface: index = v * countU + u. Coordinates are millimetres. */
export interface NurbsPatch {
  format: "scanforge-nurbs";
  version: 1;
  countU: number;
  countV: number;
  degreeU: number;
  degreeV: number;
  knotsU: number[];
  knotsV: number[];
  points: Vec3[];
  weights: number[];
}
export interface SurfaceFitOptions {
  countU: number;
  countV: number;
  degree?: number;
  projection: "xy" | "xz" | "yz";
  sampleLimit: number;
}
export interface SurfaceFitResult {
  patch: NurbsPatch;
  samples: number;
  rms: number;
  maxError: number;
  projection: SurfaceFitOptions["projection"];
  solverBytes: number;
}

function integer(value: number, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
}
function validateKnots(knots: number[], count: number, degree: number) {
  if (
    knots.length !== count + degree + 1 ||
    knots.some((x) => !Number.isFinite(x))
  )
    throw new Error("Knot vector length or values are invalid.");
  for (let i = 1; i < knots.length; i++)
    if (knots[i] < knots[i - 1])
      throw new Error("Knots must be nondecreasing.");
  if (!(knots[count] > knots[degree])) throw new Error("Knot domain is empty.");
  let run = 1;
  for (let i = 1; i < knots.length; i++) {
    run = knots[i] === knots[i - 1] ? run + 1 : 1;
    if (run > degree + 1)
      throw new Error("Knot multiplicity exceeds degree + 1.");
  }
}
export function validatePatch(patch: NurbsPatch): void {
  if (patch.format !== "scanforge-nurbs" || patch.version !== 1)
    throw new Error("Unsupported NURBS patch format.");
  integer(patch.countU, 2, 16, "U controls");
  integer(patch.countV, 2, 16, "V controls");
  integer(patch.degreeU, 1, Math.min(5, patch.countU - 1), "U degree");
  integer(patch.degreeV, 1, Math.min(5, patch.countV - 1), "V degree");
  validateKnots(patch.knotsU, patch.countU, patch.degreeU);
  validateKnots(patch.knotsV, patch.countV, patch.degreeV);
  const count = patch.countU * patch.countV;
  if (patch.points.length !== count || patch.weights.length !== count)
    throw new Error("Control point and weight counts do not match the grid.");
  if (
    patch.points.some(
      (p) => p.length !== 3 || p.some((x) => !Number.isFinite(x)),
    )
  )
    throw new Error("Control points must have three finite coordinates.");
  if (patch.weights.some((w) => !Number.isFinite(w) || w <= 0))
    throw new Error("Rational weights must be finite and positive.");
}
export function clampedKnots(count: number, degree: number): number[] {
  integer(count, 2, 16, "Controls");
  integer(degree, 1, Math.min(5, count - 1), "Degree");
  return Array.from({ length: count + degree + 1 }, (_, i) =>
    i <= degree ? 0 : i >= count ? 1 : (i - degree) / (count - degree),
  );
}

function basis(
  knots: number[],
  count: number,
  degree: number,
  t: number,
): Float64Array {
  const start = knots[degree],
    end = knots[count];
  if (!Number.isFinite(t) || t < start || t > end)
    throw new Error("Surface parameter lies outside its knot domain.");
  let span = count - 1;
  if (t !== end) {
    let lo = degree,
      hi = count;
    while (hi - lo > 1) {
      const mid = (hi + lo) >> 1;
      if (t < knots[mid]) hi = mid;
      else lo = mid;
    }
    span = lo;
  }
  const values = new Float64Array(degree + 1);
  const left = new Float64Array(degree + 1),
    right = new Float64Array(degree + 1);
  values[0] = 1;
  for (let j = 1; j <= degree; j++) {
    left[j] = t - knots[span + 1 - j];
    right[j] = knots[span + j] - t;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denominator = right[r + 1] + left[j - r];
      const temp = denominator === 0 ? 0 : values[r] / denominator;
      values[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    values[j] = saved;
  }
  const result = new Float64Array(count);
  for (let j = 0; j <= degree; j++) result[span - degree + j] = values[j];
  return result;
}
function evaluateUnchecked(patch: NurbsPatch, u: number, v: number): Vec3 {
  const bu = basis(patch.knotsU, patch.countU, patch.degreeU, u);
  const bv = basis(patch.knotsV, patch.countV, patch.degreeV, v);
  const result: Vec3 = [0, 0, 0];
  let denominator = 0;
  for (let j = 0; j < patch.countV; j++)
    for (let i = 0; i < patch.countU; i++) {
      const index = j * patch.countU + i;
      const weight = bu[i] * bv[j] * patch.weights[index];
      denominator += weight;
      for (let k = 0; k < 3; k++) result[k] += patch.points[index][k] * weight;
    }
  if (!(denominator > 0) || !Number.isFinite(denominator))
    throw new Error("Rational surface denominator is invalid.");
  for (let k = 0; k < 3; k++) result[k] /= denominator;
  if (result.some((x) => !Number.isFinite(x)))
    throw new Error("Surface coordinate overflow.");
  return result;
}
export function evaluatePatch(patch: NurbsPatch, u: number, v: number): Vec3 {
  validatePatch(patch);
  return evaluateUnchecked(patch, u, v);
}
export function createGridPatch(
  countU = 4,
  countV = 4,
  width = 100,
  height = 100,
  degree = 3,
): NurbsPatch {
  integer(degree, 1, 5, "Degree");
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width + height))
    throw new Error("Grid width and height must be finite and positive.");
  const du = Math.min(degree, countU - 1),
    dv = Math.min(degree, countV - 1);
  const knotsU = clampedKnots(countU, du),
    knotsV = clampedKnots(countV, dv);
  // Greville coordinates make the initial surface a linear planar rectangle.
  const greville = (knots: number[], d: number, i: number) =>
    knots.slice(i + 1, i + d + 1).reduce((sum, x) => sum + x, 0) / d;
  const patch: NurbsPatch = {
    format: "scanforge-nurbs",
    version: 1,
    countU,
    countV,
    degreeU: du,
    degreeV: dv,
    knotsU,
    knotsV,
    points: Array.from({ length: countU * countV }, (_, index) => [
      width * greville(knotsU, du, index % countU),
      height * greville(knotsV, dv, Math.floor(index / countU)),
      0,
    ]),
    weights: Array(countU * countV).fill(1),
  };
  validatePatch(patch);
  return patch;
}
export function editControlPoint(
  patch: NurbsPatch,
  index: number,
  point: Vec3,
  weight: number,
): NurbsPatch {
  validatePatch(patch);
  integer(index, 0, patch.points.length - 1, "Control index");
  const next = {
    ...patch,
    points: patch.points.map((p, i) =>
      i === index ? ([...point] as Vec3) : ([...p] as Vec3),
    ),
    weights: patch.weights.map((w, i) => (i === index ? weight : w)),
  };
  validatePatch(next);
  return next;
}
export function snapControlPoint(
  patch: NurbsPatch,
  index: number,
  scan: Positions,
): NurbsPatch {
  validatePatch(patch);
  integer(index, 0, patch.points.length - 1, "Control index");
  if (!scan.length || scan.length % 3)
    throw new Error("Scan must contain complete vertices.");
  const target = patch.points[index];
  let best = Infinity;
  let nearest: Vec3 | undefined;
  for (let i = 0; i < scan.length; i += 3) {
    const p: Vec3 = [scan[i], scan[i + 1], scan[i + 2]];
    if (p.some((x) => !Number.isFinite(x)))
      throw new Error("Scan contains nonfinite coordinates.");
    const distance =
      (p[0] - target[0]) ** 2 +
      (p[1] - target[1]) ** 2 +
      (p[2] - target[2]) ** 2;
    if (distance < best) {
      best = distance;
      nearest = p;
    }
  }
  if (!nearest) throw new Error("Scan coordinates exceed the distance range.");
  return editControlPoint(patch, index, nearest, patch.weights[index]);
}
export function tessellatePatch(
  patch: NurbsPatch,
  segmentsU = 32,
  segmentsV = 32,
): Float32Array {
  validatePatch(patch);
  integer(segmentsU, 1, 1024, "U tessellation segments");
  integer(segmentsV, 1, 1024, "V tessellation segments");
  const grid: Vec3[] = [];
  const u0 = patch.knotsU[patch.degreeU],
    u1 = patch.knotsU[patch.countU];
  const v0 = patch.knotsV[patch.degreeV],
    v1 = patch.knotsV[patch.countV];
  for (let j = 0; j <= segmentsV; j++)
    for (let i = 0; i <= segmentsU; i++)
      grid.push(
        evaluateUnchecked(
          patch,
          u0 + ((u1 - u0) * i) / segmentsU,
          v0 + ((v1 - v0) * j) / segmentsV,
        ),
      );
  const result = new Float32Array(segmentsU * segmentsV * 18);
  let offset = 0;
  for (let j = 0; j < segmentsV; j++)
    for (let i = 0; i < segmentsU; i++) {
      const a = j * (segmentsU + 1) + i,
        b = a + 1,
        c = a + segmentsU + 1,
        d = c + 1;
      for (const index of [a, b, c, b, d, c])
        for (const value of grid[index]) {
          result[offset++] = value;
          if (!Number.isFinite(result[offset - 1]))
            throw new Error("Surface exceeds Float32 mesh range.");
        }
    }
  return result;
}

/** Least-squares height-field recovery. This cannot model overhangs or closed surfaces. */
export function fitGridSurface(
  scan: Positions | Float64Array,
  options: SurfaceFitOptions,
): SurfaceFitResult {
  integer(options.sampleLimit, 16, 100000, "Fit sample limit");
  if (!scan.length || scan.length % 3)
    throw new Error("Scan must contain complete vertices.");
  const axes =
    options.projection === "xy"
      ? [0, 1, 2]
      : options.projection === "xz"
        ? [0, 2, 1]
        : options.projection === "yz"
          ? [1, 2, 0]
          : null;
  if (!axes) throw new Error("Choose XY, XZ or YZ projection.");
  const patch = createGridPatch(
    options.countU,
    options.countV,
    1,
    1,
    options.degree ?? 3,
  );
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < scan.length; i++) {
    const value = scan[i],
      k = i % 3;
    if (!Number.isFinite(value))
      throw new Error("Scan contains nonfinite coordinates.");
    min[k] = Math.min(min[k], value);
    max[k] = Math.max(max[k], value);
  }
  const [x, y, z] = axes;
  const width = max[x] - min[x],
    height = max[y] - min[y];
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width + height))
    throw new Error("Projection must span two finite spatial dimensions.");
  const samples = Math.min(options.sampleLimit, scan.length / 3),
    n = patch.points.length;
  if (samples < n)
    throw new Error(
      "Sample limit must cover at least all control coefficients.",
    );
  const normal = new Float64Array(n * n),
    rhs = new Float64Array(n);
  const sampled = new Float64Array(samples * 3);
  for (let s = 0; s < samples; s++) {
    const at =
      Math.floor((s * (scan.length / 3 - 1)) / Math.max(1, samples - 1)) * 3;
    const u = (scan[at + x] - min[x]) / width,
      v = (scan[at + y] - min[y]) / height,
      h = scan[at + z] - min[z];
    sampled.set([u, v, h], s * 3);
    const bu = basis(patch.knotsU, patch.countU, patch.degreeU, u),
      bv = basis(patch.knotsV, patch.countV, patch.degreeV, v);
    const active: [number, number][] = [];
    for (let j = 0; j < patch.countV; j++)
      for (let i = 0; i < patch.countU; i++) {
        const value = bu[i] * bv[j];
        if (value) active.push([j * patch.countU + i, value]);
      }
    for (const [i, a] of active) {
      rhs[i] += a * h;
      for (const [j, b] of active) normal[i * n + j] += a * b;
    }
  }
  let scale = 0;
  for (const value of normal) scale = Math.max(scale, Math.abs(value));
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++)
      if (Math.abs(normal[i * n + k]) > Math.abs(normal[pivot * n + k]))
        pivot = i;
    if (Math.abs(normal[pivot * n + k]) <= scale * 1e-11)
      throw new Error(
        "Samples do not constrain this grid. Lower control resolution or increase sampling.",
      );
    if (pivot !== k) {
      for (let j = k; j < n; j++)
        [normal[k * n + j], normal[pivot * n + j]] = [
          normal[pivot * n + j],
          normal[k * n + j],
        ];
      [rhs[k], rhs[pivot]] = [rhs[pivot], rhs[k]];
    }
    for (let i = k + 1; i < n; i++) {
      const factor = normal[i * n + k] / normal[k * n + k];
      for (let j = k + 1; j < n; j++)
        normal[i * n + j] -= factor * normal[k * n + j];
      rhs[i] -= factor * rhs[k];
    }
  }
  const coefficients = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let value = rhs[i];
    for (let j = i + 1; j < n; j++)
      value -= normal[i * n + j] * coefficients[j];
    coefficients[i] = value / normal[i * n + i];
  }
  patch.points = patch.points.map((p, i) => {
    const point: Vec3 = [0, 0, 0];
    point[x] = min[x] + p[0] * width;
    point[y] = min[y] + p[1] * height;
    point[z] = min[z] + coefficients[i];
    return point;
  });
  validatePatch(patch);
  let squared = 0,
    maxError = 0;
  for (let s = 0; s < samples; s++) {
    const error = Math.abs(
      evaluateUnchecked(patch, sampled[s * 3], sampled[s * 3 + 1])[z] -
        min[z] -
        sampled[s * 3 + 2],
    );
    squared += error * error;
    maxError = Math.max(maxError, error);
  }
  return {
    patch,
    samples,
    rms: Math.sqrt(squared / samples),
    maxError,
    projection: options.projection,
    solverBytes: (n * n + 2 * n + 3 * samples) * 8,
  };
}
export function serializePatch(patch: NurbsPatch): string {
  validatePatch(patch);
  return JSON.stringify(patch, null, 2);
}
export function parsePatch(text: string): NurbsPatch {
  const patch: NurbsPatch = JSON.parse(text);
  validatePatch(patch);
  return patch;
}

/** Imports only an explicitly ordered rectangular quad grid, not arbitrary quad topology. */
export function importQuadGridObj(
  text: string,
  countU: number,
  countV: number,
  degree = 3,
): NurbsPatch {
  const patch = createGridPatch(countU, countV, 1, 1, degree);
  const vertices: Vec3[] = [],
    faces: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const tokens = raw.replace(/#.*/, "").trim().split(/\s+/);
    if (tokens[0] === "v") {
      if (tokens.length !== 4)
        throw new Error(
          "Grid OBJ vertices require three coordinates without homogeneous weights.",
        );
      const point = tokens.slice(1).map(Number) as Vec3;
      if (point.some((x) => !Number.isFinite(x)))
        throw new Error("Grid OBJ contains invalid coordinates.");
      vertices.push(point);
    } else if (tokens[0] === "f") {
      if (tokens.length !== 5)
        throw new Error("Grid OBJ faces must all be quads.");
      const face = tokens.slice(1).map((token) => {
        const value = Number(token.split("/")[0]);
        if (!Number.isInteger(value) || value === 0)
          throw new Error("Grid OBJ face index is invalid.");
        return value > 0 ? value - 1 : vertices.length + value;
      });
      faces.push(face);
    }
  }
  if (
    vertices.length !== countU * countV ||
    faces.length !== (countU - 1) * (countV - 1)
  )
    throw new Error(
      "Grid OBJ dimensions must match the supplied U/V grid and vertex ordering.",
    );
  const key = (face: number[]) => [...face].sort((a, b) => a - b).join(",");
  const expected = new Set<string>();
  for (let j = 0; j < countV - 1; j++)
    for (let i = 0; i < countU - 1; i++) {
      const a = j * countU + i;
      expected.add(key([a, a + 1, a + countU + 1, a + countU]));
    }
  for (const face of faces) {
    if (!expected.delete(key(face)))
      throw new Error("OBJ is not a rectangular row-major quad grid.");
    // Reject crossed/bow-tie index ordering even when it names the correct four vertices.
    for (let i = 0; i < 4; i++) {
      const a = face[i],
        b = face[(i + 1) % 4];
      if (!(
        Math.abs(a - b) === countU ||
        (Math.abs(a - b) === 1 &&
          Math.floor(a / countU) === Math.floor(b / countU))
      ))
        throw new Error("Grid OBJ face has crossed edges.");
    }
  }
  patch.points = vertices;
  validatePatch(patch);
  return patch;
}

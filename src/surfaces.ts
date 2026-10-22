import type { Positions, Vec3 } from "./types";
import { fitApproximateSurface } from "./surface-approximation";

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
  method?: "projected-grid" | "approximate";
  regularizationWeight?: number;
}
export interface SurfaceFitResult {
  patch: NurbsPatch;
  samples: number;
  rms: number;
  maxError: number;
  projection: SurfaceFitOptions["projection"];
  solverBytes: number;
  method?: "approximate";
  regularizationWeight?: number;
}
export type PatchEdge = "u0" | "u1" | "v0" | "v1";
export type PatchAxis = "u" | "v";

function insertionLocation(
  patch: NurbsPatch,
  axis: PatchAxis,
  parameter: number,
) {
  if (axis !== "u" && axis !== "v")
    throw new Error("Choose U or V refinement.");
  if (!Number.isFinite(parameter) || parameter <= 0 || parameter >= 1)
    throw new Error(
      "Refinement parameter must be strictly inside normalized domain (0, 1).",
    );
  const degree = axis === "u" ? patch.degreeU : patch.degreeV;
  const count = axis === "u" ? patch.countU : patch.countV;
  const knots = axis === "u" ? patch.knotsU : patch.knotsV;
  const start = knots[degree],
    end = knots[count];
  let knot = start + parameter * (end - start);
  // Snap arithmetic roundoff to an existing interior knot before counting multiplicity.
  const existing = knots.find(
    (value) =>
      value > start &&
      value < end &&
      Math.abs(value - knot) <= (end - start) * 1e-12,
  );
  if (existing !== undefined) knot = existing;
  if (!(knot > start && knot < end))
    throw new Error("Refinement parameter rounds to a domain endpoint.");
  const multiplicity = knots.filter((value) => value === knot).length;
  let span = degree;
  while (span + 1 < count && knots[span + 1] <= knot) span++;
  return { degree, count, knots, knot, multiplicity, span };
}

/** Exact homogeneous Boehm knot insertion. Parameter uses normalized active domain. */
export function insertPatchKnot(
  patch: NurbsPatch,
  axis: PatchAxis,
  parameter: number,
  repetitions = 1,
): NurbsPatch {
  validatePatch(patch);
  const location = insertionLocation(patch, axis, parameter);
  integer(repetitions, 1, location.degree, "Knot insertion count");
  if (location.count + repetitions > 16)
    throw new Error("Refinement exceeds the 16-control limit on this axis.");
  if (location.multiplicity + repetitions > location.degree)
    throw new Error(
      "Interior knot multiplicity cannot exceed degree during refinement.",
    );
  let next = patch;
  for (let repeat = 0; repeat < repetitions; repeat++) {
    const { degree, count, knots, knot, multiplicity, span } =
      insertionLocation(next, axis, parameter);
    const newCountU = next.countU + (axis === "u" ? 1 : 0),
      newCountV = next.countV + (axis === "v" ? 1 : 0);
    const points = new Array<Vec3>(newCountU * newCountV),
      weights = new Array<number>(points.length);
    const curves = axis === "u" ? next.countV : next.countU;
    for (let curve = 0; curve < curves; curve++) {
      const controls = Array.from({ length: count }, (_, i) => {
        const index =
          axis === "u" ? curve * next.countU + i : i * next.countU + curve;
        const weight = next.weights[index],
          point = next.points[index];
        return [
          point[0] * weight,
          point[1] * weight,
          point[2] * weight,
          weight,
        ];
      });
      const refined = new Array<number[]>(count + 1);
      for (let i = 0; i <= span - degree; i++) refined[i] = controls[i];
      for (let i = span - multiplicity; i < count; i++)
        refined[i + 1] = controls[i];
      for (let i = span - degree + 1; i <= span - multiplicity; i++) {
        const denominator = knots[i + degree] - knots[i];
        if (!(denominator > 0))
          throw new Error(
            "Refinement encountered an empty blending knot span.",
          );
        const alpha = (knot - knots[i]) / denominator;
        refined[i] = controls[i].map(
          (value, k) => alpha * value + (1 - alpha) * controls[i - 1][k],
        );
      }
      for (let i = 0; i <= count; i++) {
        const index =
          axis === "u" ? curve * newCountU + i : i * newCountU + curve;
        const control = refined[i],
          weight = control[3];
        weights[index] = weight;
        points[index] = [
          control[0] / weight,
          control[1] / weight,
          control[2] / weight,
        ];
      }
    }
    const newKnots = [
      ...knots.slice(0, span + 1),
      knot,
      ...knots.slice(span + 1),
    ];
    next = {
      ...next,
      countU: newCountU,
      countV: newCountV,
      points,
      weights,
      ...(axis === "u" ? { knotsU: newKnots } : { knotsV: newKnots }),
    };
    validatePatch(next);
  }
  return next;
}

/** Raises an interior knot to degree multiplicity; shape is unchanged until controls move. */
export function preparePatchCrease(
  patch: NurbsPatch,
  axis: PatchAxis,
  parameter: number,
): NurbsPatch {
  validatePatch(patch);
  const { degree, multiplicity } = insertionLocation(patch, axis, parameter);
  if (multiplicity >= degree)
    throw new Error("This interior knot is already at crease multiplicity.");
  return insertPatchKnot(patch, axis, parameter, degree - multiplicity);
}
export interface PatchJoinOptions {
  referenceEdge: PatchEdge;
  targetEdge: PatchEdge;
  continuity: "C0" | "C1";
  reverse?: boolean;
}

function edgeDescription(patch: NurbsPatch, edge: PatchEdge) {
  if (!["u0", "u1", "v0", "v1"].includes(edge))
    throw new Error("Choose a valid patch boundary.");
  const uEdge = edge.startsWith("u"),
    atEnd = edge.endsWith("1");
  const count = uEdge ? patch.countU : patch.countV;
  const degree = uEdge ? patch.degreeU : patch.degreeV;
  const knots = uEdge ? patch.knotsU : patch.knotsV;
  const start = knots[degree],
    end = knots[count];
  const boundary = atEnd ? count - 1 : 0,
    inner = atEnd ? count - 2 : 1;
  const knotIndex = atEnd ? count : degree;
  for (let i = 0; i <= degree; i++) {
    const index = atEnd ? knotIndex + i : knotIndex - i;
    if (knots[index] !== (atEnd ? end : start))
      throw new Error("Joined boundaries must have clamped transverse knots.");
  }
  const span = atEnd ? end - knots[count - 1] : knots[degree + 1] - start;
  if (!(span > 0)) throw new Error("Boundary derivative knot span is empty.");
  const alongCount = uEdge ? patch.countV : patch.countU;
  const alongDegree = uEdge ? patch.degreeV : patch.degreeU;
  const alongKnots = uEdge ? patch.knotsV : patch.knotsU;
  const alongStart = alongKnots[alongDegree],
    alongEnd = alongKnots[alongCount];
  return {
    alongCount,
    alongDegree,
    normalizedKnots: alongKnots.map(
      (knot) => (knot - alongStart) / (alongEnd - alongStart),
    ),
    derivativeFactor: (degree * (end - start)) / span,
    boundary: Array.from({ length: alongCount }, (_, i) =>
      uEdge ? i * patch.countU + boundary : boundary * patch.countU + i,
    ),
    inner: Array.from({ length: alongCount }, (_, i) =>
      uEdge ? i * patch.countU + inner : inner * patch.countU + i,
    ),
  };
}

/** Moves only the target seam and, for C1, its adjacent row. Reference remains fixed.
 * C1 matches homogeneous derivatives across normalized transverse parameters.
 * Compatible seam degree/control count/normalized knots are required; no refitting occurs.
 */
export function joinPatchBoundary(
  reference: NurbsPatch,
  target: NurbsPatch,
  options: PatchJoinOptions,
): NurbsPatch {
  validatePatch(reference);
  validatePatch(target);
  if (options.continuity !== "C0" && options.continuity !== "C1")
    throw new Error("Choose C0 or C1 continuity.");
  const a = edgeDescription(reference, options.referenceEdge),
    b = edgeDescription(target, options.targetEdge);
  const alongKnots = options.reverse
    ? [...a.normalizedKnots].reverse().map((knot) => 1 - knot)
    : a.normalizedKnots;
  if (
    a.alongCount !== b.alongCount ||
    a.alongDegree !== b.alongDegree ||
    alongKnots.length !== b.normalizedKnots.length ||
    alongKnots.some((knot, i) => Math.abs(knot - b.normalizedKnots[i]) > 1e-12)
  )
    throw new Error(
      "Patch seam control counts, degrees and normalized knots must be compatible.",
    );
  const next: NurbsPatch = {
    ...target,
    points: target.points.map((point) => [...point] as Vec3),
    weights: [...target.weights],
  };
  for (let i = 0; i < b.alongCount; i++) {
    const source = options.reverse ? a.alongCount - 1 - i : i;
    const edgeA = a.boundary[source],
      innerA = a.inner[source],
      edgeB = b.boundary[i],
      innerB = b.inner[i];
    next.points[edgeB] = [...reference.points[edgeA]];
    next.weights[edgeB] = reference.weights[edgeA];
    if (options.continuity === "C1") {
      const factor = a.derivativeFactor / b.derivativeFactor;
      const seamWeight = reference.weights[edgeA],
        innerWeight = reference.weights[innerA];
      const weight = seamWeight - factor * (innerWeight - seamWeight);
      if (!Number.isFinite(weight) || weight <= 0)
        throw new Error(
          "C1 join requires nonpositive or overflowing rational weights. Adjust reference weights or transverse spans first.",
        );
      next.weights[innerB] = weight;
      next.points[innerB] = reference.points[edgeA].map(
        (coordinate, k) =>
          (coordinate * seamWeight -
            factor *
              (reference.points[innerA][k] * innerWeight -
                coordinate * seamWeight)) /
          weight,
      ) as Vec3;
    }
  }
  validatePatch(next);
  return next;
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
  oneSidedSpan?: number,
): Float64Array {
  const start = knots[degree],
    end = knots[count];
  if (!Number.isFinite(t) || t < start || t > end)
    throw new Error("Surface parameter lies outside its knot domain.");
  let span = count - 1;
  if (oneSidedSpan !== undefined) {
    if (
      !Number.isInteger(oneSidedSpan) ||
      oneSidedSpan < degree ||
      oneSidedSpan >= count ||
      !(knots[oneSidedSpan] < knots[oneSidedSpan + 1]) ||
      t < knots[oneSidedSpan] ||
      t > knots[oneSidedSpan + 1]
    )
      throw new Error("One-sided surface span is invalid.");
    span = oneSidedSpan;
  } else if (t !== end) {
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
function evaluateUnchecked(
  patch: NurbsPatch,
  u: number,
  v: number,
  uSpan?: number,
  vSpan?: number,
): Vec3 {
  const bu = basis(patch.knotsU, patch.countU, patch.degreeU, u, uSpan);
  const bv = basis(patch.knotsV, patch.countV, patch.degreeV, v, vSpan);
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
function fullMultiplicityBreaks(
  knots: number[],
  count: number,
  degree: number,
) {
  const start = knots[degree],
    end = knots[count],
    breaks: number[] = [];
  for (let first = 0; first < knots.length;) {
    let last = first + 1;
    while (last < knots.length && knots[last] === knots[first]) last++;
    if (
      last - first === degree + 1 &&
      knots[first] > start &&
      knots[first] < end
    )
      breaks.push(knots[first]);
    first = last;
  }
  return breaks;
}

interface TessellationInterval {
  parameters: number[];
  startSpan: number;
  endSpan: number;
}

function tessellationIntervals(
  knots: number[],
  count: number,
  degree: number,
  segments: number,
  breaks: number[],
): TessellationInterval[] {
  const start = knots[degree],
    end = knots[count];
  const uniform = Array.from(
    { length: segments + 1 },
    (_, i) => start + ((end - start) * i) / segments,
  );
  if (uniform.some((value) => !Number.isFinite(value)))
    throw new Error("Surface parameter lies outside its knot domain.");
  const boundarySpan = (parameter: number, right: boolean) => {
    for (let span = degree; span < count; span++)
      if (
        knots[span] < knots[span + 1] &&
        (right ? knots[span] === parameter : knots[span + 1] === parameter)
      )
        return span;
    throw new Error("One-sided surface boundary has no nonempty span.");
  };
  const bounds = [start, ...breaks, end];
  return bounds.slice(0, -1).map((lower, index) => {
    const upper = bounds[index + 1],
      parameters = [lower];
    for (const value of uniform)
      if (value > lower && value < upper && value !== parameters.at(-1))
        parameters.push(value);
    parameters.push(upper);
    return {
      parameters,
      startSpan: boundarySpan(lower, true),
      endSpan: boundarySpan(upper, false),
    };
  });
}

function tessellateDiscontinuousPatch(
  patch: NurbsPatch,
  segmentsU: number,
  segmentsV: number,
  breaksU: number[],
  breaksV: number[],
): Float32Array {
  const us = tessellationIntervals(
    patch.knotsU,
    patch.countU,
    patch.degreeU,
    segmentsU,
    breaksU,
  );
  const vs = tessellationIntervals(
    patch.knotsV,
    patch.countV,
    patch.degreeV,
    segmentsV,
    breaksV,
  );
  const cellsU = us.reduce(
    (sum, region) => sum + region.parameters.length - 1,
    0,
  );
  const cellsV = vs.reduce(
    (sum, region) => sum + region.parameters.length - 1,
    0,
  );
  const scalars = cellsU * cellsV * 18;
  // Each off-grid break adds at most one cell to the original bounded axis grid.
  if (
    cellsU > segmentsU + breaksU.length ||
    cellsV > segmentsV + breaksV.length ||
    !Number.isSafeInteger(scalars) ||
    scalars <= 0
  )
    throw new Error(
      "Discontinuous surface tessellation exceeds its grid bounds.",
    );
  const result = new Float32Array(scalars);
  let offset = 0;
  for (const v of vs)
    for (const u of us) {
      const grid: Vec3[] = [];
      for (let j = 0; j < v.parameters.length; j++)
        for (let i = 0; i < u.parameters.length; i++)
          grid.push(
            evaluateUnchecked(
              patch,
              u.parameters[i],
              v.parameters[j],
              i === 0
                ? u.startSpan
                : i === u.parameters.length - 1
                  ? u.endSpan
                  : undefined,
              j === 0
                ? v.startSpan
                : j === v.parameters.length - 1
                  ? v.endSpan
                  : undefined,
            ),
          );
      for (let j = 0; j < v.parameters.length - 1; j++)
        for (let i = 0; i < u.parameters.length - 1; i++) {
          const a = j * u.parameters.length + i,
            b = a + 1,
            c = a + u.parameters.length,
            d = c + 1;
          for (const index of [a, b, c, b, d, c])
            for (const value of grid[index]) {
              result[offset++] = value;
              if (!Number.isFinite(result[offset - 1]))
                throw new Error("Surface exceeds Float32 mesh range.");
            }
        }
    }
  return result;
}

export function tessellatePatch(
  patch: NurbsPatch,
  segmentsU = 32,
  segmentsV = 32,
): Float32Array {
  validatePatch(patch);
  integer(segmentsU, 1, 1024, "U tessellation segments");
  integer(segmentsV, 1, 1024, "V tessellation segments");
  const breaksU = fullMultiplicityBreaks(
    patch.knotsU,
    patch.countU,
    patch.degreeU,
  );
  const breaksV = fullMultiplicityBreaks(
    patch.knotsV,
    patch.countV,
    patch.degreeV,
  );
  if (breaksU.length || breaksV.length)
    return tessellateDiscontinuousPatch(
      patch,
      segmentsU,
      segmentsV,
      breaksU,
      breaksV,
    );
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
  if (
    options.method !== undefined &&
    options.method !== "projected-grid" &&
    options.method !== "approximate"
  )
    throw new Error("Choose projected-grid or approximate surface fitting.");
  if (
    options.method !== "approximate" &&
    options.regularizationWeight !== undefined
  )
    throw new Error(
      "Regularization weight requires approximate surface fitting.",
    );
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
  if (options.method === "approximate") {
    const result = fitApproximateSurface(
      scan,
      options,
      patch,
      axes,
      min,
      width,
      height,
      samples,
    );
    validatePatch(result.patch);
    return result;
  }
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

export interface PatchShellOptions {
  segments: number;
  weldTolerance: number;
  /** Explicit operation budget, not an input-file-size limit. */
  triangleBudget: number;
  orient?: boolean;
}
export interface PatchShellDiagnostics {
  vertices: number;
  triangles: number;
  components: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  nonManifoldVertices: number;
  inconsistentEdges: number;
  degenerateTriangles: number;
  duplicateTriangles: number;
  flippedTriangles: number;
  closed: boolean;
  signedVolume: number | null;
}
export interface PatchShellResult {
  positions: Float32Array;
  diagnostics: PatchShellDiagnostics;
}

/** Six outward-oriented bilinear patches, useful as an editable closed shell seed. */
export function createBoxPatchShell(
  width: number,
  height: number,
  depth: number,
): NurbsPatch[] {
  if (
    [width, height, depth].some(
      (value) => !Number.isFinite(value) || value <= 0,
    )
  )
    throw new Error("Shell dimensions must be finite and positive.");
  const faces: Vec3[][] = [
    [
      [0, height, 0],
      [width, height, 0],
      [0, 0, 0],
      [width, 0, 0],
    ],
    [
      [0, 0, depth],
      [width, 0, depth],
      [0, height, depth],
      [width, height, depth],
    ],
    [
      [0, 0, 0],
      [0, 0, depth],
      [0, height, 0],
      [0, height, depth],
    ],
    [
      [width, 0, 0],
      [width, height, 0],
      [width, 0, depth],
      [width, height, depth],
    ],
    [
      [0, 0, 0],
      [width, 0, 0],
      [0, 0, depth],
      [width, 0, depth],
    ],
    [
      [0, height, 0],
      [0, height, depth],
      [width, height, 0],
      [width, height, depth],
    ],
  ];
  return faces.map((points) => ({ ...createGridPatch(2, 2, 1, 1, 1), points }));
}

/** Welds supplied patch tessellations and proves edge/vertex manifold incidence.
 * Geometric self-intersection and nested cavity orientation are NOT checked.
 * Each connected closed component is oriented outward independently.
 */
export function assemblePatchShell(
  patches: NurbsPatch[],
  options: PatchShellOptions,
): PatchShellResult {
  if (!patches.length) throw new Error("Provide at least one surface patch.");
  patches.forEach(validatePatch);
  integer(options.segments, 1, 128, "Shell tessellation segments");
  integer(options.triangleBudget, 1, 2000000, "Shell triangle budget");
  const tolerance = options.weldTolerance;
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Weld tolerance must be finite and positive.");
  let requestedTriangles = 0;
  for (const patch of patches) {
    const breaksU = fullMultiplicityBreaks(
      patch.knotsU,
      patch.countU,
      patch.degreeU,
    );
    const breaksV = fullMultiplicityBreaks(
      patch.knotsV,
      patch.countV,
      patch.degreeV,
    );
    const cells = (
      knots: number[],
      count: number,
      degree: number,
      breaks: number[],
    ) =>
      tessellationIntervals(
        knots,
        count,
        degree,
        options.segments,
        breaks,
      ).reduce((sum, region) => sum + region.parameters.length - 1, 0);
    const cellsU =
      breaksU.length || breaksV.length
        ? cells(patch.knotsU, patch.countU, patch.degreeU, breaksU)
        : options.segments;
    const cellsV =
      breaksU.length || breaksV.length
        ? cells(patch.knotsV, patch.countV, patch.degreeV, breaksV)
        : options.segments;
    requestedTriangles += cellsU * cellsV * 2;
    if (requestedTriangles > options.triangleBudget) break;
  }
  if (requestedTriangles > options.triangleBudget)
    throw new Error(
      "Shell tessellation exceeds the configured triangle budget. Lower segments or increase the operation budget.",
    );
  const vertices: Vec3[] = [],
    cells = new Map<string, number[]>(),
    triangles: [number, number, number][] = [];
  let degenerateTriangles = 0,
    duplicateTriangles = 0;
  const faceKeys = new Set<string>();
  const weld = (point: Vec3) => {
    const cell = point.map((value) => Math.floor(value / tolerance));
    if (cell.some((value) => !Number.isSafeInteger(value)))
      throw new Error(
        "Weld tolerance is too small for the coordinate magnitude.",
      );
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          const candidates = cells.get(
            `${cell[0] + x},${cell[1] + y},${cell[2] + z}`,
          );
          if (!candidates) continue;
          for (const index of candidates) {
            const other = vertices[index];
            if (
              Math.hypot(
                point[0] - other[0],
                point[1] - other[1],
                point[2] - other[2],
              ) <= tolerance
            )
              return index;
          }
        }
    const index = vertices.length;
    vertices.push(point);
    const key = cell.join(","),
      bucket = cells.get(key);
    if (bucket) bucket.push(index);
    else cells.set(key, [index]);
    return index;
  };
  for (const patch of patches) {
    const mesh = tessellatePatch(patch, options.segments, options.segments);
    for (let i = 0; i < mesh.length; i += 9) {
      const face = [
        weld([mesh[i], mesh[i + 1], mesh[i + 2]]),
        weld([mesh[i + 3], mesh[i + 4], mesh[i + 5]]),
        weld([mesh[i + 6], mesh[i + 7], mesh[i + 8]]),
      ] as [number, number, number];
      const a = vertices[face[0]],
        b = vertices[face[1]],
        c = vertices[face[2]];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const area = Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      );
      if (new Set(face).size < 3 || !(area > 0)) {
        degenerateTriangles++;
        continue;
      }
      const key = [...face].sort((x, y) => x - y).join(",");
      if (faceKeys.has(key)) duplicateTriangles++;
      else faceKeys.add(key);
      triangles.push(face);
    }
  }
  type EdgeUse = { triangle: number; direction: number };
  const edges = new Map<string, EdgeUse[]>(),
    incidence: number[][] = Array.from({ length: vertices.length }, () => []);
  triangles.forEach((face, triangle) => {
    for (const vertex of face) incidence[vertex].push(triangle);
    for (let k = 0; k < 3; k++) {
      const a = face[k],
        b = face[(k + 1) % 3],
        key = `${Math.min(a, b)},${Math.max(a, b)}`;
      const use = { triangle, direction: a < b ? 1 : -1 },
        list = edges.get(key);
      if (list) list.push(use);
      else edges.set(key, [use]);
    }
  });
  let boundaryEdges = 0,
    nonManifoldEdges = 0,
    nonManifoldVertices = 0;
  const adjacency: { triangle: number; same: boolean }[][] = Array.from(
    { length: triangles.length },
    () => [],
  );
  for (const uses of edges.values()) {
    if (uses.length === 1) boundaryEdges++;
    if (uses.length > 2) nonManifoldEdges++;
    for (let i = 1; i < uses.length; i++) {
      const a = uses[0],
        b = uses[i],
        same = a.direction === b.direction;
      adjacency[a.triangle].push({ triangle: b.triangle, same });
      adjacency[b.triangle].push({ triangle: a.triangle, same });
    }
  }
  // A closed manifold vertex link must be one cycle, not two sheets touching at one point.
  incidence.forEach((faces, vertex) => {
    if (!faces.length) return;
    const link = new Map<number, Set<number>>();
    for (const triangle of faces) {
      const others = triangles[triangle].filter((index) => index !== vertex);
      for (let i = 0; i < 2; i++) {
        const list = link.get(others[i]);
        if (list) list.add(others[1 - i]);
        else link.set(others[i], new Set([others[1 - i]]));
      }
    }
    const seen = new Set<number>(),
      queue = [link.keys().next().value!];
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      if (seen.has(node)) continue;
      seen.add(node);
      for (const other of link.get(node) ?? [])
        if (!seen.has(other)) queue.push(other);
    }
    // Boundary links may form a path: edge diagnostics already mark those shells open.
    if (
      seen.size !== link.size ||
      [...link.values()].some((neighbors) => neighbors.size > 2)
    )
      nonManifoldVertices++;
  });
  const flips = new Int8Array(triangles.length);
  flips.fill(-1);
  const components: number[][] = [];
  for (let seed = 0; seed < triangles.length; seed++) {
    if (flips[seed] !== -1) continue;
    const component = [seed];
    flips[seed] = 0;
    for (let i = 0; i < component.length; i++)
      for (const neighbor of adjacency[component[i]]) {
        if (flips[neighbor.triangle] !== -1) continue;
        flips[neighbor.triangle] = flips[component[i]] ^ Number(neighbor.same);
        component.push(neighbor.triangle);
      }
    components.push(component);
  }
  if (options.orient !== false)
    triangles.forEach((face, i) => {
      if (flips[i]) [face[1], face[2]] = [face[2], face[1]];
    });
  let inconsistentEdges = 0;
  for (const uses of edges.values())
    if (uses.length === 2) {
      const [a, b] = uses;
      const signA =
          a.direction *
          (options.orient !== false && flips[a.triangle] ? -1 : 1),
        signB =
          b.direction *
          (options.orient !== false && flips[b.triangle] ? -1 : 1);
      if (signA === signB) inconsistentEdges++;
    }
  const closed =
    triangles.length > 0 &&
    boundaryEdges === 0 &&
    nonManifoldEdges === 0 &&
    nonManifoldVertices === 0 &&
    inconsistentEdges === 0 &&
    duplicateTriangles === 0;
  let signedVolume: number | null = null;
  if (closed) {
    signedVolume = 0;
    for (const component of components) {
      const origin = vertices[triangles[component[0]][0]];
      let volume = 0;
      for (const index of component) {
        const [a, b, c] = triangles[index].map((vertex) =>
          vertices[vertex].map((value, k) => value - origin[k]),
        );
        volume +=
          (a[0] * (b[1] * c[2] - b[2] * c[1]) +
            a[1] * (b[2] * c[0] - b[0] * c[2]) +
            a[2] * (b[0] * c[1] - b[1] * c[0])) /
          6;
      }
      if (volume < 0 && options.orient !== false) {
        for (const index of component) {
          const face = triangles[index];
          [face[1], face[2]] = [face[2], face[1]];
          flips[index] ^= 1;
        }
        volume = -volume;
      }
      signedVolume += volume;
    }
  }
  const positions = new Float32Array(triangles.length * 9);
  let offset = 0;
  for (const face of triangles)
    for (const vertex of face)
      for (const value of vertices[vertex]) positions[offset++] = value;
  return {
    positions,
    diagnostics: {
      vertices: incidence.filter((faces) => faces.length).length,
      triangles: triangles.length,
      components: components.length,
      boundaryEdges,
      nonManifoldEdges,
      nonManifoldVertices,
      inconsistentEdges,
      degenerateTriangles,
      duplicateTriangles,
      flippedTriangles:
        options.orient === false ? 0 : Array.from(flips).filter(Boolean).length,
      closed,
      signedVolume,
    },
  };
}

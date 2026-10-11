import type { Positions, Vec3 } from "./types";
import { sampleAlignmentRegion } from "./registration-selection";

/** Row-major rotation and world translation: transformed = rotation * point + translation. */
export interface RigidTransform {
  rotation: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  translation: Vec3;
}
export interface RegistrationResult {
  transform: RigidTransform;
  rms: number;
  maxError: number;
  pairs: number;
  iterations: number;
  converged: boolean;
  globalCandidates?: number;
  coarseRms?: number;
  principalAxesAmbiguous?: boolean;
}
export interface RegistrationOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number, rms: number) => void;
}
export const identityTransform = (): RigidTransform => ({
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: [0, 0, 0],
});
function checkpoint(
  options: RegistrationOptions,
  fraction: number,
  rms: number,
) {
  if (options.signal?.aborted)
    throw new DOMException("Registration cancelled.", "AbortError");
  options.onProgress?.(fraction, rms);
}
function validatePositions(positions: Positions) {
  if (positions.length < 9 || positions.length % 3)
    throw new Error("Registration needs at least three XYZ points.");
  for (const value of positions)
    if (!Number.isFinite(value))
      throw new Error("Registration coordinates must be finite.");
}
function validateTransform(transform: RigidTransform) {
  if (
    transform.rotation.length !== 9 ||
    transform.translation.length !== 3 ||
    ![...transform.rotation, ...transform.translation].every(Number.isFinite)
  )
    throw new Error("Transform must contain finite rotation and translation.");
  const r = transform.rotation;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let product = 0;
      for (let k = 0; k < 3; k++) product += r[i * 3 + k] * r[j * 3 + k];
      if (Math.abs(product - Number(i === j)) > 1e-6)
        throw new Error("Initial rotation must be orthonormal.");
    }
  const determinant =
    r[0] * (r[4] * r[8] - r[5] * r[7]) -
    r[1] * (r[3] * r[8] - r[5] * r[6]) +
    r[2] * (r[3] * r[7] - r[4] * r[6]);
  if (Math.abs(determinant - 1) > 1e-6)
    throw new Error("Registration requires a proper rotation.");
}
function point(positions: ArrayLike<number>, id: number): Vec3 {
  return [positions[id * 3], positions[id * 3 + 1], positions[id * 3 + 2]];
}
export function transformPoint(p: Vec3, transform: RigidTransform): Vec3 {
  const r = transform.rotation,
    t = transform.translation;
  return [
    r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + t[0],
    r[3] * p[0] + r[4] * p[1] + r[5] * p[2] + t[1],
    r[6] * p[0] + r[7] * p[1] + r[8] * p[2] + t[2],
  ];
}
/** Compose transforms so the result first applies previous, then increment. */
function compose(
  increment: RigidTransform,
  previous: RigidTransform,
): RigidTransform {
  const rotation = new Array<number>(9).fill(0) as RigidTransform["rotation"];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        rotation[i * 3 + j] +=
          increment.rotation[i * 3 + k] * previous.rotation[k * 3 + j];
  return {
    rotation,
    translation: transformPoint(previous.translation, increment),
  };
}

/** Horn quaternion absolute orientation. Rejects collinear landmarks; permits planar noncollinear landmarks. */
export function registerPairedPoints(
  source: Positions,
  target: Positions,
  options: RegistrationOptions = {},
): RegistrationResult {
  validatePositions(source);
  validatePositions(target);
  if (source.length !== target.length)
    throw new Error("Landmark counts must match.");
  checkpoint(options, 0, 0);
  const count = source.length / 3,
    cs: Vec3 = [0, 0, 0],
    ct: Vec3 = [0, 0, 0];
  for (let i = 0; i < count; i++)
    for (let axis = 0; axis < 3; axis++) {
      cs[axis] += source[i * 3 + axis] / count;
      ct[axis] += target[i * 3 + axis] / count;
    }
  const covariance = new Array<number>(9).fill(0);
  let sourceScale = 0,
    targetScale = 0;
  for (let i = 0; i < count; i++) {
    const s: Vec3 = [
        source[i * 3] - cs[0],
        source[i * 3 + 1] - cs[1],
        source[i * 3 + 2] - cs[2],
      ],
      t: Vec3 = [
        target[i * 3] - ct[0],
        target[i * 3 + 1] - ct[1],
        target[i * 3 + 2] - ct[2],
      ];
    sourceScale += s[0] ** 2 + s[1] ** 2 + s[2] ** 2;
    targetScale += t[0] ** 2 + t[1] ** 2 + t[2] ** 2;
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) covariance[a * 3 + b] += s[a] * t[b];
  }
  if (
    !Number.isFinite(sourceScale + targetScale) ||
    !sourceScale ||
    !targetScale
  )
    throw new Error("Landmarks have insufficient finite spread.");
  function noncollinear(positions: Positions, center: Vec3, scale: number) {
    let farthest = 0,
      farthestNorm = 0;
    for (let i = 0; i < count; i++) {
      let norm = 0;
      for (let axis = 0; axis < 3; axis++)
        norm += (positions[i * 3 + axis] - center[axis]) ** 2;
      if (norm > farthestNorm) {
        farthest = i;
        farthestNorm = norm;
      }
    }
    const a: Vec3 = [
      positions[farthest * 3] - center[0],
      positions[farthest * 3 + 1] - center[1],
      positions[farthest * 3 + 2] - center[2],
    ];
    for (let i = 0; i < count; i++) {
      const b: Vec3 = [
        positions[i * 3] - center[0],
        positions[i * 3 + 1] - center[1],
        positions[i * 3 + 2] - center[2],
      ];
      const cross2 =
        (a[1] * b[2] - a[2] * b[1]) ** 2 +
        (a[2] * b[0] - a[0] * b[2]) ** 2 +
        (a[0] * b[1] - a[1] * b[0]) ** 2;
      if (cross2 > (scale * farthestNorm * 1e-12) / count) return true;
    }
    return false;
  }
  if (
    !noncollinear(source, cs, sourceScale) ||
    !noncollinear(target, ct, targetScale)
  )
    throw new Error("Collinear landmarks do not determine a unique rotation.");
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = covariance;
  const matrix = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const eigenvectors = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, col) => Number(row === col)),
  );
  const scale = Math.max(...matrix.flat().map(Math.abs));
  for (let iteration = 0; iteration < 80; iteration++) {
    let p = 0,
      q = 1;
    for (let a = 0; a < 4; a++)
      for (let b = a + 1; b < 4; b++)
        if (Math.abs(matrix[a][b]) > Math.abs(matrix[p][q])) {
          p = a;
          q = b;
        }
    if (Math.abs(matrix[p][q]) < scale * 1e-14) break;
    const angle =
        0.5 * Math.atan2(2 * matrix[p][q], matrix[q][q] - matrix[p][p]),
      c = Math.cos(angle),
      s = Math.sin(angle);
    const pp = matrix[p][p],
      qq = matrix[q][q],
      pq = matrix[p][q];
    matrix[p][p] = c * c * pp - 2 * c * s * pq + s * s * qq;
    matrix[q][q] = s * s * pp + 2 * c * s * pq + c * c * qq;
    matrix[p][q] = matrix[q][p] = 0;
    for (let k = 0; k < 4; k++) {
      if (k !== p && k !== q) {
        const kp = matrix[k][p],
          kq = matrix[k][q];
        matrix[k][p] = matrix[p][k] = c * kp - s * kq;
        matrix[k][q] = matrix[q][k] = s * kp + c * kq;
      }
      const vp = eigenvectors[k][p],
        vq = eigenvectors[k][q];
      eigenvectors[k][p] = c * vp - s * vq;
      eigenvectors[k][q] = s * vp + c * vq;
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (matrix[i][i] > matrix[best][best]) best = i;
  const [w, x, y, z] = eigenvectors.map((row) => row[best]);
  const rotation: RigidTransform["rotation"] = [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
  const rotated = transformPoint(cs, { rotation, translation: [0, 0, 0] });
  const transform: RigidTransform = {
    rotation,
    translation: [ct[0] - rotated[0], ct[1] - rotated[1], ct[2] - rotated[2]],
  };
  let sum = 0,
    maxError = 0;
  for (let i = 0; i < count; i++) {
    const p = transformPoint(point(source, i), transform),
      t = point(target, i);
    const error = Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
    sum += error * error;
    maxError = Math.max(maxError, error);
  }
  const rms = Math.sqrt(sum / count);
  checkpoint(options, 1, rms);
  return {
    transform,
    rms,
    maxError,
    pairs: count,
    iterations: 1,
    converged: true,
  };
}

interface KdNode {
  index: number;
  axis: number;
  left?: KdNode;
  right?: KdNode;
}
function buildTree(
  points: Float64Array,
  ids: number[],
  depth = 0,
): KdNode | undefined {
  if (!ids.length) return undefined;
  const axis = depth % 3;
  ids.sort((a, b) => points[a * 3 + axis] - points[b * 3 + axis]);
  const mid = Math.floor(ids.length / 2);
  return {
    index: ids[mid],
    axis,
    left: buildTree(points, ids.slice(0, mid), depth + 1),
    right: buildTree(points, ids.slice(mid + 1), depth + 1),
  };
}
function nearest(
  tree: KdNode,
  points: Float64Array,
  query: Vec3,
  maximum: number,
): { index: number; distance2: number } {
  let index = -1,
    distance2 = maximum;
  function visit(node?: KdNode) {
    if (!node) return;
    const i = node.index * 3;
    const d2 =
      (query[0] - points[i]) ** 2 +
      (query[1] - points[i + 1]) ** 2 +
      (query[2] - points[i + 2]) ** 2;
    if (d2 < distance2 || (d2 === distance2 && index < 0)) {
      index = node.index;
      distance2 = d2;
    }
    const delta = query[node.axis] - points[i + node.axis];
    visit(delta < 0 ? node.left : node.right);
    if (delta * delta <= distance2) visit(delta < 0 ? node.right : node.left);
  }
  visit(tree);
  return { index, distance2 };
}
function sample(positions: Positions, requested: number): Float64Array {
  const total = positions.length / 3,
    count = Math.min(total, requested);
  const output = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const id = Math.floor((i * total) / count);
    for (let axis = 0; axis < 3; axis++)
      output[i * 3 + axis] = positions[id * 3 + axis];
  }
  return output;
}
export interface IcpOptions extends RegistrationOptions {
  sourceTriangleMask?: Uint8Array;
  initial?: RigidTransform;
  maxIterations?: number;
  sampleSize?: number;
  targetSampleSize?: number;
  tolerance?: number;
  maxDistance?: number;
  trimFraction?: number;
}
/** Local point-to-point ICP with deterministic bounded samples and a KD tree. Requires an approximately aligned initial pose. */
export function registerIcp(
  source: Positions,
  target: Positions,
  options: IcpOptions = {},
): RegistrationResult {
  validatePositions(source);
  validatePositions(target);
  const iterations = options.maxIterations ?? 40,
    sampleSize = options.sampleSize ?? 4000,
    targetSampleSize = options.targetSampleSize ?? 20000,
    tolerance = options.tolerance ?? 1e-5,
    maxDistance = options.maxDistance ?? Infinity,
    trim = options.trimFraction ?? 0.85;
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    ![sampleSize, targetSampleSize].every(
      (value) => Number.isSafeInteger(value) && value >= 3,
    ) ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0 ||
    !(maxDistance > 0) ||
    !Number.isFinite(trim) ||
    trim <= 0 ||
    trim > 1
  )
    throw new Error(
      "Invalid ICP iteration, sample, tolerance or correspondence options.",
    );
  let transform = options.initial ?? identityTransform();
  validateTransform(transform);
  checkpoint(options, 0, 0);
  const sourcePoints = options.sourceTriangleMask
      ? sampleAlignmentRegion(
          source,
          options.sourceTriangleMask,
          sampleSize,
          () => checkpoint(options, 0, 0),
        )
      : sample(source, sampleSize),
    targetPoints = sample(target, targetSampleSize);
  const tree = buildTree(
    targetPoints,
    Array.from({ length: targetPoints.length / 3 }, (_, i) => i),
  )!;
  let previousRms = Infinity,
    rms = Infinity,
    maxError = Infinity,
    pairs = 0,
    converged = false,
    completed = 0;
  function correspondences(pose: RigidTransform) {
    const candidates: { source: Vec3; target: Vec3; distance2: number }[] = [];
    for (let i = 0; i < sourcePoints.length / 3; i++) {
      const p = transformPoint(point(sourcePoints, i), pose);
      const closest = nearest(tree, targetPoints, p, maxDistance * maxDistance);
      if (closest.index >= 0)
        candidates.push({
          source: p,
          target: point(targetPoints, closest.index),
          distance2: closest.distance2,
        });
    }
    candidates.sort((a, b) => a.distance2 - b.distance2);
    candidates.length = Math.min(
      candidates.length,
      Math.max(3, Math.floor(candidates.length * trim)),
    );
    return candidates;
  }
  for (let iteration = 0; iteration < iterations; iteration++) {
    checkpoint(options, iteration / iterations, Number.isFinite(rms) ? rms : 0);
    const candidates = correspondences(transform);
    if (candidates.length < 3)
      throw new Error(
        "Fewer than three ICP correspondences; increase search distance or improve initial alignment.",
      );
    const a = new Array<number>(candidates.length * 3),
      b = new Array<number>(candidates.length * 3);
    candidates.forEach((pair, i) => {
      for (let axis = 0; axis < 3; axis++) {
        a[i * 3 + axis] = pair.source[axis];
        b[i * 3 + axis] = pair.target[axis];
      }
    });
    const fit = registerPairedPoints(a, b, { signal: options.signal });
    transform = compose(fit.transform, transform);
    completed++;
    const evaluated = correspondences(transform);
    pairs = evaluated.length;
    if (pairs < 3)
      throw new Error("ICP lost sufficient correspondences after transform.");
    rms = Math.sqrt(
      evaluated.reduce((sum, pair) => sum + pair.distance2, 0) / pairs,
    );
    maxError = Math.sqrt(evaluated[evaluated.length - 1].distance2);
    const motion =
      Math.hypot(...fit.transform.translation) +
      Math.hypot(
        ...fit.transform.rotation.map(
          (value, i) => value - Number(i % 4 === 0),
        ),
      );
    if (
      rms <= tolerance ||
      (Math.abs(previousRms - rms) <= tolerance && motion <= tolerance)
    ) {
      converged = true;
      break;
    }
    previousRms = rms;
  }
  checkpoint(options, 1, rms);
  return { transform, rms, maxError, pairs, iterations: completed, converged };
}

export function applyRigidTransform(
  positions: Positions,
  transform: RigidTransform,
  options: RegistrationOptions = {},
): Float32Array {
  validatePositions(positions);
  validateTransform(transform);
  const output = new Float32Array(positions.length);
  for (let i = 0; i < positions.length / 3; i++) {
    if (i % 4096 === 0) checkpoint(options, i / (positions.length / 3), 0);
    output.set(transformPoint(point(positions, i), transform), i * 3);
  }
  for (const value of output)
    if (!Number.isFinite(value))
      throw new Error(
        "Transformed coordinates exceed Float32 output precision.",
      );
  checkpoint(options, 1, 0);
  return output;
}

export interface GlobalRegistrationOptions extends IcpOptions {
  coarseSampleSize?: number;
  refinementCandidates?: number;
}
interface PrincipalFrame {
  center: Vec3;
  axes: Vec3[];
  ambiguous: boolean;
}
function principalFrame(points: Float64Array): PrincipalFrame {
  const count = points.length / 3,
    center: Vec3 = [0, 0, 0];
  for (let i = 0; i < count; i++)
    for (let axis = 0; axis < 3; axis++)
      center[axis] += points[i * 3 + axis] / count;
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let i = 0; i < count; i++)
    for (let a = 0; a < 3; a++)
      for (let b = a; b < 3; b++)
        covariance[a][b] +=
          ((points[i * 3 + a] - center[a]) * (points[i * 3 + b] - center[b])) /
          count;
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 3; b++) covariance[b][a] = covariance[a][b];
  const scale = Math.max(...covariance.flat().map(Math.abs));
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error(
      "Global registration needs a finite spread of distinct points.",
    );
  const vectors = Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, col) => Number(row === col)),
  );
  for (let iteration = 0; iteration < 64; iteration++) {
    let p = 0,
      q = 1;
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 3; b++)
        if (Math.abs(covariance[a][b]) > Math.abs(covariance[p][q])) {
          p = a;
          q = b;
        }
    if (Math.abs(covariance[p][q]) <= scale * 1e-14) break;
    const angle =
        0.5 *
        Math.atan2(2 * covariance[p][q], covariance[q][q] - covariance[p][p]),
      c = Math.cos(angle),
      s = Math.sin(angle);
    const pp = covariance[p][p],
      qq = covariance[q][q],
      pq = covariance[p][q];
    covariance[p][p] = c * c * pp - 2 * c * s * pq + s * s * qq;
    covariance[q][q] = s * s * pp + 2 * c * s * pq + c * c * qq;
    covariance[p][q] = covariance[q][p] = 0;
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const kp = covariance[k][p],
          kq = covariance[k][q];
        covariance[k][p] = covariance[p][k] = c * kp - s * kq;
        covariance[k][q] = covariance[q][k] = s * kp + c * kq;
      }
      const vp = vectors[k][p],
        vq = vectors[k][q];
      vectors[k][p] = c * vp - s * vq;
      vectors[k][q] = s * vp + c * vq;
    }
  }
  const order = [0, 1, 2].sort((a, b) => covariance[b][b] - covariance[a][a]);
  const eigenvalues = order.map((id) => Math.max(0, covariance[id][id]));
  if (eigenvalues[1] <= eigenvalues[0] * 1e-12)
    throw new Error("Collinear scans cannot determine a global rotation.");
  const axes = order.map((id) => vectors.map((row) => row[id]) as Vec3);
  const determinant =
    axes[0][0] * (axes[1][1] * axes[2][2] - axes[1][2] * axes[2][1]) -
    axes[0][1] * (axes[1][0] * axes[2][2] - axes[1][2] * axes[2][0]) +
    axes[0][2] * (axes[1][0] * axes[2][1] - axes[1][1] * axes[2][0]);
  if (determinant < 0) axes[2] = axes[2].map((value) => -value) as Vec3;
  return {
    center,
    axes,
    ambiguous:
      Math.abs(eigenvalues[0] - eigenvalues[1]) <= eigenvalues[0] * 1e-3 ||
      Math.abs(eigenvalues[1] - eigenvalues[2]) <= eigenvalues[0] * 1e-3,
  };
}

/** Principal-axis pose search followed by sampled trimmed ICP. This is a deterministic coarse heuristic, not a guaranteed global optimum. */
export function registerGlobal(
  source: Positions,
  target: Positions,
  options: GlobalRegistrationOptions = {},
): RegistrationResult {
  validatePositions(source);
  validatePositions(target);
  const coarseSize = options.coarseSampleSize ?? 1000,
    refinements = options.refinementCandidates ?? 4;
  if (
    !Number.isSafeInteger(coarseSize) ||
    coarseSize < 3 ||
    !Number.isSafeInteger(refinements) ||
    refinements < 1 ||
    refinements > 24
  )
    throw new Error(
      "Global registration needs at least three coarse samples and one to 24 refinement candidates.",
    );
  const trim = options.trimFraction ?? 0.85;
  if (!Number.isFinite(trim) || trim <= 0 || trim > 1)
    throw new Error("Global registration trim fraction must be in (0, 1].");
  if (
    ![options.sampleSize ?? 4000, options.targetSampleSize ?? 20000].every(
      (value) => Number.isSafeInteger(value) && value >= 3,
    ) ||
    !Number.isSafeInteger(options.maxIterations ?? 40) ||
    (options.maxIterations ?? 40) < 1 ||
    !Number.isFinite(options.tolerance ?? 1e-5) ||
    (options.tolerance ?? 1e-5) <= 0 ||
    !((options.maxDistance ?? Infinity) > 0)
  )
    throw new Error(
      "Invalid global registration sampling, iterations or distance options.",
    );
  checkpoint(options, 0, 0);
  const coarseSource = sample(source, coarseSize),
    coarseTarget = sample(target, coarseSize);
  const sourceFrame = principalFrame(coarseSource),
    targetFrame = principalFrame(coarseTarget);
  const targetSamples = sample(target, options.targetSampleSize ?? 20000);
  const tree = buildTree(
    targetSamples,
    Array.from({ length: targetSamples.length / 3 }, (_, i) => i),
  )!;
  function score(transform: RigidTransform) {
    const errors = new Array<number>(coarseSource.length / 3);
    for (let i = 0; i < errors.length; i++)
      errors[i] = nearest(
        tree,
        targetSamples,
        transformPoint(point(coarseSource, i), transform),
        Infinity,
      ).distance2;
    errors.sort((a, b) => a - b);
    const keep = Math.max(3, Math.floor(errors.length * trim));
    let sum = 0;
    for (let i = 0; i < keep; i++) sum += errors[i];
    return Math.sqrt(sum / keep);
  }
  const candidates: { transform: RigidTransform; score: number }[] = [];
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  for (const permutation of permutations)
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const signs = [sx, sy, sz];
          const rotation = new Array<number>(9).fill(
            0,
          ) as RigidTransform["rotation"];
          for (let row = 0; row < 3; row++)
            for (let col = 0; col < 3; col++)
              for (let axis = 0; axis < 3; axis++)
                rotation[row * 3 + col] +=
                  targetFrame.axes[permutation[axis]][row] *
                  signs[axis] *
                  sourceFrame.axes[axis][col];
          const determinant =
            rotation[0] *
              (rotation[4] * rotation[8] - rotation[5] * rotation[7]) -
            rotation[1] *
              (rotation[3] * rotation[8] - rotation[5] * rotation[6]) +
            rotation[2] *
              (rotation[3] * rotation[7] - rotation[4] * rotation[6]);
          if (determinant < 0) continue;
          const rotatedCenter = transformPoint(sourceFrame.center, {
            rotation,
            translation: [0, 0, 0],
          });
          const transform: RigidTransform = {
            rotation,
            translation: targetFrame.center.map(
              (value, axis) => value - rotatedCenter[axis],
            ) as Vec3,
          };
          validateTransform(transform);
          const rms = score(transform);
          candidates.push({ transform, score: rms });
          checkpoint(options, (0.35 * candidates.length) / 24, rms);
        }
  if (options.initial) {
    validateTransform(options.initial);
    candidates.push({
      transform: options.initial,
      score: score(options.initial),
    });
  }
  candidates.sort((a, b) => a.score - b.score);
  let best = candidates[0];
  let successful = false;
  for (let i = 0; i < Math.min(refinements, candidates.length); i++) {
    checkpoint(options, 0.35 + (0.3 * i) / refinements, best.score);
    try {
      const fit = registerIcp(source, target, {
        ...options,
        initial: candidates[i].transform,
        sampleSize: Math.min(options.sampleSize ?? 4000, coarseSize),
        maxIterations: Math.min(options.maxIterations ?? 40, 20),
        onProgress: (fraction, rms) =>
          checkpoint(options, 0.35 + (0.3 * (i + fraction)) / refinements, rms),
      });
      const rms = score(fit.transform);
      if (!successful || rms < best.score)
        best = { transform: fit.transform, score: rms };
      successful = true;
    } catch (error) {
      if (
        options.signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        throw error;
    }
  }
  if (!successful)
    throw new Error(
      "Global pose candidates had insufficient ICP correspondences; increase search distance or use paired landmarks.",
    );
  const result = registerIcp(source, target, {
    ...options,
    initial: best.transform,
    onProgress: (fraction, rms) =>
      checkpoint(options, 0.65 + 0.35 * fraction, rms),
  });
  return {
    ...result,
    globalCandidates: candidates.length,
    coarseRms: candidates[0].score,
    principalAxesAmbiguous: sourceFrame.ambiguous || targetFrame.ambiguous,
  };
}

import type { IndexedMesh, Positions, Vec3 } from "./types";
import { prepareNativeAlignmentSurface } from "./scan-native-alignment-surface";
import {
  compose,
  identityTransform,
  registerPairedPoints,
  transformPoint,
  validateTransform,
  type IcpOptions,
  type RegistrationResult,
} from "./registration";
import { sampleAlignmentRegion } from "./registration-selection";
import { composeCloudPose } from "./point-cloud-placement";

export interface FineAlignmentOptions extends IcpOptions {
  /** Host-bound geometry and normals; callers cannot substitute scene buffers. */
  targetSurface?: IndexedMesh;
  sourceNormals?: Positions;
  targetNormals?: Positions;
  targetRms?: number;
  overlapPercent?: number;
  /** Internal native cloud output model; never supplied by an agent. */
  outputPlacement?: { sourcePositions: Positions; matrix: number[] };
}

export interface FineAlignmentResult extends RegistrationResult {
  targetRmsBasis: "overlap";
  overlapPercent: number;
  sampleSize: number;
  fittingSamples: number;
  overlapRms: number | null;
  wholeCloudRms: number;
  overlapPoints: number;
  requiredOverlapPoints: number;
  overlapSatisfied: boolean;
  targetRms: number;
  targetReached: boolean;
  terminationReason:
    | "targetReached"
    | "stoppedImproving"
    | "iterationLimit"
    | "insufficientOverlap";
  matching: "fullTargetPointToPoint" | "fullTargetSurface";
  normalCompatibility: boolean;
  rejectedNormalPoints: number;
  applied: boolean;
  evaluatedPoints: number;
  targetPoints: number;
  distanceTests: number;
  rejectedPoints: number;
  overlapFraction: number;
  inlierRms: number | null;
  inlierPairs: number;
}

export function isFineAlignmentResult(
  result: RegistrationResult,
): result is FineAlignmentResult {
  return (
    "matching" in result &&
    (result.matching === "fullTargetPointToPoint" ||
      result.matching === "fullTargetSurface")
  );
}

/** Full target surfaces/points; bounded fitting samples, independent all-source verification. */
export function registerFineAlignment(
  source: Positions,
  target: Positions,
  options: FineAlignmentOptions = {},
): FineAlignmentResult {
  const targetRms = options.targetRms ?? 0.5;
  const iterations = options.maxIterations ?? 200;
  const sampleSize = options.sampleSize ?? 20000;
  const tolerance = options.tolerance ?? 1e-5;
  const maxDistance = options.maxDistance ?? Infinity;
  if (
    options.overlapPercent !== undefined &&
    options.trimFraction !== undefined
  )
    throw new Error("Use overlapPercent or legacy trimFraction, not both.");
  const overlapPercent =
    options.overlapPercent ?? (options.trimFraction ?? 0.85) * 100;
  if (
    !Number.isFinite(overlapPercent) ||
    overlapPercent <= 0 ||
    overlapPercent > 100
  )
    throw new Error(
      "Fine alignment overlap percentage must be greater than zero and at most 100.",
    );
  const trim = overlapPercent / 100;
  const requestedPoints = (count: number) =>
    Math.max(3, Math.ceil(count * trim - 1e-12));
  let progress = 0,
    residual = 0;
  const check = (fraction = progress, rms = residual) => {
    progress = Math.max(progress, fraction);
    residual = rms;
    options.signal?.throwIfAborted();
    options.onProgress?.(progress, rms);
  };
  check();
  if (!Number.isFinite(targetRms) || targetRms <= 0)
    throw new Error(
      "Fine alignment target RMS must be finite and positive (mm).",
    );
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > 1000 ||
    !Number.isSafeInteger(sampleSize) ||
    sampleSize < 3 ||
    sampleSize > 100000 ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0 ||
    !(maxDistance > 0) ||
    !Number.isFinite(trim) ||
    trim <= 0 ||
    trim > 1
  )
    throw new Error(
      "Invalid fine alignment iteration, sample, tolerance or correspondence options.",
    );
  for (const positions of [source, target]) {
    if (positions.length < 9 || positions.length % 3)
      throw new Error("Registration needs at least three XYZ points.");
  }
  const placement = options.outputPlacement;
  if (
    placement &&
    (placement.sourcePositions.length !== source.length ||
      placement.matrix.length !== 12 ||
      !placement.matrix.every(Number.isFinite))
  )
    throw new Error("Invalid fine alignment output placement.");
  const sourceCount = source.length / 3,
    targetCount = target.length / 3;
  const normalCompatibility =
    !!options.sourceNormals &&
    !!(options.targetSurface || options.targetNormals);
  // Conservatively include sort scratch and fitting objects; input buffers are host-admitted.
  if (
    targetCount * (options.targetSurface ? 32 : 64) +
      sourceCount * 8 +
      sampleSize * 1024 +
      (options.targetSurface?.triangles.length ?? 0) * 128 >
    256 * 1024 * 1024
  )
    throw new Error(
      "Fine alignment workspace exceeds the 256 MiB limit; simplify the scans.",
    );
  for (const [normals, positions] of [
    [options.sourceNormals, source],
    [options.targetNormals, target],
  ] as const) {
    if (!normals) continue;
    if (normals.length !== positions.length)
      throw new Error("Fine alignment normals must match their coordinates.");
    for (let i = 0; i < normals.length; i++) {
      if (i % 12288 === 0) check();
      if (!Number.isFinite(normals[i]))
        throw new Error("Fine alignment normals must be finite.");
    }
  }
  for (const positions of [source, target]) {
    for (let i = 0; i < positions.length; i++) {
      if (i % 12288 === 0) check();
      if (!Number.isFinite(positions[i]))
        throw new Error("Registration coordinates must be finite.");
    }
  }
  const mask = options.sourceTriangleMask;
  const samples = mask
    ? sampleAlignmentRegion(source, mask, sampleSize, check)
    : new Float64Array(Math.min(sourceCount, sampleSize) * 3);
  if (!mask)
    for (let i = 0; i < samples.length / 3; i++) {
      const id = Math.floor((i * sourceCount) / (samples.length / 3));
      for (let axis = 0; axis < 3; axis++)
        samples[i * 3 + axis] = source[id * 3 + axis];
    }
  const sampleNormals = options.sourceNormals
    ? mask
      ? sampleAlignmentRegion(options.sourceNormals, mask, sampleSize, check)
      : Float64Array.from(
          { length: samples.length },
          (_, i) =>
            options.sourceNormals![
              Math.floor(
                (Math.floor(i / 3) * sourceCount) / (samples.length / 3),
              ) *
                3 +
                (i % 3)
            ],
        )
    : undefined;
  const point = (positions: ArrayLike<number>, id: number): Vec3 => [
    positions[id * 3],
    positions[id * 3 + 1],
    positions[id * 3 + 2],
  ];
  // Implicit balanced KD tree uses five bytes per target point and retains every target point.
  const ids = Uint32Array.from({ length: targetCount }, (_, i) => i);
  const axes = new Uint8Array(targetCount);
  const bounds = options.targetSurface
    ? undefined
    : new Float64Array(targetCount * 6);
  const build = (lo: number, hi: number) => {
    if (lo >= hi) return;
    if (hi - lo >= 4096) check();
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = lo; i < hi; i++)
      for (let a = 0; a < 3; a++) {
        const v = target[ids[i] * 3 + a];
        min[a] = Math.min(min[a], v);
        max[a] = Math.max(max[a], v);
      }
    let axis = 0;
    for (let a = 1; a < 3; a++)
      if (max[a] - min[a] > max[axis] - min[axis]) axis = a;
    ids
      .subarray(lo, hi)
      .sort((a, b) => target[a * 3 + axis] - target[b * 3 + axis] || a - b);
    const mid = (lo + hi) >>> 1;
    axes[mid] = axis;
    for (let a = 0; a < 3; a++) {
      bounds![mid * 6 + a] = min[a];
      bounds![mid * 6 + 3 + a] = max[a];
    }
    build(lo, mid);
    build(mid + 1, hi);
  };
  if (!options.targetSurface) build(0, targetCount);
  const surface = options.targetSurface
    ? prepareNativeAlignmentSurface(
        options.targetSurface.vertices,
        options.targetSurface.triangles,
        { signal: options.signal },
      )
    : undefined;
  if (options.targetSurface && !surface)
    throw new Error("Fine alignment target has no usable surface.");
  let distanceTests = 0;
  const nearest = (p: Vec3) => {
    if (surface) {
      const hit = surface.query(p, Infinity);
      if (!hit) throw new Error("Fine alignment target surface query failed.");
      return {
        distance2: hit.distance ** 2,
        closest: hit.closest as Vec3,
        normal: hit.normal,
      };
    }
    let distance2 = Infinity,
      index = -1;
    const visit = (lo: number, hi: number) => {
      if (lo >= hi || distance2 === 0) return;
      const mid = (lo + hi) >>> 1,
        id = ids[mid],
        axis = axes[mid];
      let lowerBound = 0;
      for (let a = 0; a < 3; a++) {
        const delta = Math.max(
          bounds![mid * 6 + a] - p[a],
          0,
          p[a] - bounds![mid * 6 + 3 + a],
        );
        lowerBound += delta * delta;
      }
      if (lowerBound > distance2) return;
      distanceTests++;
      const d2 =
        (p[0] - target[id * 3]) ** 2 +
        (p[1] - target[id * 3 + 1]) ** 2 +
        (p[2] - target[id * 3 + 2]) ** 2;
      if (d2 < distance2) {
        distance2 = d2;
        index = id;
      }
      const delta = p[axis] - target[id * 3 + axis];
      if (delta < 0) visit(lo, mid);
      else visit(mid + 1, hi);
      if (delta * delta <= distance2) {
        if (delta < 0) visit(mid + 1, hi);
        else visit(lo, mid);
      }
    };
    visit(0, targetCount);
    return {
      distance2,
      closest: point(target, index),
      normal: options.targetNormals
        ? point(options.targetNormals, index)
        : undefined,
    };
  };
  let transform = options.initial ?? identityTransform();
  validateTransform(transform);
  const compatible = (
    normals: ArrayLike<number> | undefined,
    id: number,
    targetNormal?: readonly number[],
  ) => {
    if (!normalCompatibility) return true;
    const n = point(normals!, id),
      r = transform.rotation;
    const rotated = [0, 1, 2].map(
      (a) => r[a * 3] * n[0] + r[a * 3 + 1] * n[1] + r[a * 3 + 2] * n[2],
    );
    const length = Math.hypot(...rotated) * Math.hypot(...targetNormal!);
    // Reject the nearest opposite face; retrying a farther face can cross a thin wall.
    return (
      length > 0 &&
      rotated.reduce((s, v, a) => s + v * targetNormal![a], 0) >= 0.5 * length
    );
  };
  const correspondences = () => {
    const pairs: { source: Vec3; target: Vec3; distance2: number }[] = [];
    for (let i = 0; i < samples.length / 3; i++) {
      if (i % 4096 === 0) check();
      const p = transformPoint(point(samples, i), transform),
        hit = nearest(p);
      if (
        hit.distance2 <= maxDistance ** 2 &&
        compatible(sampleNormals, i, hit.normal)
      )
        pairs.push({
          source: p,
          target: hit.closest,
          distance2: hit.distance2,
        });
    }
    pairs.sort((a, b) => a.distance2 - b.distance2);
    pairs.length = Math.min(pairs.length, requestedPoints(samples.length / 3));
    if (pairs.length < 3)
      throw new Error(
        "Fewer than three ICP correspondences; increase search distance or improve initial alignment.",
      );
    return pairs;
  };
  const evaluate = () => {
    const r = transform.rotation,
      t = transform.translation;
    const matrix = placement
      ? composeCloudPose(
          [
            r[0],
            r[1],
            r[2],
            t[0],
            r[3],
            r[4],
            r[5],
            t[1],
            r[6],
            r[7],
            r[8],
            t[2],
          ],
          placement.matrix,
        )
      : undefined;
    const distances = new Float64Array(sourceCount);
    let sum = 0,
      maxError = 0,
      evaluatedPoints = 0,
      accepted = 0,
      rejectedNormalPoints = 0;
    for (let i = 0; i < sourceCount; i++) {
      if (i % 4096 === 0) check();
      if (mask && !mask[Math.floor(i / 3)]) continue;
      let p: Vec3;
      if (placement && matrix) {
        const [x, y, z] = point(placement.sourcePositions, i);
        // Match native coordinate application order before Float32 storage.
        p = [
          Math.fround(
            y * matrix[1] + x * matrix[0] + z * matrix[2] + matrix[3],
          ),
          Math.fround(
            y * matrix[5] + x * matrix[4] + z * matrix[6] + matrix[7],
          ),
          Math.fround(
            y * matrix[9] + x * matrix[8] + z * matrix[10] + matrix[11],
          ),
        ];
      } else {
        const transformed = transformPoint(point(source, i), transform);
        p = [
          Math.fround(transformed[0]),
          Math.fround(transformed[1]),
          Math.fround(transformed[2]),
        ];
      }
      if (!p.every(Number.isFinite))
        throw new Error(
          "Aligned scan coordinates exceed Float32 output precision.",
        );
      const hit = nearest(p),
        d2 = hit.distance2;
      if (!Number.isFinite(d2))
        throw new Error(
          "Alignment distances exceed the supported numeric range.",
        );
      sum += d2;
      maxError = Math.max(maxError, Math.sqrt(d2));
      evaluatedPoints++;
      const normalAccepted = compatible(options.sourceNormals, i, hit.normal);
      if (!normalAccepted) rejectedNormalPoints++;
      if (d2 <= maxDistance ** 2 && normalAccepted) distances[accepted++] = d2;
    }
    if (accepted < 3 && !normalCompatibility)
      throw new Error("Fewer than three final ICP correspondences.");
    const sorted = distances.subarray(0, accepted).sort();
    const requiredOverlapPoints = requestedPoints(evaluatedPoints);
    const inlierPairs = Math.min(accepted, requiredOverlapPoints);
    let inlierSum = 0;
    for (let i = 0; i < inlierPairs; i++) inlierSum += sorted[i];
    const overlapRms = inlierPairs ? Math.sqrt(inlierSum / inlierPairs) : null;
    return {
      rms: Math.sqrt(sum / evaluatedPoints),
      wholeCloudRms: Math.sqrt(sum / evaluatedPoints),
      overlapRms,
      overlapPoints: inlierPairs,
      requiredOverlapPoints,
      overlapSatisfied: accepted >= requiredOverlapPoints,
      rejectedNormalPoints,
      maxError,
      pairs: evaluatedPoints,
      evaluatedPoints,
      targetPoints: targetCount,
      rejectedPoints: evaluatedPoints - accepted,
      overlapFraction: accepted / evaluatedPoints,
      inlierPairs,
      inlierRms: overlapRms,
    };
  };
  const betterOutput = (
    a: ReturnType<typeof evaluate>,
    b: ReturnType<typeof evaluate>,
  ) => {
    if (a.overlapSatisfied !== b.overlapSatisfied) return a.overlapSatisfied;
    if (!a.overlapSatisfied && a.overlapPoints !== b.overlapPoints)
      return a.overlapPoints > b.overlapPoints;
    return (
      (a.overlapRms ?? Infinity) < (b.overlapRms ?? Infinity) ||
      (a.overlapRms === b.overlapRms && a.wholeCloudRms < b.wholeCloudRms)
    );
  };
  let bestTransform = transform;
  let bestOutput = evaluate();
  if (normalCompatibility && !bestOutput.overlapSatisfied) {
    check(1, bestOutput.overlapRms ?? bestOutput.wholeCloudRms);
    return {
      transform,
      ...bestOutput,
      iterations: 0,
      converged: false,
      targetRms,
      targetReached: false,
      terminationReason: "insufficientOverlap",
      matching: surface ? "fullTargetSurface" : "fullTargetPointToPoint",
      normalCompatibility,
      distanceTests,
      applied: false,
      targetRmsBasis: "overlap",
      overlapPercent,
      sampleSize,
      fittingSamples: samples.length / 3,
    };
  }
  let previousRms = Infinity,
    completed = 0;
  let terminationReason: FineAlignmentResult["terminationReason"] =
    "iterationLimit";
  let final: ReturnType<typeof evaluate> | undefined;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const pairs = correspondences();
    const fit = registerPairedPoints(
      pairs.flatMap((p) => p.source),
      pairs.flatMap((p) => p.target),
      { signal: options.signal },
    );
    transform = compose(fit.transform, transform);
    completed++;
    const evaluated = correspondences();
    const rms = Math.sqrt(
      evaluated.reduce((s, p) => s + p.distance2, 0) / evaluated.length,
    );
    const motion =
      Math.hypot(...fit.transform.translation) +
      Math.hypot(
        ...fit.transform.rotation.map((v, i) => v - Number(i % 4 === 0)),
      );
    const stoppedImproving =
      Math.abs(previousRms - rms) <= tolerance && motion <= tolerance;
    // Sampling can improve while the independent overlap fit worsens; retain each verified pose.
    final = evaluate();
    if (betterOutput(final, bestOutput)) {
      bestOutput = final;
      bestTransform = transform;
    }
    if (
      bestOutput.overlapSatisfied &&
      bestOutput.overlapRms !== null &&
      bestOutput.overlapRms <= targetRms
    ) {
      terminationReason = "targetReached";
      break;
    }
    if (stoppedImproving) {
      terminationReason = "stoppedImproving";
      break;
    }
    previousRms = rms;
    check((0.9 * completed) / iterations, rms);
  }
  final ??= evaluate();
  // Never replace a better measured pose with a worse fit, including storage-rounding plateaus.
  if (betterOutput(bestOutput, final)) {
    final = bestOutput;
    transform = bestTransform;
  }
  const targetReached =
    final.overlapSatisfied &&
    final.overlapRms !== null &&
    final.overlapRms <= targetRms;
  if (targetReached) terminationReason = "targetReached";
  if (!final.overlapSatisfied) terminationReason = "insufficientOverlap";
  check(1, final.overlapRms ?? final.wholeCloudRms);
  return {
    transform,
    ...final,
    iterations: completed,
    converged: final.overlapSatisfied && terminationReason !== "iterationLimit",
    targetRms,
    targetReached,
    terminationReason,
    matching: surface ? "fullTargetSurface" : "fullTargetPointToPoint",
    normalCompatibility,
    distanceTests,
    applied: final.overlapSatisfied,
    targetRmsBasis: "overlap",
    overlapPercent,
    sampleSize,
    fittingSamples: samples.length / 3,
  };
}

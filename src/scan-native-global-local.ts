import { composeCloudPose } from "./point-cloud-placement";
import { nativeCorrectAlignmentRotation } from "./scan-native-alignment-transform";
import { nativeGlobalRigidFit } from "./scan-native-global-rigid-fit";

export interface GlobalCorrespondence {
  source: readonly number[];
  target: readonly number[];
  distance: number;
  active: boolean;
}
export interface GlobalCorrespondences {
  count: number;
  pairs: readonly GlobalCorrespondence[];
}
export interface GlobalLocalPose {
  matrix: readonly number[];
  mean: number;
  std: number;
}

/** Original local global-registration loop with an injectable query boundary.
 * Query construction, sampling, scan scheduling and publication remain separate.
 * Awaiting a query permits bounded worker execution without concurrent pose edits.
 */
export async function nativeGlobalRefineLocal(
  initial: GlobalLocalPose,
  query: (
    matrix: readonly number[],
  ) => GlobalCorrespondences | Promise<GlobalCorrespondences>,
  options: { tolerance?: number; signal?: AbortSignal } = {},
) {
  if (
    initial.matrix.length !== 12 ||
    !initial.matrix.every(Number.isFinite) ||
    typeof initial.mean !== "number" ||
    typeof initial.std !== "number"
  )
    throw new Error(
      "Global local alignment requires a finite pose and numeric error state.",
    );
  const tolerance = Math.fround(options.tolerance ?? 0.001);
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error(
      "Global alignment tolerance must be finite and nonnegative.",
    );
  // A previous native pass can leave NaN error statistics after losing every
  // match. Preserve that diagnostic state while keeping pose values finite.
  let matrix = [...initial.matrix],
    mean = initial.mean,
    std = initial.std;
  let converged = false,
    stable = true,
    iterations = 0;
  let records: readonly GlobalCorrespondence[] = [],
    count = 0;
  const cancelled = () => !!options.signal?.aborted;
  const finish = (status: 0 | -1 | -2) => ({
    status,
    matrix,
    mean,
    std,
    converged,
    stable,
    iterations,
    records,
  });
  const request = async () => {
    const response = await query([...matrix]);
    if (
      !Number.isSafeInteger(response.count) ||
      response.count < 0 ||
      response.count > 0xffffffff
    )
      throw new Error(
        "Global correspondence count must be an unsigned 32-bit integer.",
      );
    for (const p of response.pairs)
      if (
        p.active &&
        (p.source.length !== 3 ||
          p.target.length !== 3 ||
          ![...p.source, ...p.target, p.distance].every(Number.isFinite))
      )
        throw new Error(
          "Global correspondences require finite active XYZ pairs and distances.",
        );
    records = response.pairs;
    count = response.count;
  };
  const deviation = (reference: number) => {
    let sum = 0,
      active = 0;
    for (const p of records)
      if (p.active) {
        const difference = p.distance - reference;
        sum += difference * difference;
        active++;
      }
    return Math.sqrt(sum / active);
  };
  if (cancelled()) return finish(-1);
  await request();
  while (true) {
    if (cancelled()) return finish(-1);
    if (!count) return finish(-2);
    const active = records.filter((p) => p.active);
    const fit = nativeGlobalRigidFit(
      active.map((p) => p.source),
      active.map((p) => p.target),
    );
    if (!fit.accepted) return finish(-2);
    if (cancelled()) return finish(-1);
    const previous = matrix;
    matrix = nativeCorrectAlignmentRotation(
      composeCloudPose(fit.matrix, previous),
    );
    const previousStd = deviation(fit.meanDistance),
      previousCount = count;
    await request();
    let sum = 0,
      activeCount = 0;
    records = records.map((p) => {
      if (!p.active) return p;
      const x = p.source[0] - p.target[0],
        y = p.source[1] - p.target[1],
        z = p.source[2] - p.target[2];
      const distance = Math.sqrt(x * x + y * y + z * z);
      sum += distance;
      activeCount++;
      return { ...p, distance };
    });
    const nextMean = sum / activeCount;
    // Preserve the native unsigned subtraction, including counts below twenty.
    if (fit.meanDistance < nextMean && count < (previousCount - 20) >>> 0) {
      matrix = previous;
      mean = fit.meanDistance;
      std = previousStd;
      return finish(-2);
    }
    if (cancelled()) return finish(-1);
    mean = nextMean;
    std = deviation(mean);
    converged = mean < tolerance;
    stable = Math.abs(mean - initial.mean) < 0.005;
    iterations++;
    // COMISD/JBE also terminates for an unordered ratio (zero over zero).
    // JavaScript <= would incorrectly continue in that case.
    if (iterations > 7 || !(Math.abs(fit.meanDistance - mean) / mean > 0.001))
      return finish(cancelled() ? -1 : 0);
  }
}

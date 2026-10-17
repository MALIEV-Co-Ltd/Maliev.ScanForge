import { NativeGlobalRandom } from "./scan-native-global-sampling";
import type {
  nativeGlobalRefineLocal,
  GlobalLocalPose,
} from "./scan-native-global-local";
export interface GlobalOuterScan extends GlobalLocalPose {
  id: string;
  pointCount: number;
}
export type GlobalOuterLocalResult = Pick<
  Awaited<ReturnType<typeof nativeGlobalRefineLocal>>,
  "matrix" | "mean" | "std" | "status" | "converged" | "stable" | "records"
>;
export interface GlobalOuterState extends GlobalOuterScan {
  converged: boolean;
  stable: boolean;
}
/** Original rigid transpose/translation inversion at 0x1401dd230.
 * This deliberately is not a general matrix inverse. Preserve signed zeros. */
export function nativeGlobalInvertRigid(matrix: readonly number[]) {
  if (matrix.length !== 12 || !matrix.every(Number.isFinite))
    throw Error("Global frame inversion requires twelve finite values.");
  return [
    matrix[0],
    matrix[4],
    matrix[8],
    -(matrix[7] * matrix[4] + matrix[3] * matrix[0] + matrix[11] * matrix[8]),
    matrix[1],
    matrix[5],
    matrix[9],
    -(matrix[7] * matrix[5] + matrix[1] * matrix[3] + matrix[11] * matrix[9]),
    matrix[2],
    matrix[6],
    matrix[10],
    -(matrix[2] * matrix[3] + matrix[7] * matrix[6] + matrix[11] * matrix[10]),
  ];
}
/** Original outer scheduling, with an injectable local-refinement boundary.
 * Matrix application commands retain both native setter calls. The caller must
 * implement/verify geometry setters; composing them prematurely may change mesh rounding. */
export async function nativeGlobalRefineOuter(
  scans: readonly GlobalOuterScan[],
  refine: (
    source: GlobalOuterState,
    ordered: readonly GlobalOuterState[],
    pass: number,
  ) => GlobalOuterLocalResult | Promise<GlobalOuterLocalResult>,
  options: {
    clock?: () => number;
    coverageTolerance?: number;
    onProgress?: (
      pass: number,
      total: number,
      ordered: readonly GlobalOuterState[],
    ) => void;
  } = {},
) {
  const ids = new Set<string>();
  const states: GlobalOuterState[] = scans.map((scan) => {
    if (
      !scan.id ||
      ids.has(scan.id) ||
      !Number.isInteger(scan.pointCount) ||
      scan.pointCount < 0 ||
      scan.pointCount > 0xffffffff ||
      scan.matrix.length !== 12 ||
      !scan.matrix.every(Number.isFinite) ||
      typeof scan.mean !== "number" ||
      typeof scan.std !== "number"
    )
      throw Error("Invalid global outer scan state.");
    ids.add(scan.id);
    return {
      ...scan,
      matrix: [...scan.matrix],
      converged: false,
      stable: false,
    };
  });
  // The native constructor sets coverage (+0x88) to Float32 0.05. Its separate
  // local-fit tolerance (+0x74) is overridden to 0.001 by the command handler.
  const tolerance = Math.fround(options.coverageTolerance ?? 0.05),
    seed = (options.clock ?? (() => Math.trunc(performance.now()) | 0))();
  if (
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    !Number.isInteger(seed) ||
    seed < -0x80000000 ||
    seed > 0xffffffff
  )
    throw Error("Invalid global outer tolerance or clock seed.");
  const random = new NativeGlobalRandom(seed),
    ordered = [...states];
  let passes = 0,
    converged = 0,
    stable = 0;
  const snapshot = (state: GlobalOuterState) => ({
    ...state,
    matrix: [...state.matrix],
  });
  options.onProgress?.(0, 19, ordered.map(snapshot));
  for (let pass = 0; pass < 19; pass++) {
    if (ordered.length <= converged || ordered.length <= stable) break;
    converged = 0;
    stable = 0;
    let success = false;
    for (const state of ordered) {
      const result = await refine(snapshot(state), ordered.map(snapshot), pass);
      if (
        ![0, -1, -2].includes(result.status) ||
        result.matrix.length !== 12 ||
        !result.matrix.every(Number.isFinite) ||
        typeof result.mean !== "number" ||
        typeof result.std !== "number" ||
        typeof result.converged !== "boolean" ||
        typeof result.stable !== "boolean" ||
        result.records.some((record) => typeof record.distance !== "number")
      )
        throw Error("Invalid global local-refinement result.");
      state.matrix = [...result.matrix];
      state.mean = result.mean;
      let covered = 0;
      // Native outer statistics include inactive records and exclude equality/NaN.
      for (const record of result.records)
        if (record.distance < tolerance) covered++;
      state.std = result.records.length
        ? Math.trunc((covered / result.records.length) * 100)
        : 0;
      state.converged = result.converged;
      state.stable = result.stable;
      converged += Number(result.converged);
      stable += Number(result.stable);
      if (result.status === 0) success = true;
    }
    passes++;
    options.onProgress?.(passes, 19, ordered.map(snapshot));
    const maximum = ordered.length - 1;
    for (let i = 0; i < Math.floor(maximum / 2); i++) {
      const a = random.scaled(maximum),
        b = random.scaled(maximum);
      [ordered[a], ordered[b]] = [ordered[b], ordered[a]];
    }
    [ordered[0], ordered[maximum]] = [ordered[maximum], ordered[0]];
    if (!success) break;
  }
  let gauge = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    gaugeId: string | undefined,
    largest = 0;
  const applications: { id: string; matrix: number[] }[] = [];
  for (const state of ordered) {
    if (state.pointCount > largest) {
      largest = state.pointCount;
      gauge = [...state.matrix];
      gaugeId = state.id;
    }
    applications.push({ id: state.id, matrix: [...state.matrix] });
  }
  const inverse = nativeGlobalInvertRigid(gauge);
  for (const state of ordered)
    applications.push({ id: state.id, matrix: [...inverse] });
  return {
    passes,
    order: ordered.map((s) => s.id),
    states: states.map(snapshot),
    gaugeId,
    applications,
    seed,
  };
}

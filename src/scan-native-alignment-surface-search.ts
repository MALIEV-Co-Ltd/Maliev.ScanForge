import {
  ALIGNMENT_QUERY_SENTINEL,
  type AlignmentQueryHit,
  type AlignmentQueryVertex,
} from "./scan-native-alignment-query";
import { createNativeAlignmentObjective } from "./scan-native-alignment-objective";
import { nativeRefinementSimplex } from "./scan-native-refinement-simplex";

/** Native refinement stage on prepared source lanes and a cached target query. */
export function nativeRefineAlignmentSurface(
  initial: readonly number[],
  lanes: readonly (readonly AlignmentQueryVertex[])[],
  query: (
    point: readonly number[],
    radius: number,
  ) => AlignmentQueryHit | undefined,
  options: {
    initialRadius?: number;
    translationOnly?: boolean;
    budget?: number;
    step?: number;
    signal?: AbortSignal;
    onEvaluation?: (
      parameters: readonly number[],
      error: number,
      best: number,
    ) => void;
  } = {},
) {
  if (options.signal?.aborted)
    throw new DOMException("Alignment cancelled.", "AbortError");
  const settings = {
    radius: options.initialRadius ?? ALIGNMENT_QUERY_SENTINEL,
    translationOnly: options.translationOnly,
  };
  const evaluate = createNativeAlignmentObjective(lanes, query, settings);
  let state = evaluate(initial, { initializing: true });
  const initialError = state.error;
  // The constructor removes the initial correspondence radius before refinement.
  settings.radius = ALIGNMENT_QUERY_SENTINEL;
  const result = nativeRefinementSimplex(
    initial,
    (parameters) => {
      state = evaluate(parameters);
      options.onEvaluation?.(parameters.slice(), state.error, state.best);
      return state.error;
    },
    options,
  );
  return {
    ...result,
    initialError,
    best: state.best,
    flags: state.workers.map((worker) => worker.flags),
  };
}
import { createNativeAlignmentObjectiveAsync } from "./scan-native-alignment-objective";
import { nativeRefinementSimplexAsync } from "./scan-native-refinement-simplex";
import { createAlignmentPool } from "./scan-alignment-pool";
import {
  createNativeAlignmentSurfaceQuery,
  type NativeAlignmentQuerySurface,
} from "./scan-native-alignment-mesh-query";
import { nativeAlignmentTargetGroupQuery } from "./scan-native-alignment-target-group";
export async function nativeRefineAlignmentSurfaceAsync(
  initial: readonly number[],
  lanes: readonly (readonly AlignmentQueryVertex[])[],
  surfaces: readonly NativeAlignmentQuerySurface[],
  options: NonNullable<Parameters<typeof nativeRefineAlignmentSurface>[3]> & {
    parallel?: boolean;
  } = {},
) {
  if (options.signal?.aborted)
    throw new DOMException("Alignment cancelled.", "AbortError");
  const pool = await createAlignmentPool(lanes, surfaces, options);
  try {
    const settings = {
      radius: options.initialRadius ?? ALIGNMENT_QUERY_SENTINEL,
      translationOnly: options.translationOnly,
    };
    const query = nativeAlignmentTargetGroupQuery(
      surfaces.map((surface) => createNativeAlignmentSurfaceQuery(surface)),
    );
    const evaluate = createNativeAlignmentObjectiveAsync(
      lanes,
      query,
      settings,
      pool.execute,
      options.signal,
    );
    let state = await evaluate(initial, { initializing: true });
    const initialError = state.error;
    settings.radius = ALIGNMENT_QUERY_SENTINEL;
    const result = await nativeRefinementSimplexAsync(
      initial,
      async (parameters) => {
        state = await evaluate(parameters);
        options.onEvaluation?.(parameters.slice(), state.error, state.best);
        return state.error;
      },
      options,
    );
    return {
      ...result,
      initialError,
      best: state.best,
      flags: state.workers.map((worker) => worker.flags),
      physicalWorkers: pool.physicalWorkers,
      logicalLanes: lanes.length,
      fallbackReason: pool.fallbackReason,
    };
  } finally {
    pool.close();
  }
}

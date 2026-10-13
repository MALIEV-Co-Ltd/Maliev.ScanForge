import {
  ALIGNMENT_QUERY_SENTINEL,
  nativeAlignmentOrientationSign,
  nativeAlignmentOrientationWorker,
  nativeAlignmentQueryError,
  nativeAlignmentQueryWorker,
  type AlignmentQueryHit,
  type AlignmentQueryVertex,
} from "./scan-native-alignment-query";
import { nativeAlignmentSixTransform } from "./scan-native-alignment-transform";

export type AlignmentQuery = (
  point: readonly number[],
  radius: number,
) => AlignmentQueryHit | undefined;
export type AlignmentQueryResult = ReturnType<
  typeof nativeAlignmentQueryWorker
>;
export type AlignmentBatch =
  | {
      kind: "orientation";
      lanes: readonly (readonly AlignmentQueryVertex[])[];
      options: Parameters<typeof nativeAlignmentOrientationWorker>[2];
    }
  | {
      kind: "query";
      lanes: readonly (readonly AlignmentQueryVertex[])[];
      options: Parameters<typeof nativeAlignmentQueryWorker>[2];
    };
export type AlignmentBatchResult =
  | { kind: "orientation"; votes: (readonly [number, number])[] }
  | { kind: "query"; workers: AlignmentQueryResult[] };
export interface AlignmentObjectiveResult {
  error: number;
  best: number;
  sign: number;
  workers: AlignmentQueryResult[];
}
export function runAlignmentBatch(
  batch: AlignmentBatch,
  query: AlignmentQuery,
): AlignmentBatchResult {
  return batch.kind === "orientation"
    ? {
        kind: "orientation",
        votes: batch.lanes.map((lane) =>
          nativeAlignmentOrientationWorker(lane, query, batch.options),
        ),
      }
    : {
        kind: "query",
        workers: batch.lanes.map((lane) =>
          nativeAlignmentQueryWorker(lane, query, batch.options),
        ),
      };
}
export function createNativeAlignmentObjective(
  ...args: Parameters<typeof createNativeAlignmentObjectiveSteps>
) {
  const create = createNativeAlignmentObjectiveSteps(...args);
  return (...input: Parameters<typeof create>) => {
    const steps = create(...input);
    try {
      let step = steps.next();
      while (!step.done)
        step = steps.next(runAlignmentBatch(step.value, args[1]));
      return step.value;
    } finally {
      steps.return(undefined as never);
    }
  };
}
export function createNativeAlignmentObjectiveAsync(
  lanes: Parameters<typeof createNativeAlignmentObjectiveSteps>[0],
  query: AlignmentQuery,
  options: Parameters<typeof createNativeAlignmentObjectiveSteps>[2],
  execute: (batch: AlignmentBatch) => Promise<AlignmentBatchResult>,
  signal?: AbortSignal,
) {
  const create = createNativeAlignmentObjectiveSteps(lanes, query, options);
  return async (...input: Parameters<typeof create>) => {
    const steps = create(...input);
    try {
      let step = steps.next();
      while (!step.done) {
        if (signal?.aborted)
          throw new DOMException("Alignment cancelled.", "AbortError");
        const result = await execute(step.value);
        if (signal?.aborted)
          throw new DOMException("Alignment cancelled.", "AbortError");
        step = steps.next(result);
      }
      return step.value;
    } finally {
      steps.return(undefined as never);
    }
  };
}
/** Stateful native transform/query callback. Source flags and pruning survive evaluations. */
function createNativeAlignmentObjectiveSteps(
  lanes: readonly (readonly AlignmentQueryVertex[])[],
  query: (
    point: readonly number[],
    radius: number,
  ) => AlignmentQueryHit | undefined,
  options: { radius?: number; best?: number; translationOnly?: boolean } = {},
) {
  const vertices = lanes.map((lane) => lane.map((vertex) => ({ ...vertex })));
  let best = options.best ?? ALIGNMENT_QUERY_SENTINEL;
  let sign = 1;
  return function* (
    parameters: readonly number[],
    state: {
      initializing?: boolean;
      output?: boolean;
      cancelled?: boolean;
    } = {},
  ): Generator<AlignmentBatch, AlignmentObjectiveResult, AlignmentBatchResult> {
    const transform = nativeAlignmentSixTransform(
      parameters,
      options.translationOnly,
    );
    const rotation = transform.slice();
    rotation[3] = rotation[7] = rotation[11] = 0;
    if (state.cancelled)
      return { error: ALIGNMENT_QUERY_SENTINEL, best, sign, workers: [] };
    if (state.initializing) {
      const votes = yield {
        kind: "orientation",
        lanes: vertices,
        options: { transform, rotation },
      };
      if (votes.kind !== "orientation")
        throw new Error("Invalid alignment orientation response.");
      sign = nativeAlignmentOrientationSign(votes.votes);
    }
    const reply = yield {
      kind: "query",
      lanes: vertices,
      options: {
        transform,
        rotation,
        radius: options.radius,
        best,
        sign,
        initializing: state.initializing,
        output: state.output,
      },
    };
    if (reply.kind !== "query")
      throw new Error("Invalid alignment query response.");
    const workers = reply.workers;
    if (
      workers.length !== vertices.length ||
      workers.some(
        (worker, index) => worker.flags.length !== vertices[index].length,
      )
    )
      throw new Error("Invalid alignment lane response.");
    for (let lane = 0; lane < vertices.length; lane++)
      for (let id = 0; id < vertices[lane].length; id++)
        vertices[lane][id].flags = workers[lane].flags[id];
    const error = nativeAlignmentQueryError(workers);
    if (error < best) best = error;
    return { error, best, sign, workers };
  };
}

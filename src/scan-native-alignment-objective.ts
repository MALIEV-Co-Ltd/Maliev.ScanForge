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

/** Stateful native transform/query callback. Source flags and pruning survive evaluations. */
export function createNativeAlignmentObjective(
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
  return (
    parameters: readonly number[],
    state: {
      initializing?: boolean;
      output?: boolean;
      cancelled?: boolean;
    } = {},
  ) => {
    const transform = nativeAlignmentSixTransform(
      parameters,
      options.translationOnly,
    );
    const rotation = transform.slice();
    rotation[3] = rotation[7] = rotation[11] = 0;
    if (state.cancelled)
      return { error: ALIGNMENT_QUERY_SENTINEL, best, sign, workers: [] };
    if (state.initializing)
      sign = nativeAlignmentOrientationSign(
        vertices.map((lane) =>
          nativeAlignmentOrientationWorker(lane, query, {
            transform,
            rotation,
          }),
        ),
      );
    const workers = vertices.map((lane) => {
      const result = nativeAlignmentQueryWorker(lane, query, {
        transform,
        rotation,
        radius: options.radius,
        best,
        sign,
        initializing: state.initializing,
        output: state.output,
      });
      for (let id = 0; id < lane.length; id++)
        lane[id].flags = result.flags[id];
      return result;
    });
    const error = nativeAlignmentQueryError(workers);
    if (error < best) best = error;
    return { error, best, sign, workers };
  };
}

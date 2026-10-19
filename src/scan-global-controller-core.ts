import type { WorkerCleanupOutcome } from "./scan-global-worker-cleanup";
import {
  createPreparedGlobalQueryPool,
  createGlobalQueryPoolFromPrepared,
  type PreparedGlobalQueryScene,
} from "./scan-global-scene-client";
import type { GlobalSceneInput } from "./scan-global-scene-core";
import { nativeGlobalRefineLocal } from "./scan-native-global-local";
import { nativeGlobalRefineOuter } from "./scan-native-global-outer";
import type { GlobalRegistrationOptions } from "./scan-global-registration";

/** Same controller statements; no worker bootstrap or geometry application. */
export async function runGlobalScanController(
  input: GlobalSceneInput,
  routedInput: GlobalSceneInput,
  options: GlobalRegistrationOptions & {
    runtimeReserveBytes?: number;
    externalReservedBytes?: number;
    expectedWorkers?: number;
    onQueryPoolCleanup?: (outcomes: WorkerCleanupOutcome[]) => void;
    onControllerClosed?: () => void;
  },
  mode: "target-average" | "pooled-plane",
  radius: number,
  preparedScene?: PreparedGlobalQueryScene,
) {
  const check = () => {
    options.signal?.throwIfAborted();
    options.check?.();
  };
  const pool = preparedScene
    ? await createGlobalQueryPoolFromPrepared(
        routedInput,
        preparedScene,
        options,
      )
    : await createPreparedGlobalQueryPool(routedInput, options);
  let outer: Awaited<ReturnType<typeof nativeGlobalRefineOuter>>;
  let queries = 0;
  const localResults: {
    id: string;
    pass: number;
    status: number;
    iterations: number;
  }[] = [];
  const queryWorkers = pool.physicalWorkers;
  try {
    check();
    options.onProgress?.(0.2, "Refining global scan poses");
    const eligible = new Set(pool.scanIds);
    outer = await nativeGlobalRefineOuter(
      input.scans
        .filter((s) => eligible.has(s.id))
        .map((s) => ({
          id: s.id,
          pointCount: s.geometry.points.length / 3,
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
          mean: 0,
          std: 0,
        })),
      async (source, ordered, pass) => {
        check();
        const local = await nativeGlobalRefineLocal(
          source,
          async (matrix) => {
            check();
            queries++;
            const value = await pool.execute({
              sourceId: source.id,
              poses: ordered.map((s) => ({
                id: s.id,
                matrix: s.id === source.id ? matrix : s.matrix,
              })),
              radius,
              mode,
            });
            check();
            return value;
          },
          { tolerance: options.localTolerance, signal: options.signal },
        );
        check();
        localResults.push({
          id: source.id,
          pass,
          status: local.status,
          iterations: local.iterations,
        });
        return local;
      },
      {
        clock: options.clock,
        coverageTolerance: options.coverageTolerance,
        onProgress: (pass, total, ordered) => {
          check();
          options.onPass?.(pass, ordered);
          check();
          options.onProgress?.(
            0.2 + (0.5 * pass) / total,
            "Refining global scan poses",
          );
        },
      },
    );
    check();
  } finally {
    // Do not overlap the retained point trees with geometry-application workers.
    if (pool.close() === false)
      throw Error("Query worker termination request remains unconfirmed.");
    options.onControllerClosed?.();
  }
  return { outer, mode, queries, queryWorkers, localResults };
}
export type GlobalControllerResult = Awaited<
  ReturnType<typeof runGlobalScanController>
>;

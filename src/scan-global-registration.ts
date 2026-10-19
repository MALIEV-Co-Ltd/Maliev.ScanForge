import { runGlobalScanController } from "./scan-global-controller-core";
import { runSharedGlobalController } from "./scan-global-controller-client";
import type { GlobalSceneInput } from "./scan-global-scene-worker";
import type { GlobalOuterState } from "./scan-native-global-outer";
import { createDatumTransformExecutor } from "./datum-transform-pool";
import type { Entity } from "./types";

export interface GlobalRegistrationOptions {
  parallel?: boolean;
  /** Internal lifetime isolation switch; false preserves the direct controller route. */
  controllerIsolation?: boolean;
  /** Internal ownership boundary, after controller completion and before frame outputs. */
  onInputConsumed?: () => void;
  signal?: AbortSignal;
  check?: () => void;
  mode?: "target-average" | "pooled-plane";
  localTolerance?: number;
  coverageTolerance?: number;
  /** Environmental replay only; ordinary execution uses the native clock route. */
  clock?: () => number;
  onProgress?: (fraction: number, stage: string) => void;
  onPass?: (pass: number, ordered: readonly GlobalOuterState[]) => void;
}
/** Connect verified scene/query/outer numerics to complete staged scan setters.
 * Callers supply the original vertex carriers and own admission/publication.
 * No authored object or workspace changes until the entire returned set is accepted.
 */
export async function refineGlobalScanSet(
  input: GlobalSceneInput,
  entities: readonly Entity[],
  options: GlobalRegistrationOptions = {},
) {
  const check = () => {
    options.signal?.throwIfAborted();
    options.check?.();
  };
  check();
  const originals = new Map(entities.map((e) => [e.id, e]));
  if (
    originals.size !== entities.length ||
    input.scans.length !== entities.length ||
    input.scans.length < 2 ||
    new Set(input.scans.map((s) => s.id)).size !== input.scans.length
  )
    throw Error(
      "Global scan set requires at least two unique matching objects.",
    );
  for (const scan of input.scans) {
    const entity = originals.get(scan.id);
    if (
      !entity ||
      !["mesh", "pointcloud"].includes(entity.kind) ||
      entity.kernelId ||
      entity.parametric ||
      !entity.positions.length ||
      !scan.geometry.points.length
    )
      throw Error(
        "Global scan set requires matching raw mesh or point-cloud objects.",
      );
  }
  const mode =
    options.mode ??
    ((globalThis.navigator?.hardwareConcurrency ?? 2) < 2
      ? "pooled-plane"
      : "target-average");
  const radius = input.radius ?? 5;
  if (
    !["target-average", "pooled-plane"].includes(mode) ||
    !Number.isFinite(radius) ||
    radius < 0
  )
    throw Error("Invalid global registration query settings.");
  options.onProgress?.(0, "Preparing global scan overlap");
  // Native evaluator-enabled preparation appends the mesh evaluator instead of
  // inserting that child's source vertices into the raw target tree. Explicit
  // IDs retain mixed-child routing supplied by a caller; source samples stay intact.
  const routedInput: GlobalSceneInput = {
    ...input,
    scans: input.scans.map((scan) =>
      originals.get(scan.id)!.kind === "mesh" &&
      scan.geometry.targetMeshes?.length &&
      scan.geometry.rawTargetIds === undefined
        ? {
            ...scan,
            geometry: { ...scan.geometry, rawTargetIds: new Uint32Array() },
          }
        : scan,
    ),
  };
  const controlled =
    (await runSharedGlobalController(
      input,
      routedInput,
      options,
      mode,
      radius,
    )) ??
    (await runGlobalScanController(input, routedInput, options, mode, radius));
  const { outer, queries, queryWorkers, localResults } = controlled;
  // Retire only this function's routed descriptors; authored carriers stay intact.
  routedInput.scans = [];
  options.onInputConsumed?.();
  const stages = new Map<string, number[][]>();
  for (const command of outer.applications) {
    const list = stages.get(command.id) ?? [];
    list.push(command.matrix);
    stages.set(command.id, list);
  }
  const transformed = new Map<string, Entity>();
  const execution: {
    id: string;
    bounds: { min: number[]; max: number[] };
    execution: unknown;
  }[] = [];
  // The scan set is already admitted as a background job. Do not put its
  // smaller objects back on the UI thread between worker-driven objects.
  const executor = createDatumTransformExecutor({
    ...options,
    threshold: 0,
    typedNormals: true,
  });
  try {
    for (const [id, matrices] of stages) {
      check();
      if (matrices.length !== 2 || !originals.has(id))
        throw Error(
          "Global registration returned an invalid scan setter sequence.",
        );
      options.onProgress?.(
        0.7 + (0.3 * transformed.size) / stages.size,
        "Applying global scan frames",
      );
      const result = await executor.transformScanStages(
        originals.get(id)!,
        matrices,
      );
      check();
      transformed.set(id, result.entity);
      execution.push({
        id,
        bounds: result.bounds,
        execution: result.execution,
      });
    }
    check();
    options.onProgress?.(1, "Global scan set prepared");
    check();
    return {
      entities: entities.map((e) => transformed.get(e.id) ?? e),
      outer,
      diagnostics: {
        mode,
        queries,
        queryWorkers,
        localResults,
        application: execution,
      },
    };
  } finally {
    executor.close();
  }
}

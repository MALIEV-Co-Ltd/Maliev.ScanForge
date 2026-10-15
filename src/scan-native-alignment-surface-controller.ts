import type { MeshProcessingOptions } from "./mesh-processing";
import {
  prepareNativeAlignmentSources,
  prepareNativeAlignmentSelectedSource,
} from "./scan-native-alignment-source";
import { prepareNativeAlignmentSurface } from "./scan-native-alignment-surface";
import { partitionNativeAlignmentVertices } from "./scan-native-alignment-partition";
import {
  nativeRefineAlignmentSurface,
  nativeRefineAlignmentSurfaceAsync,
} from "./scan-native-alignment-surface-search";
import { nativeAlignmentTargetGroupQuery } from "./scan-native-alignment-target-group";
import {
  nativeAlignmentSixTransform,
  nativeAlignmentSixParameters,
} from "./scan-native-alignment-transform";

type SourceMesh = Parameters<typeof prepareNativeAlignmentSources>[0][number];

/** Prepared mesh refinement and native thread success/matrix contract.
 * Target-group dispatch and the enclosing application constructor are separate.
 */
type RefinementMeshOptions = MeshProcessingOptions & {
  selectionOnly?: boolean;
  workerCount?: number;
  minimumExtent?: number;
  initialRadius?: number;
  translationOnly?: boolean;
  step?: number;
} & { parallel?: boolean };
function prepareRefinementMeshes(
  sources: readonly SourceMesh[],
  target: SourceMesh | readonly SourceMesh[],
  sampleBudget: number,
  options: RefinementMeshOptions,
) {
  const moving = options.selectionOnly
    ? sources.map((source) =>
        prepareNativeAlignmentSelectedSource(source, options),
      )
    : prepareNativeAlignmentSources(sources, sampleBudget, options);
  const targets: readonly SourceMesh[] =
    "vertices" in target ? [target] : target;
  if (!targets.length) throw new Error("Alignment requires a fixed target.");
  const fixed = targets.map((mesh) => {
    const prepared = prepareNativeAlignmentSurface(
      mesh.vertices,
      mesh.triangles,
      options,
    );
    if (!prepared) throw new Error("Alignment target has no usable triangles.");
    return prepared;
  });
  const lanes = partitionNativeAlignmentVertices(
    moving.map((mesh) => mesh.vertices),
    options.workerCount ?? 1,
  );
  let evaluations = 0;
  return {
    lanes: lanes.map((lane) => lane.vertices),
    fixed,
    settings: {
      ...options,
      budget: 1000,
      step: Math.fround(options.step ?? 0.0002),
      onEvaluation: () =>
        options.onProgress?.(
          Math.min(0.99, 0.2 + (++evaluations / 1000) * 0.79),
          "Refining surface alignment",
        ),
    },
  };
}
const initial = () =>
  nativeAlignmentSixParameters([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
function refinementMatrix<
  T extends { converged: boolean; parameters: readonly number[] },
>(result: T, options: RefinementMeshOptions) {
  const accepted = result.converged;
  return {
    ...result,
    accepted,
    matrix: accepted
      ? nativeAlignmentSixTransform(result.parameters, options.translationOnly)
      : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
  };
}

export function nativeRefineAlignmentMeshes(
  sources: readonly SourceMesh[],
  target: SourceMesh | readonly SourceMesh[],
  sampleBudget: number,
  options: RefinementMeshOptions = {},
) {
  const prepared = prepareRefinementMeshes(
    sources,
    target,
    sampleBudget,
    options,
  );
  const result = nativeRefineAlignmentSurface(
    initial(),
    prepared.lanes,
    nativeAlignmentTargetGroupQuery(prepared.fixed.map((fixed) => fixed.query)),
    prepared.settings,
  );
  return refinementMatrix(result, options);
}
export async function nativeRefineAlignmentMeshesAsync(
  sources: readonly SourceMesh[],
  target: SourceMesh | readonly SourceMesh[],
  sampleBudget: number,
  options: RefinementMeshOptions = {},
) {
  const prepared = prepareRefinementMeshes(
    sources,
    target,
    sampleBudget,
    options,
  );
  const result = await nativeRefineAlignmentSurfaceAsync(
    initial(),
    prepared.lanes,
    prepared.fixed.map((fixed) => fixed.surface),
    prepared.settings,
  );
  return refinementMatrix(result, options);
}

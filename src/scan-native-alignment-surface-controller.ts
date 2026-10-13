import type { MeshProcessingOptions } from "./mesh-processing";
import { prepareNativeAlignmentSources } from "./scan-native-alignment-source";
import { prepareNativeAlignmentSurface } from "./scan-native-alignment-surface";
import { partitionNativeAlignmentVertices } from "./scan-native-alignment-partition";
import { nativeRefineAlignmentSurface } from "./scan-native-alignment-surface-search";
import {
  nativeAlignmentSixTransform,
  nativeAlignmentSixParameters,
} from "./scan-native-alignment-transform";

type SourceMesh = Parameters<typeof prepareNativeAlignmentSources>[0][number];

/** Prepared mesh refinement and native thread success/matrix contract.
 * Target-group dispatch and the enclosing application constructor are separate.
 */
export function nativeRefineAlignmentMeshes(
  sources: readonly SourceMesh[],
  target: SourceMesh,
  sampleBudget: number,
  options: MeshProcessingOptions & {
    selectionOnly?: boolean;
    workerCount?: number;
    minimumExtent?: number;
    initialRadius?: number;
    translationOnly?: boolean;
    step?: number;
  } = {},
) {
  const moving = prepareNativeAlignmentSources(sources, sampleBudget, options);
  const fixed = prepareNativeAlignmentSurface(
    target.vertices,
    target.triangles,
    options,
  );
  if (!fixed) throw new Error("Alignment target has no usable triangles.");
  const lanes = partitionNativeAlignmentVertices(
    moving.map((mesh) => mesh.vertices),
    options.workerCount ?? 1,
  );
  let evaluations = 0;
  const result = nativeRefineAlignmentSurface(
    nativeAlignmentSixParameters([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
    lanes.map((lane) => lane.vertices),
    fixed.query,
    {
      ...options,
      budget: 1000,
      step: Math.fround(options.step ?? 0.0002),
      onEvaluation: () =>
        options.onProgress?.(
          Math.min(0.99, 0.2 + (++evaluations / 1000) * 0.79),
          "Refining surface alignment",
        ),
    },
  );
  const accepted = result.converged;
  return {
    ...result,
    accepted,
    matrix: accepted
      ? nativeAlignmentSixTransform(result.parameters, options.translationOnly)
      : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
  };
}

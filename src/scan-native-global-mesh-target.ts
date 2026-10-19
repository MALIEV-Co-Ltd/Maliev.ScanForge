import { nativeGlobalFacetNormal } from "./scan-native-global-facet-normal";
import type { MeshProcessingOptions } from "./mesh-processing";
import { nativeBuildAlignmentNeighbourMasks } from "./scan-native-alignment-adjacency";
import {
  prepareNativeGlobalMeshEvaluator,
  resumeNativeGlobalMeshEvaluator,
  type NativeGlobalMeshEvaluatorData,
  type NativeGlobalEvaluatorMesh,
} from "./scan-native-global-surface";
import type { NativeGlobalEvaluatorSearchScratch } from "./scan-native-global-evaluator-query";
import {
  nativeGlobalTargetChoice,
  type EvaluatedGlobalTarget,
  type RawGlobalTarget,
} from "./scan-native-global-target";

/** Native target arbitration checks only pointer presence at triangle +28/+30/+38.
 * Hidden neighbours still exist; eligibility filtering belongs to the index.
 */
export function nativeGlobalNeighbourMasks(neighbors: Int32Array): Uint8Array {
  if (!(neighbors instanceof Int32Array) || neighbors.length % 3)
    throw Error("Invalid evaluator adjacency dimensions.");
  const masks = new Uint8Array(neighbors.length / 3);
  for (let face = 0; face < masks.length; face++)
    for (let edge = 0; edge < 3; edge++) {
      const other = neighbors[face * 3 + edge];
      if (other < -1 || other >= masks.length)
        throw Error("Invalid evaluator neighbor reference.");
      if (other >= 0) masks[face] |= 1 << edge;
    }
  return masks;
}

const prepared = new WeakMap<
  NativeGlobalEvaluatorMesh,
  ReturnType<typeof prepare>
>();
function check(options: MeshProcessingOptions) {
  if (options.signal?.aborted)
    throw new DOMException("Mesh target preparation cancelled.", "AbortError");
}
/** Immutable local geometry owns its index, native adjacency and reusable query
 * result. Pose changes reuse this object. Each physical worker owns one cache.
 * The returned query record is borrowed until the next call on this target.
 */
export function prepareNativeGlobalMeshTarget(
  input: NativeGlobalEvaluatorMesh,
  options: MeshProcessingOptions = {},
) {
  check(options);
  const existing = prepared.get(input);
  if (existing) return existing;
  const result = prepare(input, options);
  check(options);
  prepared.set(input, result);
  return result;
}
/** Bounded initialization retires all adjacency scratch before new evaluators.
 * Publish complete target entries only after the missing batch succeeds. */
export function prepareNativeGlobalMeshTargets(
  inputs: readonly NativeGlobalEvaluatorMesh[],
  options: MeshProcessingOptions = {},
) {
  check(options);
  const missing = new Map<NativeGlobalEvaluatorMesh, Uint8Array>();
  for (const input of inputs) {
    check(options);
    if (!prepared.has(input) && !missing.has(input))
      missing.set(input, prepareNeighbours(input, options));
  }
  const complete = new Map<
    NativeGlobalEvaluatorMesh,
    ReturnType<typeof prepare>
  >();
  for (const [input, neighbours] of missing) {
    check(options);
    complete.set(
      input,
      attach(prepareNativeGlobalMeshEvaluator(input, options), neighbours),
    );
  }
  check(options);
  for (const [input, target] of complete) prepared.set(input, target);
  return inputs.map((input) => prepared.get(input)!);
}
function prepareNeighbours(
  input: NativeGlobalEvaluatorMesh,
  options: MeshProcessingOptions,
) {
  return input.vertices.length
    ? nativeBuildAlignmentNeighbourMasks(
        input.vertices,
        input.triangles,
        options,
      )
    : new Uint8Array();
}
function prepare(
  input: NativeGlobalEvaluatorMesh,
  options: MeshProcessingOptions,
) {
  // Finish and release adjacency scratch before the evaluator occupies memory.
  const neighbours = prepareNeighbours(input, options);
  const evaluator = prepareNativeGlobalMeshEvaluator(input, options);
  return attach(evaluator, neighbours);
}
export interface NativeGlobalMeshTargetData extends NativeGlobalMeshEvaluatorData {
  neighbours: Uint8Array;
}
export function nativeGlobalMeshTargetData(
  input: NativeGlobalEvaluatorMesh,
): NativeGlobalMeshTargetData {
  const { evaluator, neighbours } = prepareNativeGlobalMeshTarget(input);
  const { root, packedIndex, surface, degenerate, minimumExtent } = evaluator;
  return { root, packedIndex, surface, degenerate, minimumExtent, neighbours };
}
/** Internal worker initialization only; install complete prepared state atomically. */
export function installNativeGlobalMeshTarget(
  input: NativeGlobalEvaluatorMesh,
  data: NativeGlobalMeshTargetData,
) {
  if (
    !(data.neighbours instanceof Uint8Array) ||
    data.neighbours.length !== input.triangles.length / 3 ||
    !data.neighbours.every((v) => v <= 7)
  )
    throw Error("Invalid prepared target boundary masks.");
  const evaluator = resumeNativeGlobalMeshEvaluator(input, data);
  const result = attach(evaluator, data.neighbours);
  prepared.set(input, result);
  return result;
}
function attach(
  evaluator: ReturnType<typeof prepareNativeGlobalMeshEvaluator>,
  neighbours: Uint8Array,
) {
  const scratch: NativeGlobalEvaluatorSearchScratch<number> = {
    stack: [],
    projection: new Float64Array(3),
    edgeFlags: new Uint8Array(1),
  };
  const facetNormal = new Float32Array(3);
  const distance = new Float64Array(1),
    projection = new Float64Array(3),
    edgeFlags = new Uint8Array(1);
  const result: EvaluatedGlobalTarget = {
    point: [0, 0, 0],
    normal: [0, 0, 0],
    signedDistance: 0,
    edgeFlags: 0,
    neighbours: 0,
    found: false,
  };
  const point = result.point as number[],
    normal = result.normal as number[];
  return {
    evaluator,
    neighbours,
    query(query: ArrayLike<number>, radius: number): EvaluatedGlobalTarget {
      if (
        query.length !== 3 ||
        !Number.isFinite(query[0]) ||
        !Number.isFinite(query[1]) ||
        !Number.isFinite(query[2]) ||
        !Number.isFinite(radius) ||
        radius < 0
      )
        throw Error("Invalid mesh target query.");
      distance[0] = radius;
      result.found = false;
      result.signedDistance = radius;
      result.edgeFlags = 0;
      result.neighbours = 0;
      const face = evaluator.query(
        query,
        distance,
        projection,
        edgeFlags,
        scratch,
      );
      if (face === undefined) return result;
      if (evaluator.surface.deriveNormals)
        nativeGlobalFacetNormal(
          evaluator.surface.vertices,
          evaluator.surface.triangles,
          face,
          facetNormal,
        );
      for (let axis = 0; axis < 3; axis++) {
        point[axis] = projection[axis];
        normal[axis] = evaluator.surface.deriveNormals
          ? facetNormal[axis]
          : evaluator.surface.normals[face * 3 + axis];
      }
      result.found = true;
      result.signedDistance = distance[0];
      result.edgeFlags = edgeFlags[0];
      result.neighbours = neighbours[face];
      return result;
    },
  };
}

/** Original evaluator order and radius are preserved for every query. The raw
 * record is the separately searched nearest candidate, before mask/label checks.
 * Results borrow a target's storage; consume before the next query on this set.
 */
export function prepareNativeGlobalMeshTargetSet(
  inputs: readonly NativeGlobalEvaluatorMesh[],
  options: MeshProcessingOptions = {},
) {
  check(options);
  const targets = inputs.map((input) =>
    prepareNativeGlobalMeshTarget(input, options),
  );
  const candidates = new Array<EvaluatedGlobalTarget>(targets.length);
  check(options);
  return {
    targets,
    query(
      point: readonly number[],
      radius: number,
      raw?: RawGlobalTarget,
      sourceLabelWord = 0,
      mask = 0,
    ) {
      for (let i = 0; i < targets.length; i++)
        candidates[i] = targets[i].query(point, radius);
      return nativeGlobalTargetChoice(
        point,
        raw,
        candidates,
        sourceLabelWord,
        mask,
      );
    },
  };
}

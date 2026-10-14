import {
  createNativeDatumPlaneState,
  nativeDatumPlaneReference,
  nativeDatumDirectionReference,
  nativeDatumPointReference,
  type NativeDatumPlaneState,
} from "./scan-native-datum-plane";
import { nativeDatumInverseFrame } from "./scan-native-datum-apply";
import { nativeDatumTranslation } from "./scan-native-datum-translation";
import { retainIndexedMesh } from "./indexed-mesh";
import type { Entity } from "./types";
import { transformDatumCoordinates } from "./datum-transform-kernel";
import { datumFeatureMetadata } from "./scan-native-datum-primitive";
export { transformDatumCoordinates } from "./datum-transform-kernel";

export interface DatumInstruction {
  kind: "plane" | "direction" | "point";
  point: readonly number[];
  direction?: readonly number[];
  axis: 0 | 1 | 2;
  flip?: boolean;
  /** Explicit stages support native replay; application constraints are contiguous. */
  stage?: 0 | 1 | 2;
}

/** Complete native constraint sequence, including rejected intermediate state. */
export function buildDatumAlignment(
  instructions: readonly DatumInstruction[],
  translation?: readonly number[],
) {
  if (instructions.length < 1 || instructions.length > 3)
    throw new Error("Coordinate alignment requires one to three references.");
  let state = createNativeDatumPlaneState();
  const steps: { accepted: boolean; state: NativeDatumPlaneState }[] = [];
  for (let index = 0; index < instructions.length; index++) {
    const input = instructions[index],
      stage = input.stage ?? (index as 0 | 1 | 2);
    if (
      !["plane", "direction", "point"].includes(input.kind) ||
      ![0, 1, 2].includes(input.axis)
    )
      throw new Error("Unsupported coordinate alignment reference or axis.");
    const direction = input.direction?.map((value) =>
      input.flip ? -value : value,
    );
    let result: { accepted: boolean; state: NativeDatumPlaneState };
    if (input.kind === "point")
      result = nativeDatumPointReference(state, stage, input.point);
    else {
      if (!direction)
        throw new Error(
          "A plane or direction reference needs a direction vector.",
        );
      result =
        input.kind === "plane"
          ? nativeDatumPlaneReference(
              state,
              stage,
              input.point,
              direction,
              input.axis,
            )
          : nativeDatumDirectionReference(
              state,
              stage,
              input.point,
              direction,
              input.axis,
            );
    }
    steps.push(result);
    state = result.state;
  }
  if (translation)
    state = {
      ...state,
      matrix: nativeDatumTranslation(state.matrix, translation),
    };
  return {
    accepted: steps.every((step) => step.accepted),
    state,
    steps,
    matrix: nativeDatumInverseFrame(state.matrix),
  };
}

/** A rigid scan edit retains facet/point identity and all saved selection slots. */
export function datumScanTransformPlan(
  entity: Entity,
  matrix?: readonly number[],
) {
  if (!entity.positions.length)
    throw new Error("An empty scan cannot be aligned.");
  if (entity.locked) throw new Error("Unlock the scan before aligning it.");
  if (
    entity.kernelId ||
    entity.parametric ||
    !["mesh", "pointcloud"].includes(entity.kind)
  )
    throw new Error(
      "Coordinate scan alignment requires a mesh or point cloud; exact CAD targets are not supported yet.",
    );
  const indexed = retainIndexedMesh(entity).indexedMesh;
  return {
    indexed,
    assemble: (
      positions: Float32Array,
      vertices?: Float32Array,
      normals?: Float32Array,
    ): Entity => ({
      ...entity,
      positions,
      indexedMesh: indexed
        ? {
            vertices: vertices!,
            triangles: indexed.triangles,
          }
        : undefined,
      normals: normals ? Array.from(normals) : undefined,
      edgePositions: undefined,
      fit: undefined,
      planeFrame: undefined,
      surfacePatch: undefined,
      surfaceScanId: undefined,
      ...(matrix ? datumFeatureMetadata(entity, matrix) : {}),
    }),
  };
}
export function transformDatumScan(
  entity: Entity,
  matrix: readonly number[],
): Entity {
  const plan = datumScanTransformPlan(entity, matrix);
  return plan.assemble(
    transformDatumCoordinates(entity.positions, matrix),
    plan.indexed
      ? transformDatumCoordinates(plan.indexed.vertices, matrix)
      : undefined,
    entity.normals
      ? transformDatumCoordinates(entity.normals, matrix, true)
      : undefined,
  );
}

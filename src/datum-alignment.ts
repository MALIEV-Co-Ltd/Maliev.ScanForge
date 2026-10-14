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
import type { Entity, Positions } from "./types";

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

/** World-space scan application preserves native double arithmetic and Float32 storage. */
export function transformDatumCoordinates(
  input: Positions,
  matrix: readonly number[],
  vector = false,
): Float32Array {
  if (
    input.length % 3 ||
    matrix.length !== 12 ||
    !matrix.every(Number.isFinite)
  )
    throw new Error(
      "Alignment transform requires XYZ coordinates and a finite 3x4 matrix.",
    );
  const output = new Float32Array(input.length);
  for (let offset = 0; offset < input.length; offset += 3) {
    const x = input[offset],
      y = input[offset + 1],
      z = input[offset + 2];
    output[offset] =
      y * matrix[1] + x * matrix[0] + z * matrix[2] + (vector ? 0 : matrix[3]);
    output[offset + 1] =
      x * matrix[4] + y * matrix[5] + z * matrix[6] + (vector ? 0 : matrix[7]);
    output[offset + 2] =
      x * matrix[8] +
      y * matrix[9] +
      z * matrix[10] +
      (vector ? 0 : matrix[11]);
  }
  if (
    !output.every((value) => Number.isFinite(value) && Math.abs(value) <= 1e9)
  )
    throw new Error("Aligned scan coordinates exceed the supported range.");
  return output;
}

/** A rigid scan edit retains facet/point identity and all saved selection slots. */
export function transformDatumScan(
  entity: Entity,
  matrix: readonly number[],
): Entity {
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
    ...entity,
    positions: transformDatumCoordinates(entity.positions, matrix),
    indexedMesh: indexed
      ? {
          vertices: transformDatumCoordinates(indexed.vertices, matrix),
          triangles: indexed.triangles,
        }
      : undefined,
    normals: entity.normals
      ? Array.from(transformDatumCoordinates(entity.normals, matrix, true))
      : undefined,
    edgePositions: undefined,
    fit: undefined,
    planeFrame: undefined,
    surfacePatch: undefined,
    surfaceScanId: undefined,
  };
}

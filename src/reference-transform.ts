import type { Entity, Vec3 } from "./types";
import { transformPositions } from "./geometry";
import { validateReferenceEntity } from "./reference-entity";
import {
  copyReferenceGeometry,
  referenceLineEnd,
  type ReferenceVector,
} from "./reference-construction-values";

/** One inexpensive GUI/API admission rule; unsupported retained records stay unread. */
export function referenceTransformEligibility(entity: Entity | undefined): {
  eligible: boolean;
  reason?: string;
} {
  if (!entity)
    return {
      eligible: false,
      reason: "Select a numeric reference to transform.",
    };
  if (entity.locked)
    return {
      eligible: false,
      reason: "The reference is locked; unlock it before transforming.",
    };
  if (entity.kind !== "referencePoint" && entity.kind !== "referenceLine")
    return {
      eligible: false,
      reason: "Transform requires a numeric point or endpoint-line reference.",
    };
  const definition = entity.reference?.definition;
  if (
    !definition ||
    !Array.isArray(definition.sources) ||
    definition.sources.length !== 0 ||
    (entity.kind === "referencePoint"
      ? definition.kind !== "point" || definition.mode !== "coordinates"
      : definition.kind !== "line" ||
        definition.mode !== "endpoints" ||
        !Array.isArray(definition.records) ||
        definition.records.length !== 0)
  )
    return {
      eligible: false,
      reason:
        "Transform supports numeric references with empty sources and no retained line-pick records; derived and inactive-record policies remain unsupported.",
    };
  try {
    validateReferenceEntity(entity);
    return { eligible: true };
  } catch (error) {
    return {
      eligible: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function boundedPoint(point: ReferenceVector): void {
  if (point.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9))
    throw new Error(
      "Transformed reference endpoints exceed world bounds (+/-1e9 mm).",
    );
}

/**
 * Supplied-matrix payload arithmetic: original rows, binary64, no normalization.
 * Synchronizing the separate numeric authoring definition is application policy.
 */
export function transformNumericReference(
  entity: Entity,
  inputMatrix: readonly number[],
): Entity {
  const eligibility = referenceTransformEligibility(entity);
  if (!eligibility.eligible) throw new Error(eligibility.reason);
  if (
    !Array.isArray(inputMatrix) ||
    inputMatrix.length !== 12 ||
    !Array.from(inputMatrix).every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  )
    throw new Error(
      "Reference transform requires a finite row-major 3x4 matrix.",
    );
  const matrix = [...inputMatrix];
  const data = validateReferenceEntity(entity)!;
  const linear = (point: ReferenceVector): Vec3 => {
    const [x, y, z] = point;
    return [0, 4, 8].map(
      (row) => y * matrix[row + 1] + x * matrix[row] + z * matrix[row + 2],
    ) as Vec3;
  };
  const position = (point: ReferenceVector): Vec3 =>
    linear(point).map((value, row) => value + matrix[row * 4 + 3]) as Vec3;
  if (
    data.geometry.kind === "point" &&
    data.definition.kind === "point" &&
    data.definition.mode === "coordinates"
  ) {
    const transformed = position(data.geometry.position);
    boundedPoint(transformed);
    return {
      ...entity,
      reference: {
        version: 1,
        geometry: copyReferenceGeometry({
          kind: "point",
          position: transformed,
        }),
        definition: { ...data.definition, position: [...transformed] },
        evaluation: { completionWord: 0x100 },
      },
    };
  }
  if (
    data.geometry.kind !== "line" ||
    data.definition.kind !== "line" ||
    data.definition.mode !== "endpoints"
  )
    throw new Error(
      "Reference transform definition and geometry kinds differ.",
    );
  const geometry = copyReferenceGeometry({
    kind: "line",
    start: position(data.geometry.start),
    direction: linear(data.geometry.direction),
    length: data.geometry.length,
  });
  if (geometry.kind !== "line")
    throw new Error("Reference line transform returned a different kind.");
  const end = referenceLineEnd(geometry);
  boundedPoint(geometry.start);
  boundedPoint(end);
  return {
    ...entity,
    reference: {
      version: 1,
      geometry,
      definition: {
        ...data.definition,
        start: [...geometry.start],
        end: [...end],
      },
      evaluation: { completionWord: 0x100 },
    },
  };
}

/** Existing application conversion only: positive scale, X/Y/Z degrees, translation. */
export function referenceTransformMatrix(
  translation: readonly number[],
  rotation: readonly number[],
  scale: number,
): number[] {
  if (
    !Array.isArray(translation) ||
    translation.length !== 3 ||
    !Array.isArray(rotation) ||
    rotation.length !== 3 ||
    ![...translation, ...rotation, scale].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) ||
    scale <= 0
  )
    throw new Error(
      "Transform requires finite XYZ translation/rotation and a positive scale.",
    );
  const basis = transformPositions(
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [0, 0, 0],
    [...rotation] as Vec3,
    scale,
  );
  const matrix = [
    basis[0],
    basis[3],
    basis[6],
    translation[0],
    basis[1],
    basis[4],
    basis[7],
    translation[1],
    basis[2],
    basis[5],
    basis[8],
    translation[2],
  ];
  if (!matrix.every(Number.isFinite))
    throw new Error("Reference transform matrix coefficients must be finite.");
  return matrix;
}

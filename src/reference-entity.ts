import type { Entity } from "./types";
import {
  assertReferenceFrameCompatibleMetadata,
  validateReferenceFrameEntity,
} from "./reference-frame";
import type { ProjectSession } from "./project-file-codec";
import { assertReferenceConstructionSceneAdmission } from "./reference-construction-lifecycle";
import {
  referenceNumericEditFields,
  type ReferenceNumericEditFields,
} from "./reference-numeric-edit-fields";
import {
  copyReferenceConstruction,
  encodeReferenceConstruction,
  decodeReferenceConstruction,
  type ReferenceConstructionDefinition,
} from "./reference-construction";
import {
  copyReferenceGeometry,
  encodeReferenceGeometry,
  decodeReferenceGeometry,
  referenceLineEnd,
  type ReferenceVector,
  type ReferenceGeometry,
} from "./reference-construction-values";

export interface ReferenceEntityData {
  version: 1;
  definition: ReferenceConstructionDefinition;
  geometry: ReferenceGeometry;
  evaluation: { completionWord: number };
}
export type EncodedReferenceEntityData = {
  version: 1;
  definition: ReturnType<typeof encodeReferenceConstruction>;
  geometry: ReturnType<typeof encodeReferenceGeometry>;
  evaluation: { completionWord: number };
};

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("Invalid reference entity payload.");
  return value as Record<string, unknown>;
}
function evaluation(value: unknown): ReferenceEntityData["evaluation"] {
  const data = record(value, ["completionWord"]),
    word = data.completionWord;
  if (
    typeof word !== "number" ||
    !Number.isInteger(word) ||
    word < 0 ||
    word > 0xffff
  )
    throw new Error("Invalid reference evaluation state.");
  return { completionWord: word };
}
export function copyReferenceEntityData(value: unknown): ReferenceEntityData {
  const data = record(value, [
    "version",
    "definition",
    "geometry",
    "evaluation",
  ]);
  if (data.version !== 1)
    throw new Error("Unsupported reference entity version.");
  const definition = copyReferenceConstruction(data.definition),
    geometry = copyReferenceGeometry(data.geometry);
  if (definition.kind !== geometry.kind)
    throw new Error("Reference definition and geometry kinds differ.");
  return {
    version: 1,
    definition,
    geometry,
    evaluation: evaluation(data.evaluation),
  };
}
export function encodeReferenceEntityData(
  value: ReferenceEntityData,
): EncodedReferenceEntityData {
  const data = copyReferenceEntityData(value);
  return {
    version: 1,
    definition: encodeReferenceConstruction(data.definition),
    geometry: encodeReferenceGeometry(data.geometry),
    evaluation: data.evaluation,
  };
}
export function decodeReferenceEntityData(value: unknown): ReferenceEntityData {
  const data = record(value, [
    "version",
    "definition",
    "geometry",
    "evaluation",
  ]);
  return copyReferenceEntityData({
    version: data.version,
    definition: decodeReferenceConstruction(data.definition),
    geometry: decodeReferenceGeometry(data.geometry),
    evaluation: data.evaluation,
  });
}
export function isReferenceEntity(entity: Pick<Entity, "kind">): boolean {
  return entity.kind === "referencePoint" || entity.kind === "referenceLine";
}
export function supportsSampledGeometry(
  entity: Pick<Entity, "kind"> | undefined,
): boolean {
  return (
    !!entity && !isReferenceEntity(entity) && entity.kind !== "referenceFrame"
  );
}
export function validateConstructionOrderKeys(
  entities: readonly Pick<Entity, "constructionOrderKey">[],
): void {
  const used = new Set<string>();
  for (const entity of entities) {
    const key = entity.constructionOrderKey;
    if (key === undefined) continue;
    if (typeof key !== "string" || !/^[0-9a-f]{32}$/.test(key) || used.has(key))
      throw new Error("Invalid or duplicate construction order key.");
    used.add(key);
  }
}
const incompatible = [
  "indexedMesh",
  "normals",
  "pointColors",
  "meshSelection",
  "pointCloudPlacement",
  "brep",
  "kernelId",
  "fit",
  "planeFrame",
  "surfacePatch",
  "surfaceScanId",
  "parametric",
  "authoringLinks",
  "scanSource",
  "edgePositions",
  "ascAttributes",
  "coordinateFrame",
] as const;
/** Check raw metadata before a codec can normalize or discard its values. */
export function assertReferenceCompatibleMetadata(
  entity: Pick<Entity, "kind"> &
    Partial<Record<(typeof incompatible)[number], unknown>>,
): void {
  assertReferenceFrameCompatibleMetadata(entity);
  if (
    isReferenceEntity(entity) &&
    incompatible.some((key) => entity[key] !== undefined)
  )
    throw new Error(
      "Reference entities require empty display positions and compatible semantic metadata.",
    );
}
/** Validate and detach semantic data; normal mesh/cloud coordinates stay borrowed. */
export function validateReferenceEntity(
  entity: Entity,
): ReferenceEntityData | undefined {
  if (entity.kind === "referenceFrame") {
    validateReferenceFrameEntity(entity);
    return undefined;
  }
  assertReferenceFrameCompatibleMetadata(entity);
  if (!isReferenceEntity(entity)) {
    if (entity.reference !== undefined)
      throw new Error("Reference payload requires a reference entity kind.");
    return undefined;
  }
  assertReferenceCompatibleMetadata(entity);
  if (
    !(
      Array.isArray(entity.positions) ||
      entity.positions instanceof Float32Array
    ) ||
    entity.positions.length !== 0
  )
    throw new Error(
      "Reference entities require empty display positions and compatible semantic metadata.",
    );
  if (entity.constructionOrderKey === undefined)
    throw new Error("Reference entity requires a construction order key.");
  validateConstructionOrderKeys([entity]);
  const data = copyReferenceEntityData(entity.reference);
  if (
    (entity.kind === "referencePoint" ? "point" : "line") !== data.geometry.kind
  )
    throw new Error("Reference entity and geometry kinds differ.");
  return data;
}

export interface ReferenceBounds {
  min: ReferenceVector;
  max: ReferenceVector;
}
function geometryBounds(geometry: ReferenceGeometry): ReferenceBounds {
  if (geometry.kind === "point")
    return { min: [...geometry.position], max: [...geometry.position] };
  const start = geometry.start,
    end = referenceLineEnd(geometry);
  return {
    min: [
      Math.min(start[0], end[0]),
      Math.min(start[1], end[1]),
      Math.min(start[2], end[2]),
    ],
    max: [
      Math.max(start[0], end[0]),
      Math.max(start[1], end[1]),
      Math.max(start[2], end[2]),
    ],
  };
}
/** Bounds use authoritative Float64 values, never the empty display carrier. */
export function referenceEntityBounds(
  entity: Entity,
): ReferenceBounds | undefined {
  const data = validateReferenceEntity(entity);
  return data && geometryBounds(data.geometry);
}

/** A semantic object cannot be treated as an empty sampled mesh/cloud. */
export function assertSampledGeometry(entity: Pick<Entity, "kind">): void {
  if (!supportsSampledGeometry(entity))
    throw new Error(
      "Reference construction objects do not provide sampled mesh or point-cloud geometry.",
    );
}

function geometrySummary(geometry: ReferenceGeometry) {
  return {
    points: geometry.kind === "point" ? 1 : 0,
    lines: geometry.kind === "line" ? 1 : 0,
    triangles: 0 as const,
    bounds: geometryBounds(geometry),
  };
}
/** Shared geometric summary for GUI inspection and object_get/project_get. */
export function referenceEntitySummary(entity: Entity) {
  const data = validateReferenceEntity(entity);
  return data && geometrySummary(data.geometry);
}

/** Read saved state and object identities without evaluating or resolving picks. */
export function inspectReferenceEntity(
  entity: Entity,
  scene: readonly Entity[],
) {
  const data = validateReferenceEntity(entity);
  if (!data) return undefined;
  let editorInputs: ReferenceNumericEditFields | undefined;
  let editorInputsError: string | undefined;
  try {
    editorInputs = referenceNumericEditFields(entity);
  } catch (error) {
    editorInputsError = error instanceof Error ? error.message : String(error);
  }
  const objects = new Map(scene.map((row) => [row.id, row]));
  return {
    ...geometrySummary(data.geometry),
    reference: {
      version: data.version,
      geometry: data.geometry,
      geometryEncoding: encodeReferenceGeometry(data.geometry),
      definition: data.definition,
      definitionEncoding: encodeReferenceConstruction(data.definition),
      ...(editorInputs ? { editorInputs } : { editorInputsError }),
      // The retained word alone cannot distinguish updated/fallback/unchanged.
      evaluation: { status: "stored" as const, outcome: null },
      sourceBindings: data.definition.sources.map((source) => {
        const object = objects.get(source.id);
        return {
          ...source,
          status: !object
            ? ("missing-object" as const)
            : object.constructionOrderKey === undefined
              ? ("unassigned-key" as const)
              : object.constructionOrderKey !== source.constructionOrderKey
                ? ("identity-mismatch" as const)
                : ("identity-matched" as const),
        };
      }),
      recordBindings:
        data.definition.kind === "line"
          ? data.definition.records.map((record, recordIndex) => ({
              recordIndex,
              entityId: record.entityId,
              objectPresent: objects.has(record.entityId),
            }))
          : [],
    },
  };
}
/** Validate current and undo/redo states without changing retained evaluation state. */
export function assertReferenceWorkspaceAdmission(
  session: ProjectSession,
): void {
  for (const entities of [
    session.project.entities,
    ...session.history.map((row) => row.entities),
    ...session.future.map((row) => row.entities),
  ])
    assertReferenceConstructionSceneAdmission(entities);
}

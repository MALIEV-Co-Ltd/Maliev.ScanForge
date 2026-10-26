import {
  copyReferenceConstruction,
  type ReferenceConstructionDefinition,
  type RetainedReferenceLinePick,
} from "./reference-construction";
import type { Entity } from "./types";
import type { ResolvedReferenceConstructionInputs } from "./reference-construction-evaluation";
import { resolveConstructionIdentities } from "./reference-construction-identity";
import { validateReferenceEntity } from "./reference-entity";
import type { ReferenceVector } from "./reference-construction-values";
import type { NativeReferenceLineRecord } from "./reference-line-evaluation";
import type { ResolvedReferencePrimitive } from "./reference-point-evaluation";
import { validatePlaneFrame } from "./plane-frame";
import { validateParametricModel } from "./parametric";
import {
  acquireSketchReferencePick,
  resolveDirectReferencePrimitive,
  resolvePickedSketchReferencePoint,
  type PickedSketchReferenceSource,
} from "./reference-source-primitives";

export type DerivedReferenceLineMode = "pair" | "average";
export interface LocatedReferenceSourcePick {
  readonly entityId: string;
  readonly parameter?: number;
}

/**
 * Application primitive recipes, not fit diagnostics or native payload layouts.
 * Cylinder midpoint, normalization and finite extent follow the CAD worker's
 * declared input convention. General CAD and cone extraction remain separate.
 */
function resolveStoredRecipeReferenceSource(
  entity: Entity,
): NativeReferenceLineRecord | undefined {
  const binding = entity.parametric;
  if (binding === undefined) return undefined;
  if (
    !binding ||
    typeof binding !== "object" ||
    Array.isArray(binding) ||
    binding.output !== 0
  )
    throw new Error(
      "Analytic primitive source requires its valid output0 binding.",
    );
  const recipe = binding.feature?.recipe;
  if (recipe?.kind !== "primitive")
    throw new Error(
      "Reference source requires an authoritative primitive recipe.",
    );
  // Primitive recipes have no dependencies, so the existing envelope/input
  // validator can validate this single feature without a scene model or kernel.
  validateParametricModel({
    format: "scanforge-parametric",
    version: 1,
    features: [binding.feature],
  });
  const input = recipe.input;
  if (input.kind !== "sphere" && input.kind !== "cylinder")
    throw new Error(
      "Only sphere and cylinder primitive recipe sources are supported.",
    );
  const inWorld = (value: readonly number[]) =>
    Array.isArray(value) &&
    value.length === 3 &&
    Array.from(value).every(
      (coordinate) =>
        typeof coordinate === "number" &&
        Number.isFinite(coordinate) &&
        Math.abs(coordinate) <= 1e9,
    );
  if (!inWorld(input.center) || input.radius > 1e9)
    throw new Error(
      "Analytic primitive source exceeds finite world bounds (+/-1e9 mm).",
    );
  if (input.kind === "sphere")
    return { kind: "point", position: [...input.center], objectResolved: true };
  const length = Math.hypot(...input.axis);
  if (
    !inWorld(input.axis) ||
    !(length > 0 && length <= 1e9) ||
    input.height > 1e9
  )
    throw new Error(
      "Cylinder source axis and height exceed their finite bounds.",
    );
  const direction: ReferenceVector = [
    input.axis[0] / length,
    input.axis[1] / length,
    input.axis[2] / length,
  ];
  const start: ReferenceVector = [
    input.center[0] - (direction[0] * input.height) / 2,
    input.center[1] - (direction[1] * input.height) / 2,
    input.center[2] - (direction[2] * input.height) / 2,
  ];
  const end: ReferenceVector = [
    start[0] + direction[0] * input.height,
    start[1] + direction[1] * input.height,
    start[2] + direction[2] * input.height,
  ];
  if (!inWorld(start) || !inWorld(end))
    throw new Error(
      "Cylinder source segment exceeds finite world bounds (+/-1e9 mm).",
    );
  return { kind: "axis", start, end, objectResolved: true };
}

/** Shared semantic/recipe line sources; numeric plane equations have no line extent. */
export function resolveReferenceLineSource(
  entity: Entity,
  mode: DerivedReferenceLineMode,
): NativeReferenceLineRecord {
  if (mode !== "pair" && mode !== "average")
    throw new Error("Invalid derived reference line mode.");
  const data = validateReferenceEntity(entity);
  const recipeSource = data
    ? undefined
    : resolveStoredRecipeReferenceSource(entity);
  if (recipeSource) {
    if (mode === "average" && recipeSource.kind !== "axis")
      throw new Error("Average line sources require a finite analytic axis.");
    return recipeSource;
  }
  if (!data || (mode === "average" && data.geometry.kind !== "line"))
    throw new Error(
      "Reference line sources require stored semantic geometry; average requires lines.",
    );
  const geometry = data.geometry;
  return resolveDirectReferencePrimitive(
    geometry.kind === "point"
      ? { kind: "referencePoint", origin: geometry.position }
      : {
          kind: "referenceLine",
          origin: geometry.start,
          direction: geometry.direction,
          length: geometry.length,
        },
  );
}

/** Capture one explicit application world location; its fraction is not retained. */
export function acquireLocatedReferenceLinePick(
  entity: Entity,
  input: LocatedReferenceSourcePick,
  mode: DerivedReferenceLineMode,
): RetainedReferenceLinePick {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid located reference source pick.");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("Invalid located reference source pick prototype.");
  const primitive = resolveReferenceLineSource(entity, mode);
  const fields =
    primitive.kind === "axis" ? ["entityId", "parameter"] : ["entityId"];
  const actual = Reflect.ownKeys(input);
  if (
    actual.length !== fields.length ||
    actual.some(
      (field) => typeof field !== "string" || !fields.includes(field),
    ) ||
    typeof input.entityId !== "string" ||
    input.entityId !== entity.id
  )
    throw new Error(
      "Invalid located reference source pick fields or identity.",
    );
  let position: ReferenceVector;
  if (primitive.kind === "point") position = primitive.position;
  else if (primitive.kind === "axis") {
    const parameter = input.parameter;
    if (
      typeof parameter !== "number" ||
      !Number.isFinite(parameter) ||
      parameter < 0 ||
      parameter > 1
    )
      throw new Error(
        "A line source requires a finite parameter within [0,1].",
      );
    const { start, end } = primitive;
    position = [
      start[0] + (end[0] - start[0]) * parameter,
      start[1] + (end[1] - start[1]) * parameter,
      start[2] + (end[2] - start[2]) * parameter,
    ];
  } else throw new Error("Unsupported located reference source family.");
  if (
    position.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9)
  )
    throw new Error(
      "Located reference source coordinates exceed +/-1e9 world bounds.",
    );
  return {
    entityId: entity.id,
    storage: "native-pick-record-f32",
    coordinates: [
      Math.fround(position[0]),
      Math.fround(position[1]),
      Math.fround(position[2]),
    ],
  };
}

/** Application analytic plane equation; no native fit layout or display extent inference. */
export function resolveReferencePointSource(
  entity: Entity,
): ResolvedReferencePrimitive {
  const data = validateReferenceEntity(entity);
  if (data) {
    const geometry = data.geometry;
    return resolveDirectReferencePrimitive(
      geometry.kind === "point"
        ? { kind: "referencePoint", origin: geometry.position }
        : {
            kind: "referenceLine",
            origin: geometry.start,
            direction: geometry.direction,
            length: geometry.length,
          },
    );
  }
  const recipeSource = resolveStoredRecipeReferenceSource(entity);
  if (recipeSource) return recipeSource;
  if (
    entity.kind === "plane" &&
    entity.planeFrame !== undefined &&
    entity.fit === undefined &&
    entity.kernelId === undefined &&
    entity.parametric === undefined
  ) {
    validatePlaneFrame(entity.planeFrame, entity.positions, entity.kind);
    const { center, normal } = entity.planeFrame;
    const offset = -normal.reduce(
      (sum, value, axis) => sum + value * center[axis],
      0,
    );
    if (!Number.isFinite(offset))
      throw new Error("Invalid analytic plane equation.");
    return { kind: "plane", origin: [...center], normal: [...normal], offset };
  }
  throw new Error(
    "Construction source family is not bound to stored semantic geometry.",
  );
}

/** Each retained record owns its small resolved value, even for repeated sources. */
function copyResolvedLinePrimitive(
  input: NativeReferenceLineRecord,
): NativeReferenceLineRecord {
  const metadata = {
    ...(input.bounds
      ? {
          bounds: [
            input.bounds[0],
            input.bounds[1],
            input.bounds[2],
            input.bounds[3],
            input.bounds[4],
            input.bounds[5],
          ] as const,
        }
      : {}),
    ...(input.directPlaneHalfSizes
      ? {
          directPlaneHalfSizes: [
            input.directPlaneHalfSizes[0],
            input.directPlaneHalfSizes[1],
          ] as const,
        }
      : {}),
  };
  if (input.kind === "point")
    return { ...input, ...metadata, position: [...input.position] };
  if (input.kind === "axis")
    return {
      ...input,
      ...metadata,
      start: [...input.start],
      end: [...input.end],
    };
  if (input.kind === "plane")
    return {
      ...input,
      ...metadata,
      origin: [...input.origin],
      normal: [...input.normal],
    };
  return { ...input, ...metadata };
}

/**
 * Bind already refreshed stored point/line geometry, never display samples.
 * The host still owns dependency refresh, revision/eligibility and cancellation.
 * Unresolved CAD/sketch/scan branches reject rather than fabricate extraction.
 */
export function resolveStoredReferenceConstructionInputs(
  scene: readonly Entity[],
  input: ReferenceConstructionDefinition,
): ResolvedReferenceConstructionInputs {
  const definition = copyReferenceConstruction(input);
  const identities = resolveConstructionIdentities(
    scene,
    definition.sources.map((source) => source.id),
  );
  for (let index = 0; index < definition.sources.length; index++) {
    const expected = definition.sources[index],
      actual = identities.orderedSources[index];
    if (
      actual.id !== expected.id ||
      actual.constructionOrderKey !== expected.constructionOrderKey
    )
      throw new Error("Construction source identity changed.");
  }
  const byId = new Map(scene.map((entity) => [entity.id, entity]));
  const primitive = (
    id: string,
    mode: DerivedReferenceLineMode,
  ): NativeReferenceLineRecord => {
    const entity = byId.get(id);
    if (!entity) throw new Error("Missing construction record source.");
    return resolveReferenceLineSource(entity, mode);
  };
  if (definition.kind === "point")
    return {
      kind: "point",
      sources:
        definition.mode === "coordinates"
          ? []
          : definition.sources.map((source) => ({
              source,
              primitive: resolveReferencePointSource(byId.get(source.id)!),
            })),
    };
  const mode = definition.mode;
  if (
    mode === "endpoints" ||
    (mode === "average" && definition.sources.length === 0)
  )
    return { kind: "line", records: [] };
  const common = new Map(
    definition.sources.map((source) => [source.id, primitive(source.id, mode)]),
  );
  return {
    kind: "line",
    records: definition.records.map((record) => {
      const resolved = common.get(record.entityId);
      if (!resolved)
        throw new Error(
          "Active reference line record is outside its common source set.",
        );
      return { record, primitive: copyResolvedLinePrimitive(resolved) };
    }),
  };
}

/** Exact source records, supplied in owner child order by the scene adapter. */
export interface ReferenceSketchSourceSnapshot {
  readonly id: string;
  readonly frame: PickedSketchReferenceSource["frame"];
  readonly children: readonly {
    readonly id: string;
    readonly records: readonly ReferenceVector[] | undefined;
  }[];
}

/** Selection within one revision-bound snapshot, not a persistent viewport ID. */
export interface ReferenceSketchRecordSelection {
  readonly sourceId: string;
  readonly childId: string;
  readonly recordIndex: number;
}

export interface ResolvedSketchConstructionPick {
  /** The selected input; the later nearest-record winner can be different. */
  readonly selection: ReferenceSketchRecordSelection;
  readonly record: RetainedReferenceLinePick;
  readonly primitive: NativeReferenceLineRecord;
}

/**
 * Shared internal sketch branch: bind stable child identity and record index,
 * acquire the rounded world pick, then resolve it against all ordered records.
 * Native viewport selection numbers are ephemeral and are not application IDs.
 *
 * The scene adapter must supply genuine defining records, refresh dependencies,
 * and enforce revision/lock/eligibility/resource/cancellation checks. This pure
 * function does not derive missing legacy records, enumerate the scene, publish
 * a construction, or implement the remaining point/CAD/scan resolver branches.
 */
export function resolveSketchConstructionPick(
  snapshot: ReferenceSketchSourceSnapshot,
  selected: ReferenceSketchRecordSelection,
): ResolvedSketchConstructionPick {
  if (
    !snapshot ||
    typeof snapshot.id !== "string" ||
    !selected ||
    selected.sourceId !== snapshot.id
  )
    throw new Error("Sketch construction source does not match the selection.");
  if (typeof selected.childId !== "string" || !Array.isArray(snapshot.children))
    throw new Error(
      "Invalid sketch construction child collection or identity.",
    );

  const children = new Map<
    string,
    ReferenceSketchSourceSnapshot["children"][number]
  >();
  const records = Array.from(snapshot.children, (child) => {
    if (!child || typeof child.id !== "string" || children.has(child.id))
      throw new Error(
        "Invalid or duplicate sketch construction child identity.",
      );
    children.set(child.id, child);
    return child.records;
  });
  const child = children.get(selected.childId);
  if (!child) throw new Error("Selected sketch construction child is missing.");
  if (
    !Array.isArray(child.records) ||
    !Number.isInteger(selected.recordIndex) ||
    selected.recordIndex < 0 ||
    selected.recordIndex >= child.records.length
  )
    throw new Error(
      "Selected sketch construction record is missing or invalid.",
    );

  const coordinates = acquireSketchReferencePick(
    snapshot.frame,
    child.records[selected.recordIndex],
  );
  const primitive = resolvePickedSketchReferencePoint(
    { frame: snapshot.frame, children: records },
    coordinates,
  );
  return {
    selection: {
      sourceId: snapshot.id,
      childId: child.id,
      recordIndex: selected.recordIndex,
    },
    record: {
      entityId: snapshot.id,
      storage: "native-pick-record-f32",
      coordinates,
    },
    primitive,
  };
}

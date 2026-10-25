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
import {
  acquireSketchReferencePick,
  resolveDirectReferencePrimitive,
  resolvePickedSketchReferencePoint,
  type PickedSketchReferenceSource,
} from "./reference-source-primitives";

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
  const primitive = (id: string): NativeReferenceLineRecord => {
    const entity = byId.get(id);
    if (!entity) throw new Error("Missing construction record source.");
    const data = validateReferenceEntity(entity);
    if (!data)
      throw new Error(
        "Construction source family is not bound to stored semantic geometry.",
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
  };
  if (definition.kind === "point")
    return {
      kind: "point",
      sources:
        definition.mode === "coordinates"
          ? []
          : definition.sources.map((source) => ({
              source,
              primitive: primitive(source.id),
            })),
    };
  return {
    kind: "line",
    records:
      definition.mode === "endpoints" ||
      (definition.mode === "average" && definition.sources.length === 0)
        ? []
        : definition.records.map((record) => ({
            record,
            primitive: primitive(record.entityId),
          })),
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

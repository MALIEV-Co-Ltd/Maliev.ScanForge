import type { RetainedReferenceLinePick } from "./reference-construction";
import type { ReferenceVector } from "./reference-construction-values";
import type { NativeReferenceLineRecord } from "./reference-line-evaluation";
import {
  acquireSketchReferencePick,
  resolvePickedSketchReferencePoint,
  type PickedSketchReferenceSource,
} from "./reference-source-primitives";

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

import type { ReferenceVector } from "./reference-construction-values";
import type { PickedSketchReferenceSource } from "./reference-source-primitives";

/** Application admission budgets, not limits inferred from the native program. */
export const SKETCH_SOURCE_LIMITS = Object.freeze({
  children: 8192,
  records: 32768,
});

export type SketchSourceChildKind =
  "line" | "arc" | "circle" | "ellipse" | "spline";

export interface SketchSourceChildRecords {
  readonly id: string;
  readonly kind: SketchSourceChildKind;
  /** Original ordered local records. Undefined and an empty collection differ. */
  readonly records: readonly ReferenceVector[] | undefined;
}

/**
 * Internal source-record storage, separate from backend poles, display samples
 * and the legacy Sketch v1 graph. This is not a complete editable curve model.
 * Rebuilders supply whole child collections, including incomplete/failure state;
 * record counts alone do not establish curve validity or publication success.
 *
 * The owner frame is retained exactly. Public authoring must still enforce its
 * rigid-frame policy. No affine authoring, source admission or nested-group
 * flattening is implied by this finite-value carrier.
 */
export interface SketchSourceRecordStore {
  readonly version: 1;
  readonly id: string;
  readonly frame: PickedSketchReferenceSource["frame"];
  readonly children: readonly SketchSourceChildRecords[];
}

/** Float64 little-endian bytes encoded as lowercase hex; null means unavailable. */
export interface EncodedSketchSourceRecordStore {
  version: 1;
  id: string;
  frameBits: string;
  children: {
    id: string;
    kind: SketchSourceChildKind;
    recordsBits: string | null;
  }[];
}

function object(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid sketch source record object.");
  if (Object.keys(value).some((key) => !fields.includes(key)))
    throw new Error("Unsupported sketch source record field.");
  return value as Record<string, unknown>;
}

function identity(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Invalid sketch source identity.");
  return value;
}

function kind(value: unknown): SketchSourceChildKind {
  if (
    value !== "line" &&
    value !== "arc" &&
    value !== "circle" &&
    value !== "ellipse" &&
    value !== "spline"
  )
    throw new Error("Unsupported sketch source child kind.");
  return value;
}

function numbers(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length)
    throw new Error("Invalid sketch source coordinate dimensions.");
  return Array.from(value, (coordinate) => {
    if (typeof coordinate !== "number" || !Number.isFinite(coordinate))
      throw new Error("Sketch source coordinates must be finite numbers.");
    return coordinate;
  });
}

function frame(value: unknown): SketchSourceRecordStore["frame"] {
  if (!Array.isArray(value) || value.length !== 3)
    throw new Error("Invalid sketch source frame dimensions.");
  return Array.from(value, (row) =>
    numbers(row, 4),
  ) as unknown as SketchSourceRecordStore["frame"];
}

function children(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error("Invalid sketch source child collection.");
  if (value.length > SKETCH_SOURCE_LIMITS.children)
    throw new Error("Sketch source child budget exceeded.");
  return value;
}

function claimIdentity(id: unknown, seen: Set<string>): string {
  const result = identity(id);
  if (seen.has(result))
    throw new Error("Duplicate sketch source child identity.");
  seen.add(result);
  return result;
}

function recordBudget(count: number): void {
  if (count > SKETCH_SOURCE_LIMITS.records)
    throw new Error("Sketch source record budget exceeded.");
}

/** Validate and deeply detach without sorting, normalizing or Float32 conversion. */
export function copySketchSourceRecordStore(
  input: unknown,
): SketchSourceRecordStore {
  const value = object(input, ["version", "id", "frame", "children"]);
  if (value.version !== 1)
    throw new Error("Unsupported sketch source record version.");
  const id = identity(value.id),
    placement = frame(value.frame),
    seen = new Set<string>();
  let recordCount = 0;
  const copied = Array.from(children(value.children), (item) => {
    const child = object(item, ["id", "kind", "records"]);
    const childId = claimIdentity(child.id, seen),
      childKind = kind(child.kind);
    let records: ReferenceVector[] | undefined;
    if (child.records !== undefined) {
      if (!Array.isArray(child.records))
        throw new Error("Invalid sketch source point collection.");
      recordCount += child.records.length;
      recordBudget(recordCount);
      records = Array.from(
        child.records,
        (point) => numbers(point, 3) as unknown as ReferenceVector,
      );
    }
    return { id: childId, kind: childKind, records };
  });
  return { version: 1, id, frame: placement, children: copied };
}

function encodeNumbers(values: readonly number[]): string {
  const view = new DataView(new ArrayBuffer(values.length * 8));
  values.forEach((value, index) => view.setFloat64(index * 8, value, true));
  let result = "";
  for (let index = 0; index < view.byteLength; index++)
    result += view.getUint8(index).toString(16).padStart(2, "0");
  return result;
}

function decodeNumbers(bits: string): number[] {
  if (!/^[0-9a-f]*$/.test(bits))
    throw new Error("Invalid sketch source numeric encoding.");
  const view = new DataView(new ArrayBuffer(bits.length / 2));
  for (let index = 0; index < view.byteLength; index++)
    view.setUint8(index, parseInt(bits.slice(index * 2, index * 2 + 2), 16));
  return Array.from({ length: view.byteLength / 8 }, (_, index) => {
    const value = view.getFloat64(index * 8, true);
    if (!Number.isFinite(value))
      throw new Error("Encoded sketch source values must be finite.");
    return value;
  });
}

export function encodeSketchSourceRecordStore(
  input: SketchSourceRecordStore,
): EncodedSketchSourceRecordStore {
  const source = copySketchSourceRecordStore(input);
  return {
    version: 1,
    id: source.id,
    frameBits: encodeNumbers(source.frame.flat()),
    children: source.children.map((child) => ({
      id: child.id,
      kind: child.kind,
      recordsBits:
        child.records === undefined
          ? null
          : encodeNumbers(child.records.flat()),
    })),
  };
}

/** Decode with aggregate size admission before allocating each numeric payload. */
export function decodeSketchSourceRecordStore(
  input: unknown,
): SketchSourceRecordStore {
  const value = object(input, ["version", "id", "frameBits", "children"]);
  if (value.version !== 1)
    throw new Error("Unsupported sketch source record version.");
  const id = identity(value.id);
  if (typeof value.frameBits !== "string" || value.frameBits.length !== 12 * 16)
    throw new Error("Invalid sketch source frame encoding.");
  const placement = decodeNumbers(value.frameBits),
    seen = new Set<string>();
  let recordCount = 0;
  const decoded = Array.from(children(value.children), (item) => {
    const child = object(item, ["id", "kind", "recordsBits"]);
    const childId = claimIdentity(child.id, seen),
      childKind = kind(child.kind);
    let records: ReferenceVector[] | undefined;
    if (child.recordsBits !== null) {
      if (
        typeof child.recordsBits !== "string" ||
        child.recordsBits.length % 48 !== 0
      )
        throw new Error("Invalid sketch source point encoding.");
      const count = child.recordsBits.length / 48;
      recordCount += count;
      recordBudget(recordCount);
      const values = decodeNumbers(child.recordsBits);
      records = Array.from({ length: count }, (_, index) => [
        values[index * 3],
        values[index * 3 + 1],
        values[index * 3 + 2],
      ]);
    }
    return { id: childId, kind: childKind, records };
  });
  return {
    version: 1,
    id,
    frame: [
      placement.slice(0, 4),
      placement.slice(4, 8),
      placement.slice(8, 12),
    ] as unknown as SketchSourceRecordStore["frame"],
    children: decoded,
  };
}

/**
 * Replace whole children atomically in owner order. Rebuilders own geometry and
 * validity; this operation never merges old records into a replacement. Earlier
 * values remain detached for the future shared transaction/history boundary.
 */
export function spliceSketchSourceChildren(
  input: SketchSourceRecordStore,
  index: number,
  deleteCount: number,
  inserted: readonly SketchSourceChildRecords[],
): SketchSourceRecordStore {
  const source = copySketchSourceRecordStore(input);
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(deleteCount) ||
    index < 0 ||
    deleteCount < 0 ||
    index > source.children.length ||
    deleteCount > source.children.length - index
  )
    throw new Error("Invalid sketch source replacement range.");
  if (!Array.isArray(inserted))
    throw new Error("Invalid sketch source child collection.");
  if (
    source.children.length - deleteCount + inserted.length >
    SKETCH_SOURCE_LIMITS.children
  )
    throw new Error("Sketch source child budget exceeded.");
  const replacement = [
    ...source.children.slice(0, index),
    ...inserted,
    ...source.children.slice(index + deleteCount),
  ];
  return copySketchSourceRecordStore({ ...source, children: replacement });
}

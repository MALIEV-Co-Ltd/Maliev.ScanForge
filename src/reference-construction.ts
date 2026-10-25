import type { ConstructionIdentityAssignment } from "./reference-construction-identity";
import {
  copyReferenceGeometry,
  decodeReferenceGeometry,
  encodeReferenceGeometry,
  type ReferenceVector,
} from "./reference-construction-values";

type Source = Readonly<ConstructionIdentityAssignment>;
type Base = { readonly version: 1; readonly sources: readonly Source[] };

/** Storage precision only: source-specific coordinate-frame interpretation is unresolved. */
export interface RetainedReferenceLinePick {
  readonly entityId: string;
  readonly storage: "native-pick-record-f32";
  readonly coordinates: ReferenceVector;
}
type LineBase = {
  readonly kind: "line";
  readonly records: readonly RetainedReferenceLinePick[];
};

/** Established internal storage core; not an authoring schema or source-eligibility claim. */
export type ReferenceConstructionDefinition = Base &
  (
    | {
        readonly kind: "point";
        readonly mode: "coordinates";
        readonly position: ReferenceVector;
      }
    | {
        readonly kind: "point";
        readonly mode: "center" | "pair" | "threePlanes";
      }
    | (LineBase & {
        readonly mode: "endpoints";
        readonly start: ReferenceVector;
        readonly end: ReferenceVector;
      })
    | (LineBase & { readonly mode: "pair" | "average" })
  );

type EncodedPick = {
  readonly entityId: string;
  readonly storage: "native-pick-record-f32";
  readonly bits: string;
};
type EncodedLineBase = {
  readonly kind: "line";
  readonly records: readonly EncodedPick[];
};
export type EncodedReferenceConstruction = Base &
  (
    | {
        readonly kind: "point";
        readonly mode: "coordinates";
        readonly positionBits: string;
      }
    | {
        readonly kind: "point";
        readonly mode: "center" | "pair" | "threePlanes";
      }
    | (EncodedLineBase & {
        readonly mode: "endpoints";
        readonly startBits: string;
        readonly endBits: string;
      })
    | (EncodedLineBase & { readonly mode: "pair" | "average" })
  );

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid reference construction record.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("Invalid reference construction record prototype.");
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => typeof key !== "string" || !expected.includes(key))
  )
    throw new Error("Invalid reference construction fields.");
}

function array<T>(value: unknown, copy: (item: unknown) => T): T[] {
  if (!Array.isArray(value))
    throw new Error("Invalid reference construction collection.");
  // Array.from visits holes, so malformed sparse records cannot bypass validation.
  return Array.from(value, copy);
}

function sources(value: unknown): Source[] {
  const ids = new Set<string>();
  let previous: string | undefined;
  return array(value, (input) => {
    const source = object(input);
    keys(source, ["id", "constructionOrderKey"]);
    const id = source.id,
      key = source.constructionOrderKey;
    if (
      typeof id !== "string" ||
      typeof key !== "string" ||
      !/^[0-9a-f]{32}$/.test(key) ||
      ids.has(id) ||
      (previous !== undefined && key <= previous)
    )
      throw new Error(
        "Invalid reference construction source identity or order.",
      );
    ids.add(id);
    previous = key;
    return { id, constructionOrderKey: key };
  });
}

function vector(value: unknown): ReferenceVector {
  const geometry = copyReferenceGeometry({ kind: "point", position: value });
  if (geometry.kind !== "point")
    throw new Error("Invalid reference construction coordinate.");
  return geometry.position;
}

function decodeVector(bits: unknown): ReferenceVector {
  const geometry = decodeReferenceGeometry({ version: 1, kind: "point", bits });
  if (geometry.kind !== "point")
    throw new Error("Invalid reference construction coordinate encoding.");
  return geometry.position;
}

function encodeVector(position: ReferenceVector): string {
  return encodeReferenceGeometry({ kind: "point", position }).bits;
}

function decodePick(bits: unknown): ReferenceVector {
  if (typeof bits !== "string" || !/^[0-9a-f]{24}$/.test(bits))
    throw new Error("Invalid reference construction Float32 pick encoding.");
  const bytes = Uint8Array.from(bits.match(/../g)!, (value) =>
    parseInt(value, 16),
  );
  const view = new DataView(bytes.buffer);
  return vector([
    view.getFloat32(0, true),
    view.getFloat32(4, true),
    view.getFloat32(8, true),
  ]);
}

function encodePick(pick: RetainedReferenceLinePick): EncodedPick {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  pick.coordinates.forEach((value, index) =>
    view.setFloat32(index * 4, value, true),
  );
  return {
    entityId: pick.entityId,
    storage: pick.storage,
    bits: Array.from(bytes, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join(""),
  };
}

function records(
  value: unknown,
  encoded: boolean,
): RetainedReferenceLinePick[] {
  return array(value, (input) => {
    const pick = object(input);
    keys(pick, ["entityId", "storage", encoded ? "bits" : "coordinates"]);
    if (
      typeof pick.entityId !== "string" ||
      pick.storage !== "native-pick-record-f32"
    )
      throw new Error("Invalid reference construction retained pick.");
    const coordinates = encoded
      ? decodePick(pick.bits)
      : vector(pick.coordinates);
    if (!coordinates.every((value) => Object.is(Math.fround(value), value)))
      throw new Error(
        "Reference construction pick must contain exact finite Float32 values.",
      );
    return {
      entityId: pick.entityId,
      storage: "native-pick-record-f32",
      coordinates,
    };
  });
}

function read(
  input: unknown,
  encoded: boolean,
): ReferenceConstructionDefinition {
  const value = object(input);
  if (value.version !== 1)
    throw new Error("Invalid reference construction version.");
  const base: Base = { version: 1, sources: sources(value.sources) };
  const fields = ["version", "kind", "mode", "sources"];
  const readVector = encoded ? decodeVector : vector;
  if (value.kind === "point") {
    if (value.mode === "coordinates") {
      const field = encoded ? "positionBits" : "position";
      keys(value, [...fields, field]);
      return {
        ...base,
        kind: "point",
        mode: "coordinates",
        position: readVector(value[field]),
      };
    }
    if (
      value.mode === "center" ||
      value.mode === "pair" ||
      value.mode === "threePlanes"
    ) {
      keys(value, fields);
      return { ...base, kind: "point", mode: value.mode };
    }
  }
  if (value.kind === "line") {
    const line: LineBase = {
      kind: "line",
      records: records(value.records, encoded),
    };
    if (value.mode === "endpoints") {
      const start = encoded ? "startBits" : "start",
        end = encoded ? "endBits" : "end";
      keys(value, [...fields, "records", start, end]);
      return {
        ...base,
        ...line,
        mode: "endpoints",
        start: readVector(value[start]),
        end: readVector(value[end]),
      };
    }
    if (value.mode === "pair" || value.mode === "average") {
      keys(value, [...fields, "records"]);
      return { ...base, ...line, mode: value.mode };
    }
  }
  throw new Error("Invalid reference construction kind or mode.");
}

/** Validate/detach only. Does not look up objects, normalize, sort, deduplicate or evaluate. */
export function copyReferenceConstruction(
  input: unknown,
): ReferenceConstructionDefinition {
  return read(input, false);
}

/** JSON-safe semantic storage; current geometry/evaluation state belongs alongside this recipe. */
export function encodeReferenceConstruction(
  input: ReferenceConstructionDefinition,
): EncodedReferenceConstruction {
  const definition = copyReferenceConstruction(input);
  const base: Base = { version: 1, sources: definition.sources };
  if (definition.kind === "point") {
    if (definition.mode === "coordinates")
      return {
        ...base,
        kind: "point",
        mode: definition.mode,
        positionBits: encodeVector(definition.position),
      };
    return { ...base, kind: "point", mode: definition.mode };
  }
  const line: EncodedLineBase = {
    kind: "line",
    records: definition.records.map(encodePick),
  };
  if (definition.mode === "endpoints")
    return {
      ...base,
      ...line,
      mode: definition.mode,
      startBits: encodeVector(definition.start),
      endBits: encodeVector(definition.end),
    };
  return { ...base, ...line, mode: definition.mode };
}

export function decodeReferenceConstruction(
  input: unknown,
): ReferenceConstructionDefinition {
  return read(input, true);
}

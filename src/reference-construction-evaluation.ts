import {
  copyReferenceConstruction,
  type ReferenceConstructionDefinition,
  type RetainedReferenceLinePick,
} from "./reference-construction";
import type { ConstructionIdentityAssignment } from "./reference-construction-identity";
import {
  copyReferenceGeometry,
  type ReferenceGeometry,
} from "./reference-construction-values";
import {
  evaluateNativeReferencePoint,
  type NativeReferencePointEvaluation,
  type ResolvedReferencePrimitive,
} from "./reference-point-evaluation";
import {
  evaluateNativeReferenceLine,
  setNativeReferenceLineEndpoints,
  type NativeReferenceLineEvaluation,
  type NativeReferenceLineRecord,
} from "./reference-line-evaluation";

export interface ReferenceConstructionState {
  readonly geometry: ReferenceGeometry;
  /** Internal model state, never a caller-editable construction parameter. */
  readonly state: { readonly completionWord: number };
}

export type ResolvedReferenceConstructionInputs =
  | {
      readonly kind: "point";
      readonly sources: readonly {
        readonly source: Readonly<ConstructionIdentityAssignment>;
        readonly primitive: ResolvedReferencePrimitive;
      }[];
    }
  | {
      readonly kind: "line";
      readonly records: readonly {
        readonly record: RetainedReferenceLinePick;
        readonly primitive: NativeReferenceLineRecord;
      }[];
    };

export interface ReferenceConstructionNumericEdit extends ReferenceConstructionState {
  readonly written: boolean;
  readonly reason:
    | "point-coordinates"
    | "line-endpoints"
    | "degenerate-endpoints"
    | "derived-mode";
}

export interface ReferenceConstructionEvaluation extends ReferenceConstructionState {
  readonly outcome:
    | NativeReferencePointEvaluation["outcome"]
    | NativeReferenceLineEvaluation["outcome"];
  readonly diagnostics: {
    readonly reason:
      | NativeReferencePointEvaluation["reason"]
      | NativeReferenceLineEvaluation["reason"];
    readonly sourceCount: number;
    readonly recordCount: number;
    readonly contributingRecords?: number;
  };
}

function checkedState(
  definition: ReferenceConstructionDefinition,
  input: ReferenceConstructionState,
): ReferenceConstructionState {
  const geometry = copyReferenceGeometry(input.geometry);
  const completionWord = input.state?.completionWord;
  if (
    geometry.kind !== definition.kind ||
    !Number.isInteger(completionWord) ||
    completionWord < 0 ||
    completionWord > 0xffff
  )
    throw new Error("Invalid reference construction state.");
  return { geometry, state: { completionWord } };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function bindingError(): never {
  throw new Error(
    "Resolved reference construction inputs do not match the definition.",
  );
}

function primitive(value: unknown): NativeReferenceLineRecord {
  const input = object(value);
  if (
    !input ||
    typeof input.kind !== "string" ||
    !["point", "axis", "plane", "unavailable"].includes(input.kind) ||
    (input.objectResolved !== undefined &&
      typeof input.objectResolved !== "boolean")
  )
    bindingError();
  // Geometry-specific finite-value checks remain in the native arithmetic helpers.
  return input as NativeReferenceLineRecord;
}

function pointInputs(
  definition: ReferenceConstructionDefinition,
  input: unknown,
): ResolvedReferencePrimitive[] {
  const bundle = object(input);
  if (
    bundle?.kind !== "point" ||
    !Array.isArray(bundle.sources) ||
    bundle.sources.length !== definition.sources.length
  )
    bindingError();
  return Array.from(bundle.sources, (value, index) => {
    const row = object(value),
      source = object(row?.source),
      expected = definition.sources[index];
    if (
      !row ||
      source?.id !== expected.id ||
      source?.constructionOrderKey !== expected.constructionOrderKey
    )
      bindingError();
    return primitive(row.primitive);
  });
}

function lineInputs(
  definition: ReferenceConstructionDefinition & { kind: "line" },
  input: unknown,
): NativeReferenceLineRecord[] {
  const bundle = object(input);
  if (
    bundle?.kind !== "line" ||
    !Array.isArray(bundle.records) ||
    bundle.records.length !== definition.records.length
  )
    bindingError();
  return Array.from(bundle.records, (value, index) => {
    const row = object(value),
      record = object(row?.record),
      expected = definition.records[index];
    if (
      !row ||
      record?.entityId !== expected.entityId ||
      record.storage !== expected.storage ||
      !Array.isArray(record.coordinates) ||
      record.coordinates.length !== 3 ||
      !expected.coordinates.every((coordinate, axis) =>
        Object.is(coordinate, (record.coordinates as unknown[])[axis]),
      )
    )
      bindingError();
    return primitive(row.primitive);
  });
}

/**
 * The numeric-controller write only, using canonical millimeter inputs.
 * No evaluation/publication is implied, and the completion word is preserved.
 * Unit conversion and later publication/graph scheduling belong to the shared host.
 */
export function applyReferenceConstructionNumericInputs(
  input: ReferenceConstructionDefinition,
  prior: ReferenceConstructionState,
): ReferenceConstructionNumericEdit {
  const definition = copyReferenceConstruction(input);
  const previous = checkedState(definition, prior);
  if (definition.kind === "point" && definition.mode === "coordinates")
    return {
      geometry: { kind: "point", position: definition.position },
      state: previous.state,
      written: true,
      reason: "point-coordinates",
    };
  if (
    definition.kind === "line" &&
    definition.mode === "endpoints" &&
    previous.geometry.kind === "line"
  ) {
    const edited = setNativeReferenceLineEndpoints(
      previous.geometry,
      definition.start,
      definition.end,
      "typed",
    );
    return {
      geometry: edited.geometry,
      state: previous.state,
      written: edited.written,
      reason: edited.written ? "line-endpoints" : "degenerate-endpoints",
    };
  }
  return { ...previous, written: false, reason: "derived-mode" };
}

/**
 * Geometry evaluation only, after source refresh and any explicit numeric edit.
 * Stored modes retain prior geometry; this never reapplies typed parameters.
 * Active derived modes require a complete, order-matched resolved bundle.
 * An average with no common sources skips records and re-finalizes prior endpoints.
 * Binding validation is an internal resolver contract, not scene existence,
 * source eligibility, revision/authorization validation or native UI admission.
 */
export function evaluateReferenceConstruction(
  input: ReferenceConstructionDefinition,
  resolvedInputs: unknown,
  prior: ReferenceConstructionState,
  evaluationAllowed = true,
): ReferenceConstructionEvaluation {
  const definition = copyReferenceConstruction(input);
  const previous = checkedState(definition, prior);
  if (typeof evaluationAllowed !== "boolean")
    throw new Error("Invalid reference construction guard.");
  let result: NativeReferencePointEvaluation | NativeReferenceLineEvaluation;
  if (definition.kind === "point" && previous.geometry.kind === "point") {
    const mode = definition.mode === "coordinates" ? "stored" : definition.mode;
    const inputs =
      evaluationAllowed && mode !== "stored"
        ? pointInputs(definition, resolvedInputs)
        : [];
    result = evaluateNativeReferencePoint(
      mode,
      inputs,
      {
        geometry: previous.geometry,
        completionWord: previous.state.completionWord,
      },
      evaluationAllowed,
    );
  } else if (definition.kind === "line" && previous.geometry.kind === "line") {
    const mode = definition.mode === "endpoints" ? "stored" : definition.mode;
    const records =
      evaluationAllowed &&
      mode !== "stored" &&
      (mode !== "average" || definition.sources.length !== 0)
        ? lineInputs(definition, resolvedInputs)
        : [];
    result = evaluateNativeReferenceLine(
      mode,
      records,
      {
        geometry: previous.geometry,
        completionWord: previous.state.completionWord,
      },
      { evaluationAllowed, commonInputCount: definition.sources.length },
    );
  } else throw new Error("Invalid reference construction state.");
  return {
    geometry: result.geometry,
    state: { completionWord: result.completionWord },
    outcome: result.outcome,
    diagnostics: {
      reason: result.reason,
      sourceCount: definition.sources.length,
      recordCount: definition.kind === "line" ? definition.records.length : 0,
      ...("contributingRecords" in result
        ? { contributingRecords: result.contributingRecords }
        : {}),
    },
  };
}

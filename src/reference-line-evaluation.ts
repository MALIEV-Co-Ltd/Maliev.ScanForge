import {
  copyReferenceGeometry,
  referenceLineEnd,
  type ReferenceLineGeometry,
  type ReferenceVector,
} from "./reference-construction-values";
import { nativeReferenceNormalize } from "./reference-geometry-numerics";
import {
  nativeReferenceLinePairEndpoints,
  type NativeReferenceLineRecord,
  type NativeReferenceLinePairCandidate,
} from "./reference-line-pairs";
export type { NativeReferenceLineRecord } from "./reference-line-pairs";

export interface NativeReferenceLineState {
  readonly geometry: ReferenceLineGeometry;
  readonly completionWord: number;
}
export interface NativeReferenceLineContext {
  readonly evaluationAllowed: boolean;
  /** Common dependency set count, independent of retained pick-record count. */
  readonly commonInputCount: number;
}
export interface NativeReferenceLineEvaluation extends NativeReferenceLineState {
  readonly outcome: "updated" | "fallback" | "unchanged";
  readonly reason:
    | "evaluation-disabled"
    | "stored-coordinates"
    | "degenerate-endpoints"
    | "previous-endpoints"
    | "average-new-extent"
    | "average-prior-extent"
    | NativeReferenceLinePairCandidate["reason"];
  readonly contributingRecords: number;
}

function lineCopy(input: ReferenceLineGeometry): ReferenceLineGeometry {
  const geometry = copyReferenceGeometry(input);
  if (geometry.kind !== "line")
    throw new Error("Expected reference line geometry.");
  return geometry;
}

function vector(input: readonly number[]): ReferenceVector {
  const point = copyReferenceGeometry({ kind: "point", position: input });
  if (point.kind !== "point")
    throw new Error("Expected reference coordinates.");
  return point.position;
}

/** Inner setter/controller geometry writes, without the outer evaluation word. */
export function setNativeReferenceLineEndpoints(
  prior: ReferenceLineGeometry,
  startInput: ReferenceVector,
  endInput: ReferenceVector,
  order: "setter" | "typed" = "setter",
): { geometry: ReferenceLineGeometry; written: boolean } {
  const previous = lineCopy(prior);
  const start = vector(startInput),
    end = vector(endInput);
  const dx = end[0] - start[0],
    dy = end[1] - start[1],
    dz = end[2] - start[2];
  const length = Math.sqrt(
    order === "typed"
      ? dx * dx + dy * dy + dz * dz
      : dy * dy + dx * dx + dz * dz,
  );
  if (!Number.isFinite(length))
    throw new Error("Reference line endpoint arithmetic overflow.");
  if (!(Number.EPSILON < length)) return { geometry: previous, written: false };
  const reciprocal = 1 / length;
  return {
    geometry: lineCopy({
      kind: "line",
      start,
      direction: [dx * reciprocal, dy * reciprocal, dz * reciprocal],
      length,
    }),
    written: true,
  };
}

/** New-command seed before typed/preselection edits; finite Float32 bounds only. */
export function initializeNativeReferenceLine(
  sceneBounds: readonly number[] | Float32Array,
): NativeReferenceLineState {
  if (
    !(Array.isArray(sceneBounds) || sceneBounds instanceof Float32Array) ||
    sceneBounds.length !== 6
  )
    throw new Error("Reference line initialization requires six scene bounds.");
  const bounds = Array.from(sceneBounds, (value) => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isFinite(Math.fround(value))
    )
      throw new Error(
        "Reference line scene bounds require finite Float32 carriers.",
      );
    return Math.fround(value);
  });
  const maxFloat = 3.4028234663852886e38;
  const fallback = [0, 1, 2].some(
    (axis) =>
      bounds[axis + 3] < bounds[axis] ||
      bounds[axis] <= -maxFloat ||
      bounds[axis + 3] >= maxFloat,
  );
  const cleared: ReferenceLineGeometry = {
    kind: "line",
    start: [0, 0, 0],
    direction: [0, 0, 0],
    length: 0,
  };
  const start: ReferenceVector = [fallback ? 0 : bounds[0], 0, 0];
  const end: ReferenceVector = [fallback ? 10 : bounds[3], 0, 0];
  return {
    geometry: setNativeReferenceLineEndpoints(cleared, start, end, "setter")
      .geometry,
    completionWord: 0x100,
  };
}

function dotYXZ(a: readonly number[], b: readonly number[]): number {
  return a[1] * b[1] + a[0] * b[0] + a[2] * b[2];
}

function projectedEndpoint(
  old: ReferenceVector,
  center: ReferenceVector,
  direction: readonly number[],
): ReferenceVector {
  const distance =
    (old[1] - center[1]) * direction[1] +
    (old[0] - center[0]) * direction[0] +
    (old[2] - center[2]) * direction[2];
  return [
    direction[0] * distance + center[0],
    direction[1] * distance + center[1],
    direction[2] * distance + center[2],
  ];
}

/**
 * Internal static-contract evaluator. Caller owns ordered pick extraction and
 * dependency refresh; no record deduplication or source lookup occurs here.
 * Source-resolution failures and native numerical acceptance remain separate.
 */
export function evaluateNativeReferenceLine(
  mode: "stored" | "average" | "pair",
  orderedRecords: readonly NativeReferenceLineRecord[],
  prior: NativeReferenceLineState,
  context: NativeReferenceLineContext,
): NativeReferenceLineEvaluation {
  const previous = lineCopy(prior.geometry);
  if (
    !Number.isInteger(prior.completionWord) ||
    prior.completionWord < 0 ||
    prior.completionWord > 0xffff ||
    !Number.isSafeInteger(context.commonInputCount) ||
    context.commonInputCount < 0
  )
    throw new Error("Invalid reference line evaluation state.");
  const unchanged = (
    reason: NativeReferenceLineEvaluation["reason"],
    completionWord: number,
  ): NativeReferenceLineEvaluation => ({
    geometry: previous,
    completionWord,
    outcome: "unchanged",
    reason,
    contributingRecords: 0,
  });
  if (!context.evaluationAllowed)
    return unchanged("evaluation-disabled", prior.completionWord);
  if (mode === "stored") return unchanged("stored-coordinates", 0x100);
  if (mode !== "average" && mode !== "pair")
    throw new Error("Unsupported reference line mode.");

  let start = previous.start,
    end = referenceLineEnd(previous);
  let reason: NativeReferenceLineEvaluation["reason"] = "previous-endpoints";
  let count = 0;
  if (mode === "pair") {
    const candidate = nativeReferenceLinePairEndpoints(
      orderedRecords,
      previous,
    );
    start = candidate.start;
    end = candidate.end;
    reason = candidate.reason;
    count = candidate.contributingRecords;
  } else if (context.commonInputCount !== 0) {
    let maximumHalfLength = 0;
    let directionSum = [0, 0, 0];
    const midpointSum = [0, 0, 0];
    for (const record of orderedRecords) {
      if (record.objectResolved === false || record.kind !== "axis") continue;
      const a = vector(record.start),
        b = vector(record.end);
      count++;
      const dx = a[0] - b[0],
        dy = a[1] - b[1],
        dz = a[2] - b[2];
      const halfLength = Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5;
      if (!Number.isFinite(halfLength))
        throw new Error("Reference average axis length overflow.");
      if (maximumHalfLength <= halfLength) maximumHalfLength = halfLength;
      const direction = nativeReferenceNormalize([
        b[0] - a[0],
        b[1] - a[1],
        b[2] - a[2],
      ]);
      for (let i = 0; i < 3; i++)
        midpointSum[i] = midpointSum[i] + (b[i] + a[i]) * 0.5;
      if (2 ** -23 <= dotYXZ(directionSum, directionSum)) {
        if (dotYXZ(direction, directionSum) < 0)
          for (let i = 0; i < 3; i++) direction[i] = -direction[i];
        for (let i = 0; i < 3; i++)
          directionSum[i] = directionSum[i] + direction[i];
      } else directionSum = direction;
    }
    if (count !== 0 && 2 ** -23 < dotYXZ(directionSum, directionSum)) {
      const direction = nativeReferenceNormalize(directionSum);
      const reciprocalCount = 1 / count;
      const center: ReferenceVector = [
        reciprocalCount * midpointSum[0],
        reciprocalCount * midpointSum[1],
        reciprocalCount * midpointSum[2],
      ];
      if (previous.length <= 2 ** -23) {
        start = [
          center[0] - direction[0] * maximumHalfLength,
          center[1] - direction[1] * maximumHalfLength,
          center[2] - direction[2] * maximumHalfLength,
        ];
        end = [
          direction[0] * maximumHalfLength + center[0],
          direction[1] * maximumHalfLength + center[1],
          direction[2] * maximumHalfLength + center[2],
        ];
        reason = "average-new-extent";
      } else {
        start = projectedEndpoint(start, center, direction);
        end = projectedEndpoint(end, center, direction);
        reason = "average-prior-extent";
      }
    }
  }
  const finalized = setNativeReferenceLineEndpoints(previous, start, end);
  return {
    geometry: finalized.geometry,
    completionWord: 0x100,
    outcome: finalized.written
      ? reason === "previous-endpoints" ||
        reason === "axis-projection-fallback" ||
        reason === "plane-projection-fallback"
        ? "fallback"
        : "updated"
      : "unchanged",
    reason: finalized.written ? reason : "degenerate-endpoints",
    contributingRecords: count,
  };
}

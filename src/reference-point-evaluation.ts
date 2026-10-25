import {
  copyReferenceGeometry,
  type ReferencePointGeometry,
  type ReferenceVector,
} from "./reference-construction-values";
import {
  nativeReferenceClosestLines,
  nativeReferenceNormalize,
  nativeReferencePlaneIntersection,
} from "./reference-geometry-numerics";

type Axis = {
  readonly kind: "axis";
  readonly start: ReferenceVector;
  readonly end: ReferenceVector;
};
type Plane = {
  readonly kind: "plane";
  readonly origin: ReferenceVector;
  readonly normal: ReferenceVector;
  readonly offset: number;
};
/** Extractor outputs, already in common-source raw-key order. Sphere centers resolve as points. */
export type ResolvedReferencePrimitive =
  ReferencePointGeometry | Axis | Plane | { readonly kind: "unavailable" };
export type NativeReferencePointMode =
  "stored" | "center" | "pair" | "threePlanes";
export interface NativeReferencePointState {
  readonly geometry: ReferencePointGeometry;
  readonly completionWord: number;
}
export interface NativeReferencePointEvaluation extends NativeReferencePointState {
  readonly outcome: "updated" | "fallback" | "origin" | "unchanged";
  readonly reason:
    | "evaluation-disabled"
    | "stored-coordinates"
    | "center"
    | "source-extraction-failed"
    | "pair"
    | "axis-midpoints"
    | "axis-plane-nearly-parallel"
    | "three-planes"
    | "three-plane-intersection-failed";
}

function point(position: readonly number[]): ReferencePointGeometry {
  return copyReferenceGeometry({
    kind: "point",
    position,
  }) as ReferencePointGeometry;
}

function checked(
  input: ResolvedReferencePrimitive,
): ResolvedReferencePrimitive {
  switch (input.kind) {
    case "unavailable":
      return { kind: "unavailable" };
    case "point":
      return point(input.position);
    case "axis":
      return {
        kind: "axis",
        start: point(input.start).position,
        end: point(input.end).position,
      };
    case "plane":
      if (!Number.isFinite(input.offset))
        throw new Error("Invalid reference plane offset.");
      return {
        kind: "plane",
        origin: point(input.origin).position,
        normal: point(input.normal).position,
        offset: input.offset,
      };
    default:
      throw new Error("Unsupported resolved reference primitive.");
  }
}

function delta(axis: Axis): ReferenceVector {
  return [
    axis.end[0] - axis.start[0],
    axis.end[1] - axis.start[1],
    axis.end[2] - axis.start[2],
  ];
}

function midpoint(a: readonly number[], b: readonly number[]): ReferenceVector {
  return [(b[0] + a[0]) * 0.5, (b[1] + a[1]) * 0.5, (b[2] + a[2]) * 0.5];
}

/** These branches sum Y, X, Z; the shared normalizer/closest-line helper differs. */
function dotYXZ(a: readonly number[], b: readonly number[]): number {
  return a[1] * b[1] + a[0] * b[0] + a[2] * b[2];
}

function projectAxis(position: ReferenceVector, axis: Axis): ReferenceVector {
  const direction = delta(axis);
  const offset = [
    position[0] - axis.start[0],
    position[1] - axis.start[1],
    position[2] - axis.start[2],
  ];
  const distance = dotYXZ(offset, direction) / dotYXZ(direction, direction);
  return [
    direction[0] * distance + axis.start[0],
    direction[1] * distance + axis.start[1],
    direction[2] * distance + axis.start[2],
  ];
}

function projectPlane(
  position: ReferenceVector,
  plane: Plane,
): ReferenceVector {
  const distance = dotYXZ(position, plane.normal) + plane.offset;
  return [
    position[0] - distance * plane.normal[0],
    position[1] - distance * plane.normal[1],
    position[2] - distance * plane.normal[2],
  ];
}

function intersectPlane(
  start: readonly number[],
  direction: readonly number[],
  plane: Plane,
  threePlaneBranch: boolean,
): ReferenceVector | undefined {
  const denominator = dotYXZ(direction, plane.normal);
  if (!(dotYXZ(direction, direction) * 0.0001 < denominator * denominator))
    return undefined;
  const n = plane.normal;
  const anchorDot = threePlaneBranch
    ? plane.origin[0] * n[0] + plane.origin[1] * n[1] + plane.origin[2] * n[2]
    : dotYXZ(n, plane.origin);
  // Keep the sequential subtractions, rather than subtracting a pre-summed dot.
  const distance =
    (anchorDot - start[0] * n[0] - start[1] * n[1] - start[2] * n[2]) /
    denominator;
  return [
    distance * direction[0] + start[0],
    distance * direction[1] + start[1],
    distance * direction[2] + start[2],
  ];
}

/**
 * Static-contract numerical implementation, not yet native execution acceptance.
 * The caller owns source-ID deduplication/order, extraction, dependency refresh,
 * request validation and controller writes for typed coordinates. `unavailable`
 * represents a failed native extractor, not permission to accept a missing API ID.
 * Only finite, non-overflowing outputs may enter the persistent semantic model.
 */
export function evaluateNativeReferencePoint(
  mode: NativeReferencePointMode,
  orderedInputs: readonly ResolvedReferencePrimitive[],
  prior: NativeReferencePointState,
  evaluationAllowed = true,
): NativeReferencePointEvaluation {
  const previous = copyReferenceGeometry(prior.geometry);
  if (
    previous.kind !== "point" ||
    !Number.isInteger(prior.completionWord) ||
    prior.completionWord < 0 ||
    prior.completionWord > 0xffff
  )
    throw new Error("Invalid reference point evaluation state.");
  const unchanged = (
    reason: NativeReferencePointEvaluation["reason"],
    completionWord = prior.completionWord,
  ): NativeReferencePointEvaluation => ({
    geometry: previous,
    completionWord,
    outcome: "unchanged",
    reason,
  });
  const written = (
    position: readonly number[],
    outcome: "updated" | "fallback" | "origin",
    reason: NativeReferencePointEvaluation["reason"],
  ): NativeReferencePointEvaluation => ({
    geometry: point(position),
    completionWord: 0x100,
    outcome,
    reason,
  });
  const origin = (
    reason: NativeReferencePointEvaluation["reason"] = "source-extraction-failed",
  ) => written([0, 0, 0], "origin", reason);
  if (!evaluationAllowed) return unchanged("evaluation-disabled");
  if (mode === "stored") return unchanged("stored-coordinates", 0x100);
  const inputs = orderedInputs.map(checked);
  const a = inputs[0],
    b = inputs[1];
  if (mode === "center") {
    if (a?.kind === "axis")
      return written(midpoint(a.start, a.end), "updated", "center");
    if (a?.kind === "point") return written(a.position, "updated", "center");
    return origin();
  }
  if (mode === "threePlanes") {
    const c = inputs[2];
    if (
      inputs.length !== 3 ||
      a?.kind !== "plane" ||
      b?.kind !== "plane" ||
      c?.kind !== "plane"
    )
      return origin();
    const intersection = nativeReferencePlaneIntersection(
      a.normal,
      a.offset,
      b.normal,
      b.offset,
      0.001,
    );
    const position =
      intersection &&
      intersectPlane(intersection.point, intersection.direction, c, true);
    return position
      ? written(position, "updated", "three-planes")
      : origin("three-plane-intersection-failed");
  }
  if (mode !== "pair") throw new Error("Unsupported reference point mode.");
  if (!a || !b || a.kind === "unavailable" || b.kind === "unavailable")
    return origin();
  if (a.kind === "point" && b.kind === "point")
    return written(midpoint(a.position, b.position), "updated", "pair");
  if (a.kind === "point" && b.kind === "axis")
    return written(projectAxis(a.position, b), "updated", "pair");
  if (a.kind === "axis" && b.kind === "point")
    return written(projectAxis(b.position, a), "updated", "pair");
  if (a.kind === "point" && b.kind === "plane")
    return written(projectPlane(a.position, b), "updated", "pair");
  if (a.kind === "plane" && b.kind === "point")
    return written(projectPlane(b.position, a), "updated", "pair");
  if (
    (a.kind === "axis" && b.kind === "plane") ||
    (a.kind === "plane" && b.kind === "axis")
  ) {
    const axis = (a.kind === "axis" ? a : b) as Axis;
    const plane = (a.kind === "plane" ? a : b) as Plane;
    const position = intersectPlane(
      axis.start,
      nativeReferenceNormalize(delta(axis)),
      plane,
      false,
    );
    return position
      ? written(position, "updated", "pair")
      : unchanged("axis-plane-nearly-parallel");
  }
  if (a.kind === "axis" && b.kind === "axis") {
    const u = delta(a),
      v = delta(b);
    const dot = dotYXZ(
      nativeReferenceNormalize(u),
      nativeReferenceNormalize(v),
    );
    if (Math.abs(dot) <= Math.cos(0.017453292519943295)) {
      const closest = nativeReferenceClosestLines(
        a.start,
        u,
        b.start,
        v,
        2 ** -23,
      );
      if (closest)
        return written(
          midpoint(closest.first, closest.second),
          "updated",
          "pair",
        );
    }
    return written(
      midpoint(midpoint(a.start, a.end), midpoint(b.start, b.end)),
      "fallback",
      "axis-midpoints",
    );
  }
  return origin();
}

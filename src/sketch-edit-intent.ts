import type { ParametricProfile } from "./parametric";
import { resetSketchRectangle } from "./sketch-authoring";
import { coordinateSketchFrame, sketchWorldPoint } from "./sketch-frame";
import {
  removeSketchGeometry,
  sketchCurveProfile,
  solveSketch,
  validateSketch,
  type Sketch,
  type SketchConstraint,
  type SketchSolution,
} from "./sketch";

/** Operation-local admission; stored projects and numeric edits have no draw-size cap. */
export const SKETCH_EDIT_LIMITS = Object.freeze({
  validationWork: 2_000_000,
  referenceCoordinates: 2_000_000,
});
export class SketchEditResourceLimit extends Error {
  readonly code = "RESOURCE_LIMIT";
  constructor(detail: string) {
    super(
      `Sketch editing ${detail}. No changes were applied. Use a smaller sketch or split the operation.`,
    );
    this.name = "SketchEditResourceLimit";
  }
}
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
export type SketchConstraintIntent =
  | { kind: "fixed"; point: string }
  | WithoutId<Exclude<SketchConstraint, { kind: "fixed" }>>;
export type SketchEditIntent =
  | { kind: "preset"; profile: "rectangle" | "circle" }
  | { kind: "plane"; plane: "OXY" | "OYZ" | "OXZ" }
  | { kind: "planeOffset"; offsetMm: number }
  | { kind: "pointAdd"; position?: readonly [number, number] }
  | { kind: "pointSet"; pointId: string; x?: number; y?: number }
  | { kind: "segmentAdd"; a?: string; b?: string }
  | { kind: "segmentSet"; segmentId: string; a?: string; b?: string }
  | {
      kind: "arcAdd";
      a?: string;
      b?: string;
      center?: string;
      clockwise?: boolean;
    }
  | {
      kind: "arcSet";
      arcId: string;
      a?: string;
      b?: string;
      center?: string;
      clockwise?: boolean;
    }
  | { kind: "construction"; curveId: string; enabled: boolean }
  | {
      kind: "remove";
      target: "point" | "segment" | "arc" | "constraint";
      id: string;
    }
  | { kind: "dimension"; constraintId: string; value: number }
  | { kind: "constraintAdd"; constraint: SketchConstraintIntent }
  | {
      kind: "solve";
      tolerance?: number;
      maxIterations?: number;
      forProfile?: boolean;
    };
export interface SketchEditResult {
  sketch: Sketch;
  changed: boolean;
  createdPointIds: string[];
  createdCurveIds: string[];
  createdConstraintIds: string[];
  removedPointIds: string[];
  removedCurveIds: string[];
  removedConstraintIds: string[];
  solution?: SketchSolution;
  profile?: ParametricProfile;
}
export type SketchEditReceipt = Omit<SketchEditResult, "sketch">;
export interface SketchEditOptions {
  check?: () => void;
  signal?: AbortSignal;
  createId?: () => string;
}

function fields(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = [],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error("Invalid semantic sketch edit object.");
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    throw Error("Invalid or ambiguous semantic sketch edit fields.");
}
function number(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1e9
  )
    throw Error(
      "Sketch edit coordinates and dimensions must be finite and within +/-1e9.",
    );
  return value;
}
function identity(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw Error("Sketch edit identity is required.");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw Error("Sketch edit flag must be Boolean.");
  return value;
}
function admit(
  sketch: Sketch,
  extra: { points?: number; curves?: number; constraints?: number } = {},
): void {
  if (
    !sketch ||
    !Array.isArray(sketch.points) ||
    !Array.isArray(sketch.segments) ||
    !Array.isArray(sketch.constraints) ||
    (sketch.arcs !== undefined && !Array.isArray(sketch.arcs))
  )
    throw Error("Unsupported sketch structure.");
  const points = sketch.points.length + (extra.points ?? 0);
  const curves =
    sketch.segments.length + (sketch.arcs?.length ?? 0) + (extra.curves ?? 0);
  const constraints = sketch.constraints.length + (extra.constraints ?? 0);
  const referenceCoordinates = Array.isArray(sketch.reference?.segments)
    ? sketch.reference.segments.length
    : 0;
  const work =
    points +
    curves +
    referenceCoordinates +
    constraints * (8 + points + curves);
  if (
    referenceCoordinates > SKETCH_EDIT_LIMITS.referenceCoordinates ||
    work > SKETCH_EDIT_LIMITS.validationWork
  )
    throw new SketchEditResourceLimit("validation work limit exceeded");
}
function validate(sketch: Sketch, check: () => void): void {
  admit(sketch);
  validateSketch(sketch);
  const frame = sketch.frame;
  for (let index = 0; index < sketch.points.length; index++) {
    if ((index & 1023) === 0) check();
    const point = sketch.points[index];
    number(point.x);
    number(point.y);
    if (frame) sketchWorldPoint(frame, [point.x, point.y]);
  }
  for (const constraint of sketch.constraints) {
    if ("value" in constraint) number(constraint.value);
    if (constraint.kind === "fixed") {
      number(constraint.x);
      number(constraint.y);
    }
  }
}
function sameItems(
  a: readonly object[] | undefined,
  b: readonly object[] | undefined,
): boolean {
  return (
    a === b ||
    ((a?.length ?? 0) === (b?.length ?? 0) &&
      (a ?? []).every((item, index) => {
        const other = b![index];
        return (
          item === other ||
          (Object.keys(item).length === Object.keys(other).length &&
            Object.entries(item).every(([key, value]) =>
              Object.is(value, Reflect.get(other, key)),
            ))
        );
      }))
  );
}
function sameSketch(a: Sketch, b: Sketch): boolean {
  const sameFrame =
    a.frame === b.frame ||
    (!!a.frame &&
      !!b.frame &&
      (["origin", "u", "v", "normal"] as const).every((key) =>
        a.frame![key].every((value, index) =>
          Object.is(value, b.frame![key][index]),
        ),
      ));
  return (
    sameFrame &&
    a.reference === b.reference &&
    sameItems(a.points, b.points) &&
    sameItems(a.segments, b.segments) &&
    sameItems(a.arcs, b.arcs) &&
    sameItems(a.constraints, b.constraints)
  );
}
function difference(
  next: readonly { id: string }[],
  before: readonly { id: string }[],
): string[] {
  const ids = new Set(before.map((item) => item.id));
  return next.filter((item) => !ids.has(item.id)).map((item) => item.id);
}
function constraint(
  input: SketchConstraintIntent,
  sketch: Sketch,
  id: string,
): SketchConstraint {
  const map: Record<SketchConstraint["kind"], string[]> = {
    fixed: ["point"],
    coincident: ["a", "b"],
    horizontal: ["segment"],
    vertical: ["segment"],
    distance: ["a", "b", "value"],
    horizontalDistance: ["a", "b", "value"],
    verticalDistance: ["a", "b", "value"],
    radius: ["arc", "value"],
    symmetric: ["first", "second", "axis", "reverse"],
    tangent: ["first", "second", "point"],
    parallel: ["first", "second"],
    perpendicular: ["first", "second"],
    equal: ["first", "second"],
    collinear: ["first", "second"],
    angle: ["first", "second", "value"],
  };
  if (
    !input ||
    typeof input.kind !== "string" ||
    !Object.hasOwn(map, input.kind)
  )
    throw Error("Unknown sketch constraint kind.");
  const keys = map[input.kind];
  fields(input, ["kind", ...keys], ["kind", ...keys]);
  for (const key of keys) {
    const value = Reflect.get(input, key);
    if (key === "value") number(value);
    else if (key === "reverse") boolean(value);
    else identity(value);
  }
  if (input.kind === "fixed") {
    const point = sketch.points.find((point) => point.id === input.point);
    if (!point) throw Error("Constraint point is missing.");
    return { id, kind: "fixed", point: input.point, x: point.x, y: point.y };
  }
  return { ...input, id };
}

/** One immutable semantic edit. The host owns revision, publication and scoped history. */
export function applySketchEditIntent(
  sketch: Sketch,
  intent: SketchEditIntent,
  options: SketchEditOptions = {},
): SketchEditResult {
  const check = () => {
    options.signal?.throwIfAborted();
    options.check?.();
    options.signal?.throwIfAborted();
  };
  check();
  // Stored graphs admit finite coordinates outside the editing bounds. Validate
  // their structure/work first so remove, reset and coordinate repair remain
  // possible; enforce prospective world/UV bounds before publishing below.
  admit(sketch);
  validateSketch(sketch);
  check();
  fields(
    intent,
    [
      "kind",
      "profile",
      "plane",
      "offsetMm",
      "position",
      "pointId",
      "x",
      "y",
      "a",
      "b",
      "segmentId",
      "arcId",
      "center",
      "clockwise",
      "curveId",
      "enabled",
      "target",
      "id",
      "constraintId",
      "value",
      "constraint",
      "tolerance",
      "maxIterations",
      "forProfile",
    ],
    ["kind"],
  );
  const newId = () =>
    identity((options.createId ?? (() => crypto.randomUUID()))());
  let next = sketch,
    solution: SketchSolution | undefined,
    profile: ParametricProfile | undefined;
  switch (intent.kind) {
    case "preset":
      fields(intent, ["kind", "profile"], ["kind", "profile"]);
      if (intent.profile === "rectangle") next = resetSketchRectangle(sketch);
      else if (intent.profile === "circle")
        next = {
          ...sketch,
          version: 1,
          points: [
            { id: "center", x: 0, y: 0 },
            { id: "east", x: 10, y: 0 },
            { id: "west", x: -10, y: 0 },
          ],
          segments: [],
          arcs: [
            {
              id: "upper",
              a: "east",
              b: "west",
              center: "center",
              clockwise: false,
            },
            {
              id: "lower",
              a: "west",
              b: "east",
              center: "center",
              clockwise: false,
            },
          ],
          constraints: [
            { id: "origin", kind: "fixed", point: "center", x: 0, y: 0 },
            { id: "anchor", kind: "fixed", point: "east", x: 10, y: 0 },
            { id: "radius-upper", kind: "radius", arc: "upper", value: 10 },
            { id: "radius-lower", kind: "radius", arc: "lower", value: 10 },
          ],
        };
      else throw Error("Unknown sketch preset.");
      break;
    case "plane": {
      fields(intent, ["kind", "plane"], ["kind", "plane"]);
      const frame = sketch.frame ?? coordinateSketchFrame("OXY", 0);
      const offset = frame.origin.reduce(
        (sum, value, index) => sum + value * frame.normal[index],
        0,
      );
      next = { ...sketch, frame: coordinateSketchFrame(intent.plane, offset) };
      break;
    }
    case "planeOffset": {
      fields(intent, ["kind", "offsetMm"], ["kind", "offsetMm"]);
      const offset = number(intent.offsetMm),
        frame = sketch.frame ?? coordinateSketchFrame("OXY", 0);
      const previous = frame.origin.reduce(
        (sum, value, index) => sum + value * frame.normal[index],
        0,
      );
      next = {
        ...sketch,
        frame: {
          ...frame,
          origin: frame.origin.map(
            (value, index) => value + (offset - previous) * frame.normal[index],
          ) as typeof frame.origin,
        },
      };
      break;
    }
    case "pointAdd": {
      fields(intent, ["kind", "position"], ["kind"]);
      const position = intent.position ?? [0, 0];
      if (!Array.isArray(position) || position.length !== 2)
        throw Error("Point position requires two UV coordinates.");
      admit(sketch, { points: 1 });
      next = {
        ...sketch,
        points: [
          ...sketch.points,
          { id: newId(), x: number(position[0]), y: number(position[1]) },
        ],
      };
      break;
    }
    case "pointSet": {
      fields(intent, ["kind", "pointId", "x", "y"], ["kind", "pointId"]);
      if (!Object.hasOwn(intent, "x") && !Object.hasOwn(intent, "y"))
        throw Error("Supply a point coordinate to edit.");
      const point = sketch.points.find(
        (point) => point.id === identity(intent.pointId),
      );
      if (!point) throw Error("Sketch point is missing.");
      const patch = {
        ...(Object.hasOwn(intent, "x") ? { x: number(intent.x) } : {}),
        ...(Object.hasOwn(intent, "y") ? { y: number(intent.y) } : {}),
      };
      next = {
        ...sketch,
        points: sketch.points.map((item) =>
          item === point ? { ...item, ...patch } : item,
        ),
      };
      break;
    }
    case "segmentAdd": {
      fields(intent, ["kind", "a", "b"], ["kind"]);
      if (Object.hasOwn(intent, "a") !== Object.hasOwn(intent, "b"))
        throw Error("Segment endpoints must both be supplied.");
      const a = identity(intent.a ?? sketch.points[0]?.id),
        b = identity(intent.b ?? sketch.points[1]?.id);
      admit(sketch, { curves: 1 });
      next = {
        ...sketch,
        segments: [...sketch.segments, { id: newId(), a, b }],
      };
      break;
    }
    case "segmentSet": {
      fields(intent, ["kind", "segmentId", "a", "b"], ["kind", "segmentId"]);
      if (!Object.hasOwn(intent, "a") && !Object.hasOwn(intent, "b"))
        throw Error("Supply a segment endpoint to edit.");
      const segment = sketch.segments.find(
        (item) => item.id === identity(intent.segmentId),
      );
      if (!segment) throw Error("Sketch segment is missing.");
      const patch = {
        ...(Object.hasOwn(intent, "a") ? { a: identity(intent.a) } : {}),
        ...(Object.hasOwn(intent, "b") ? { b: identity(intent.b) } : {}),
      };
      next = {
        ...sketch,
        segments: sketch.segments.map((item) =>
          item === segment ? { ...item, ...patch } : item,
        ),
      };
      break;
    }
    case "arcAdd": {
      fields(intent, ["kind", "a", "b", "center", "clockwise"], ["kind"]);
      const count = ["a", "b", "center"].filter((key) =>
        Object.hasOwn(intent, key),
      ).length;
      if (count !== 0 && count !== 3)
        throw Error("Arc endpoint and center references must all be supplied.");
      const a = identity(intent.a ?? sketch.points[0]?.id),
        b = identity(intent.b ?? sketch.points[1]?.id),
        center = identity(intent.center ?? sketch.points[2]?.id);
      admit(sketch, { curves: 1 });
      next = {
        ...sketch,
        arcs: [
          ...(sketch.arcs ?? []),
          {
            id: newId(),
            a,
            b,
            center,
            clockwise:
              intent.clockwise === undefined
                ? false
                : boolean(intent.clockwise),
          },
        ],
      };
      break;
    }
    case "arcSet": {
      fields(
        intent,
        ["kind", "arcId", "a", "b", "center", "clockwise"],
        ["kind", "arcId"],
      );
      if (
        !["a", "b", "center", "clockwise"].some((key) =>
          Object.hasOwn(intent, key),
        )
      )
        throw Error("Supply an arc field to edit.");
      const arc = sketch.arcs?.find(
        (item) => item.id === identity(intent.arcId),
      );
      if (!arc) throw Error("Sketch arc is missing.");
      const patch = {
        ...(Object.hasOwn(intent, "a") ? { a: identity(intent.a) } : {}),
        ...(Object.hasOwn(intent, "b") ? { b: identity(intent.b) } : {}),
        ...(Object.hasOwn(intent, "center")
          ? { center: identity(intent.center) }
          : {}),
        ...(Object.hasOwn(intent, "clockwise")
          ? { clockwise: boolean(intent.clockwise) }
          : {}),
      };
      next = {
        ...sketch,
        arcs: sketch.arcs!.map((item) =>
          item === arc ? { ...item, ...patch } : item,
        ),
      };
      break;
    }
    case "construction": {
      fields(
        intent,
        ["kind", "curveId", "enabled"],
        ["kind", "curveId", "enabled"],
      );
      const id = identity(intent.curveId),
        enabled = boolean(intent.enabled);
      const curve = [...sketch.segments, ...(sketch.arcs ?? [])].find(
        (item) => item.id === id,
      );
      if (!curve) throw Error("Sketch curve is missing.");
      if (!!curve.construction !== enabled)
        next = {
          ...sketch,
          segments: sketch.segments.map((item) =>
            item.id === id ? { ...item, construction: enabled } : item,
          ),
          ...(sketch.arcs
            ? {
                arcs: sketch.arcs.map((item) =>
                  item.id === id ? { ...item, construction: enabled } : item,
                ),
              }
            : {}),
        };
      break;
    }
    case "remove": {
      fields(intent, ["kind", "target", "id"], ["kind", "target", "id"]);
      const id = identity(intent.id);
      if (intent.target === "constraint") {
        if (!sketch.constraints.some((item) => item.id === id))
          throw Error("Sketch constraint is missing.");
        next = {
          ...sketch,
          constraints: sketch.constraints.filter((item) => item.id !== id),
        };
      } else {
        const rows =
          intent.target === "point"
            ? sketch.points
            : intent.target === "segment"
              ? sketch.segments
              : intent.target === "arc"
                ? (sketch.arcs ?? [])
                : undefined;
        if (!rows) throw Error("Unknown sketch removal target.");
        if (!rows.some((item) => item.id === id))
          throw Error("Sketch removal target is missing.");
        next = removeSketchGeometry(sketch, intent.target, id);
      }
      break;
    }
    case "dimension": {
      fields(
        intent,
        ["kind", "constraintId", "value"],
        ["kind", "constraintId", "value"],
      );
      const relation = sketch.constraints.find(
        (item) => item.id === identity(intent.constraintId),
      );
      if (!relation || !("value" in relation))
        throw Error("Sketch dimensional constraint is missing.");
      next = {
        ...sketch,
        constraints: sketch.constraints.map((item) =>
          item === relation
            ? { ...relation, value: number(intent.value) }
            : item,
        ),
      };
      break;
    }
    case "constraintAdd": {
      fields(intent, ["kind", "constraint"], ["kind", "constraint"]);
      admit(sketch, { constraints: 1 });
      const relation = constraint(intent.constraint, sketch, newId());
      const candidate = {
        ...sketch,
        constraints: [...sketch.constraints, relation],
      };
      validate(candidate, check);
      check();
      solution = solveSketch(candidate);
      if (!solution.converged)
        throw Error(
          `Conflicting or unsolved constraints: ${solution.conflictingConstraintIds.join(", ")}`,
        );
      next = solution.sketch;
      break;
    }
    case "solve":
      fields(
        intent,
        ["kind", "tolerance", "maxIterations", "forProfile"],
        ["kind"],
      );
      if (intent.forProfile !== undefined) boolean(intent.forProfile);
      check();
      solution = solveSketch(sketch, intent.tolerance, intent.maxIterations);
      next = solution.sketch;
      if (intent.forProfile) {
        if (!solution.converged)
          throw Error(
            "Resolve conflicting constraints before preparing a profile.",
          );
        sketchCurveProfile(next);
        profile = { kind: "sketch-curves", sketch: next };
      }
      break;
    default:
      throw Error("Unsupported semantic sketch edit.");
  }
  check();
  validate(next, check);
  check();
  const changed = !sameSketch(sketch, next);
  const beforeCurves = [...sketch.segments, ...(sketch.arcs ?? [])],
    afterCurves = [...next.segments, ...(next.arcs ?? [])];
  return {
    sketch: changed ? next : sketch,
    changed,
    createdPointIds: difference(next.points, sketch.points),
    createdCurveIds: difference(afterCurves, beforeCurves),
    createdConstraintIds: difference(next.constraints, sketch.constraints),
    removedPointIds: difference(sketch.points, next.points),
    removedCurveIds: difference(beforeCurves, afterCurves),
    removedConstraintIds: difference(sketch.constraints, next.constraints),
    ...(solution ? { solution } : {}),
    ...(profile ? { profile } : {}),
  };
}

import { validateSketch, type Sketch, type SketchConstraint } from "./sketch";
import {
  drawSketchLine,
  drawSketchCircle,
  drawThreePointCurve,
  moveSketchEndpoint,
  type SketchUV,
} from "./sketch-drawing";
import { coordinateSketchFrame, sketchWorldPoint } from "./sketch-frame";
import { snapSketchGrid } from "./viewport-display";

/** Per drawing operation, including prospective geometry and temporary solver relations. */
export const SKETCH_DRAW_LIMITS = Object.freeze({
  points: 256,
  curves: 512,
  constraints: 512,
  referenceCoordinates: 2000000,
  validationWork: 2000000,
  solverCells: 262144,
  solverWork: 2000000,
});
export class SketchDrawResourceLimit extends Error {
  readonly code = "RESOURCE_LIMIT";
  constructor(reason: string) {
    super(
      `Sketch drawing ${reason}. No changes were applied. Use a smaller sketch or split the operation.`,
    );
    this.name = "SketchDrawResourceLimit";
  }
}
export type SketchDrawIntent =
  | {
      kind: "line";
      points: [SketchUV, SketchUV];
      autoConstraints: boolean;
      snapToleranceMm: number;
    }
  | { kind: "circle"; points: [SketchUV, SketchUV] }
  | { kind: "arc3" | "circle3"; points: [SketchUV, SketchUV, SketchUV] }
  | { kind: "move"; pointId: string; position: SketchUV };
export interface SketchDrawGrid {
  enabled: boolean;
  spacingMm: number;
}
export interface SketchDrawOptions {
  check?: () => void;
  signal?: AbortSignal;
}
export interface SketchDrawResult {
  sketch: Sketch;
  changed: boolean;
  createdPointIds: string[];
  createdCurveIds: string[];
  createdConstraintIds: string[];
  /** Grid-snapped input coordinates, before line endpoint reuse/automatic relations. */
  usedPoints: SketchUV[];
  diagnostics: {
    inputPointCount: number;
    outputPointCount: number;
    outputCurveCount: number;
    outputConstraintCount: number;
    solverVariables: number;
    solverResiduals: number;
    estimatedWork: number;
  };
}
function uv(value: unknown): SketchUV {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    Array.from(value).some(
      (n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e9,
    )
  )
    throw Error(
      "Drawing coordinates must be finite UV millimetres within +/-1e9.",
    );
  return [value[0], value[1]];
}
function intentPoints(intent: SketchDrawIntent): SketchUV[] {
  if (
    !intent ||
    typeof intent !== "object" ||
    !["line", "circle", "arc3", "circle3", "move"].includes(intent.kind)
  )
    throw Error("Unsupported sketch drawing intent.");
  const fields =
    intent.kind === "move"
      ? ["kind", "pointId", "position"]
      : intent.kind === "line"
        ? ["kind", "points", "autoConstraints", "snapToleranceMm"]
        : ["kind", "points"];
  if (
    Reflect.ownKeys(intent).some(
      (key) => typeof key !== "string" || !fields.includes(key),
    )
  )
    throw Error("Ambiguous sketch drawing intent fields.");
  if (intent.kind === "move") {
    if (typeof intent.pointId !== "string" || !intent.pointId)
      throw Error("Endpoint identity is required for movement.");
    return [uv(intent.position)];
  }
  if (
    !Array.isArray(intent.points) ||
    intent.points.length !==
      (intent.kind === "arc3" || intent.kind === "circle3" ? 3 : 2)
  )
    throw Error("Drawing intent requires the exact ordered UV picks.");
  if (
    intent.kind === "line" &&
    (typeof intent.autoConstraints !== "boolean" ||
      typeof intent.snapToleranceMm !== "number" ||
      !Number.isFinite(intent.snapToleranceMm) ||
      intent.snapToleranceMm < 0 ||
      intent.snapToleranceMm > 1e9)
  )
    throw Error(
      "Line drawing requires an explicit automatic-constraint flag and finite nonnegative snapping tolerance within 1e9 mm.",
    );
  return Array.from(intent.points, uv);
}
function collections(sketch: Sketch, points = 0, curves = 0, constraints = 0) {
  if (
    sketch.points.length + points > SKETCH_DRAW_LIMITS.points ||
    sketch.segments.length + (sketch.arcs?.length ?? 0) + curves >
      SKETCH_DRAW_LIMITS.curves ||
    sketch.constraints.length + constraints > SKETCH_DRAW_LIMITS.constraints
  )
    throw new SketchDrawResourceLimit("collection limit exceeded");
}
function residualCount(sketch: Sketch) {
  const arcs = new Set((sketch.arcs ?? []).map((arc) => arc.id));
  return sketch.constraints.reduce(
    (sum, c: SketchConstraint) =>
      sum +
      (c.kind === "fixed" || c.kind === "coincident" || c.kind === "collinear"
        ? 2
        : c.kind === "symmetric"
          ? arcs.has(c.first)
            ? 6
            : 4
          : 1),
    sketch.arcs?.length ?? 0,
  );
}
function solverAdmission(variables: number, residuals: number) {
  // The empty-residual path still copies the variable vector for each Jacobian column.
  const cells =
    variables + residuals * variables + (residuals ? variables * variables : 0);
  const work =
    variables * variables +
    residuals * variables +
    (residuals
      ? variables ** 3 + residuals * variables ** 2 + variables * residuals ** 2
      : 0);
  if (
    cells > SKETCH_DRAW_LIMITS.solverCells ||
    work > SKETCH_DRAW_LIMITS.solverWork
  )
    throw new SketchDrawResourceLimit("solver work budget exceeded");
  return work;
}
function placedCoordinates(sketch: Sketch) {
  const frame = sketch.frame ?? coordinateSketchFrame("OXY", 0);
  for (const point of sketch.points) {
    uv([point.x, point.y]);
    sketchWorldPoint(frame, [point.x, point.y]);
  }
}

/** Compute one detached candidate; the shared application operation owns publication/history. */
export function applySketchDrawIntent(
  sketch: Sketch,
  intent: SketchDrawIntent,
  grid: SketchDrawGrid,
  options: SketchDrawOptions = {},
): SketchDrawResult {
  const check = () => {
    options.signal?.throwIfAborted();
    options.check?.();
    options.signal?.throwIfAborted();
  };
  check();
  if (
    !sketch ||
    !Array.isArray(sketch.points) ||
    !Array.isArray(sketch.segments) ||
    !Array.isArray(sketch.constraints) ||
    (sketch.arcs !== undefined && !Array.isArray(sketch.arcs))
  )
    throw Error("Unsupported sketch drawing structure.");
  collections(sketch);
  const referenceCoordinates = Array.isArray(sketch.reference?.segments)
    ? sketch.reference.segments.length
    : 0;
  const validationWork =
    sketch.points.length +
    sketch.segments.length +
    (sketch.arcs?.length ?? 0) +
    referenceCoordinates +
    sketch.constraints.length *
      (8 +
        sketch.points.length +
        sketch.segments.length +
        (sketch.arcs?.length ?? 0));
  if (
    referenceCoordinates > SKETCH_DRAW_LIMITS.referenceCoordinates ||
    validationWork > SKETCH_DRAW_LIMITS.validationWork
  )
    throw new SketchDrawResourceLimit("validation work budget exceeded");
  const rawPoints = intentPoints(intent);
  if (
    !grid ||
    typeof grid.enabled !== "boolean" ||
    typeof grid.spacingMm !== "number" ||
    !Number.isFinite(grid.spacingMm) ||
    grid.spacingMm <= 0 ||
    grid.spacingMm > 1e9
  )
    throw Error(
      "Sketch drawing grid spacing must be positive and within 1e9 mm.",
    );
  validateSketch(sketch);
  placedCoordinates(sketch);
  check();
  const usedPoints = rawPoints.map((point) =>
    uv(snapSketchGrid(point, grid.enabled, grid.spacingMm)),
  );
  const additionalPoints =
    intent.kind === "move" ? 0 : intent.kind === "line" ? 2 : 3;
  const additionalCurves =
    intent.kind === "move"
      ? 0
      : intent.kind === "circle" || intent.kind === "circle3"
        ? 2
        : 1;
  const additionalConstraints =
    intent.kind === "move"
      ? 1
      : intent.kind === "line" && intent.autoConstraints
        ? 3
        : 0;
  collections(
    sketch,
    additionalPoints,
    additionalCurves,
    additionalConstraints,
  );
  const additionalResiduals =
    intent.kind === "move"
      ? 2
      : intent.kind === "line"
        ? intent.autoConstraints
          ? 5
          : 0
        : additionalCurves;
  const estimatedWork = solverAdmission(
    (sketch.points.length + additionalPoints) * 2,
    residualCount(sketch) + additionalResiduals,
  );
  const source = structuredClone(sketch);
  check();
  const candidate =
    intent.kind === "move"
      ? moveSketchEndpoint(source, intent.pointId, usedPoints[0])
      : intent.kind === "line"
        ? drawSketchLine(
            source,
            usedPoints[0],
            usedPoints[1],
            intent.snapToleranceMm,
            intent.autoConstraints,
          )
        : intent.kind === "circle"
          ? drawSketchCircle(source, usedPoints[0], usedPoints[1])
          : drawThreePointCurve(
              source,
              usedPoints as [SketchUV, SketchUV, SketchUV],
              intent.kind,
            );
  check();
  collections(candidate);
  validateSketch(candidate);
  placedCoordinates(candidate);
  const priorPoints = new Set(sketch.points.map((p) => p.id)),
    priorCurves = new Set(
      [...sketch.segments, ...(sketch.arcs ?? [])].map((curve) => curve.id),
    ),
    priorConstraints = new Set(sketch.constraints.map((c) => c.id));
  const createdPointIds = candidate.points
      .filter((p) => !priorPoints.has(p.id))
      .map((p) => p.id),
    createdCurveIds = [...candidate.segments, ...(candidate.arcs ?? [])]
      .filter((curve) => !priorCurves.has(curve.id))
      .map((curve) => curve.id),
    createdConstraintIds = candidate.constraints
      .filter((c) => !priorConstraints.has(c.id))
      .map((c) => c.id);
  const changed =
    createdPointIds.length > 0 ||
    createdCurveIds.length > 0 ||
    createdConstraintIds.length > 0 ||
    candidate.points.some(
      (p, i) =>
        !Object.is(p.x, sketch.points[i]?.x) ||
        !Object.is(p.y, sketch.points[i]?.y),
    );
  const result: SketchDrawResult = {
    sketch: candidate,
    changed,
    createdPointIds,
    createdCurveIds,
    createdConstraintIds,
    usedPoints,
    diagnostics: {
      inputPointCount: sketch.points.length,
      outputPointCount: candidate.points.length,
      outputCurveCount:
        candidate.segments.length + (candidate.arcs?.length ?? 0),
      outputConstraintCount: candidate.constraints.length,
      solverVariables: candidate.points.length * 2,
      solverResiduals:
        residualCount(candidate) + (intent.kind === "move" ? 2 : 0),
      estimatedWork,
    },
  };
  check();
  return result;
}

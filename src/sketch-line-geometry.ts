import {
  requireNativeSketchLinePreparedEndpoints,
  type NativeSketchLinePreparedEndpoints,
} from "./sketch-line-prepared";
import {
  checkNativeSketchDistinctEdgeVertexSeparation,
  checkNativeSketchWireVertexSeparation,
  type NativeSketchWireVertexSeparation,
} from "./sketch-wire-vertex-separation";
import {
  checkNativeSketchLineParameterOrder,
  projectNativeSketchLinePoint,
  type NativeSketchLineParameterOrder,
  type NativeSketchLinePointProjection,
} from "./sketch-line-projection";
import {
  checkNativeSketchLineBoundsEnvelope,
  prepareNativeSketchLineVertexBounds,
  type NativeSketchLineBoundsEnvelope,
  type NativeSketchLineVertexBounds,
} from "./sketch-line-bounds";

export type NativeSketchLineGeometrySettings = {
  linearResolution: number;
  coordinateDeltaZeroThreshold: number;
  endpointTolerance: number;
  coordinateEnvelope: number;
  relativeComparisonTolerance: number;
};
export type NativeSketchFreshLineGeometryChecks = {
  passed: boolean;
  /** Selected normal-return path with prior checks passed and incoming status 0. */
  nativeFailurePath?: {
    edgeStatus?: 2 | 3 | 4;
    generalStatus: 1 | 3 | 12 | 13;
    wireStatus: 4 | 7;
  };
  failureStage?:
    | "edge-vertices"
    | "start-projection"
    | "end-projection"
    | "parameter-order"
    | "wire-vertices"
    | "envelope";
  prepared: NativeSketchLinePreparedEndpoints;
  settings: NativeSketchLineGeometrySettings;
  vertexTolerance: number;
  results: {
    edgeVertices?: NativeSketchWireVertexSeparation;
    startProjection?: NativeSketchLinePointProjection;
    endProjection?: NativeSketchLinePointProjection;
    parameterOrder?: NativeSketchLineParameterOrder;
    wireVertices?: NativeSketchWireVertexSeparation;
    bounds?: NativeSketchLineVertexBounds;
    envelope?: NativeSketchLineBoundsEnvelope;
  };
};

export function requireNativeSketchLineGeometrySettings(
  value: unknown,
): NativeSketchLineGeometrySettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Fresh line geometry settings must be an explicit record.");
  const record = value as Record<string, unknown>;
  const fields = [
    "linearResolution",
    "coordinateDeltaZeroThreshold",
    "endpointTolerance",
    "coordinateEnvelope",
    "relativeComparisonTolerance",
  ] as const;
  if (
    Object.keys(record).some(
      (key) => !(fields as readonly string[]).includes(key),
    )
  )
    throw new Error("Unsupported fresh line geometry setting.");
  const result = {} as NativeSketchLineGeometrySettings;
  for (const key of fields) {
    const n = record[key];
    if (
      typeof n !== "number" ||
      !Number.isFinite(n) ||
      ((key === "linearResolution" || key === "coordinateEnvelope") &&
        n <= 0) ||
      ((key === "coordinateDeltaZeroThreshold" ||
        key === "relativeComparisonTolerance") &&
        n < 0)
    )
      throw new Error(`Invalid fresh line geometry setting: ${key}.`);
    result[key] = n;
  }
  return result;
}

/**
 * Compose the recovered scalar checks for a fresh, forward, single analytic
 * line with two distinct vertex objects and default per-vertex tolerances.
 * Settings are explicit; endpoint tolerance is not inferred from resolution.
 * Distinct-edge pair collection has no pairs in this scope. Metadata/recovery,
 * reentrancy, other topology and complete original-native admission remain
 * surrounding concerns. No kernel handles are allocated here.
 */
export function checkNativeSketchFreshLineGeometry(
  input: unknown,
  values: unknown,
): NativeSketchFreshLineGeometryChecks {
  const settings = requireNativeSketchLineGeometrySettings(values);
  const prepared = requireNativeSketchLinePreparedEndpoints(input);
  const { conversion, start, end } = prepared;
  const result: NativeSketchFreshLineGeometryChecks = {
    passed: false,
    prepared,
    settings,
    vertexTolerance: settings.linearResolution * 0.5,
    results: {},
  };
  const reject = (
    stage: NonNullable<NativeSketchFreshLineGeometryChecks["failureStage"]>,
  ) => {
    result.failureStage = stage;
    // These are conditional failure paths, never a whole-run native status.
    const paths = {
      "edge-vertices": { edgeStatus: 2, generalStatus: 3, wireStatus: 4 },
      "start-projection": { edgeStatus: 3, generalStatus: 12, wireStatus: 4 },
      "end-projection": { edgeStatus: 3, generalStatus: 12, wireStatus: 4 },
      "parameter-order": { edgeStatus: 4, generalStatus: 12, wireStatus: 4 },
      "wire-vertices": { generalStatus: 13, wireStatus: 7 },
      envelope: { generalStatus: 1, wireStatus: 4 },
    } as const;
    result.nativeFailurePath = { ...paths[stage] };
    return result;
  };
  const edgeVertices = checkNativeSketchDistinctEdgeVertexSeparation(
    { point: end },
    { point: start },
    settings.linearResolution,
    settings.coordinateDeltaZeroThreshold,
  );
  result.results.edgeVertices = edgeVertices;
  if (edgeVertices.overlap) return reject("edge-vertices");
  const startProjection = projectNativeSketchLinePoint(
    start,
    conversion.origin,
    conversion.direction,
    settings.endpointTolerance,
    settings.coordinateDeltaZeroThreshold,
  );
  if (!startProjection) return reject("start-projection");
  result.results.startProjection = startProjection;
  const endProjection = projectNativeSketchLinePoint(
    end,
    conversion.origin,
    conversion.direction,
    settings.endpointTolerance,
    settings.coordinateDeltaZeroThreshold,
  );
  if (!endProjection) return reject("end-projection");
  result.results.endProjection = endProjection;
  const parameterOrder = checkNativeSketchLineParameterOrder(
    startProjection.parameter,
    endProjection.parameter,
    true,
  );
  result.results.parameterOrder = parameterOrder;
  if (!parameterOrder.ordered) return reject("parameter-order");
  const wireVertices = checkNativeSketchWireVertexSeparation(
    { point: end },
    { point: start },
    settings.linearResolution,
  );
  result.results.wireVertices = wireVertices;
  if (wireVertices.overlap) return reject("wire-vertices");
  // Native coedge order initializes the box from end, then merges start.
  const bounds = prepareNativeSketchLineVertexBounds(end, start);
  result.results.bounds = bounds;
  const envelope = checkNativeSketchLineBoundsEnvelope(
    bounds,
    settings.coordinateEnvelope,
    settings.relativeComparisonTolerance,
  );
  result.results.envelope = envelope;
  if (!envelope.inside) return reject("envelope");
  result.passed = true;
  return result;
}

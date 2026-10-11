import {
  type ExplicitCurvatureAreaState,
  selectExplicitCurvatureAreaSource,
} from "./field-curvature-area-source";
import {
  type CurvatureRadiusBounds,
  deriveExplicitCurvatureRadiusBounds,
  derivePercentageCurvatureRadiusBounds,
} from "./field-curvature-bounds";

export interface CurvatureOwnerBoundState {
  geometryPresent: boolean;
  minimumControl: number;
  maximumControl: number;
  targetCount: number;
  baseLength: number;
  overrideScale: boolean;
  partCount: number;
  areas: ExplicitCurvatureAreaState;
  previous: CurvatureRadiusBounds;
}

/** Recovered owner branch dispatch over caller-supplied geometry/cache state. */
export function prepareCurvatureOwnerBounds(
  state: CurvatureOwnerBoundState,
): CurvatureRadiusBounds {
  const f = Math.fround;
  const previous = {
    minimum: f(state.previous.minimum),
    maximum: f(state.previous.maximum),
    ratio: f(state.previous.ratio),
    referenceMinimum: f(state.previous.referenceMinimum),
    count: state.previous.count,
  };
  if (
    ![
      previous.minimum,
      previous.maximum,
      previous.ratio,
      previous.referenceMinimum,
    ].every(Number.isFinite) ||
    !Number.isInteger(previous.count) ||
    previous.count < 0 ||
    previous.count > 2147483647
  )
    throw new Error("Curvature previous bounds are invalid.");
  if (!state.geometryPresent) return previous;
  const minimumControl = f(state.minimumControl);
  const maximumControl = f(state.maximumControl);
  if (
    ![minimumControl, maximumControl].every(Number.isFinite) ||
    !Number.isInteger(state.targetCount) ||
    state.targetCount < -2147483648 ||
    state.targetCount > 2147483647 ||
    !Number.isInteger(state.partCount) ||
    state.partCount < 0 ||
    state.partCount > 2147483647
  )
    throw new Error("Curvature owner bound inputs are invalid.");
  const capped = state.areas.model !== undefined && state.partCount > 1;
  if (minimumControl > 0 && maximumControl > 0) {
    if (state.areas.contextArea === undefined)
      throw new Error("Curvature percentage bounds require a context area.");
    return derivePercentageCurvatureRadiusBounds({
      surfaceArea: state.areas.contextArea,
      baseLength: state.baseLength,
      minimumControl,
      maximumControl,
      overrideScale: state.overrideScale,
      combinedSurfaceArea: capped ? state.areas.contextArea : undefined,
    });
  }
  if (state.targetCount <= 0 || previous.ratio <= 0) return previous;
  if (capped && state.areas.contextArea === undefined)
    throw new Error("Curvature multi-part bounds require a context area.");
  const selected = selectExplicitCurvatureAreaSource(state.areas);
  return deriveExplicitCurvatureRadiusBounds({
    surfaceArea: selected.surfaceArea,
    targetCount: state.targetCount,
    ratio: previous.ratio,
    stageCount: previous.count,
    combinedSurfaceArea: capped ? state.areas.contextArea : undefined,
  });
}

export interface ExplicitCurvatureAreaState {
  baseArea: number;
  model?: {
    storageMode: number;
    indexElementCount: number;
    embeddedArea: number;
    alternateArea?: number;
  };
  contextArea?: number;
}

export interface ExplicitCurvatureAreaSource {
  source: "base" | "embedded" | "alternate" | "context" | "none";
  surfaceArea: number;
}

/** Recovered explicit-owner source routing; areas are supplied cached values. */
export function selectExplicitCurvatureAreaSource(
  state: ExplicitCurvatureAreaState,
): ExplicitCurvatureAreaSource {
  const validArea = (area: number) =>
    Number.isFinite(Math.fround(area)) && Math.fround(area) >= 0;
  if (
    !validArea(state.baseArea) ||
    (state.contextArea !== undefined && !validArea(state.contextArea)) ||
    (state.model &&
      (!Number.isInteger(state.model.storageMode) ||
        state.model.storageMode < -2147483648 ||
        state.model.storageMode > 2147483647 ||
        !Number.isInteger(state.model.indexElementCount) ||
        state.model.indexElementCount < 0 ||
        state.model.indexElementCount > 2147483647 ||
        !validArea(state.model.embeddedArea) ||
        (state.model.alternateArea !== undefined &&
          !validArea(state.model.alternateArea))))
  )
    throw new Error("Curvature area source inputs are invalid.");
  if (!state.model)
    return { source: "base", surfaceArea: Math.fround(state.baseArea) };
  const { storageMode, indexElementCount, embeddedArea, alternateArea } =
    state.model;
  // Native zero mode tests (element count - 1), including -1 for an empty array.
  const count =
    storageMode === 0
      ? indexElementCount - 1
      : Math.trunc(indexElementCount / (storageMode === 1 ? 4 : 3));
  if (count !== 0)
    return { source: "embedded", surfaceArea: Math.fround(embeddedArea) };
  if (alternateArea !== undefined)
    return { source: "alternate", surfaceArea: Math.fround(alternateArea) };
  if (state.contextArea !== undefined)
    return { source: "context", surfaceArea: Math.fround(state.contextArea) };
  return { source: "none", surfaceArea: 0 };
}

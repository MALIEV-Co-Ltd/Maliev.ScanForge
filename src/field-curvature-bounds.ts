export interface CurvatureRadiusBounds {
  minimum: number;
  maximum: number;
  ratio: number;
  referenceMinimum: number;
  count: number;
}

export interface PercentageRadiusParameters {
  surfaceArea: number;
  baseLength: number;
  minimumControl: number;
  maximumControl: number;
  overrideScale: boolean;
  /** Caller supplies the combined area only when the native multi-part gate applies. */
  combinedSurfaceArea?: number;
}

/** The recovered fixed control table, including its backward-segment float order. */
export function interpolateCurvatureRadiusFactor(
  control: number,
  upper: boolean,
): number {
  const f = Math.fround;
  const value = f(control);
  if (!Number.isFinite(value))
    throw new Error("Curvature radius control is invalid.");
  const x = [1, 50, 100];
  const y = (upper ? [0.8, 1.75, 6] : [0.12, 0.33, 2]).map(f);
  if (value <= x[0]) return y[0];
  for (let i = 1; i < x.length; i++) {
    if (value <= x[i])
      return f(
        f(f(f(y[i - 1] - y[i]) * f(value - x[i])) / f(x[i - 1] - x[i])) + y[i],
      );
  }
  return y[y.length - 1];
}

/** Percentage branch with caller-resolved area/override state; no invented defaults. */
export function derivePercentageCurvatureRadiusBounds(
  parameters: PercentageRadiusParameters,
): CurvatureRadiusBounds {
  const f = Math.fround;
  const area = f(parameters.surfaceArea);
  const base = f(parameters.baseLength);
  const minimumControl = f(parameters.minimumControl);
  const maximumControl = f(parameters.maximumControl);
  if (
    ![area, base].every((v) => Number.isFinite(v) && v >= 0) ||
    ![minimumControl, maximumControl].every((v) => Number.isFinite(v) && v > 0)
  )
    throw new Error("Curvature percentage bound inputs are invalid.");
  const scale = parameters.overrideScale
    ? base
    : Math.max(f(Math.sqrt(f(area / 10000))), base);
  return finalizeCurvatureRadiusBounds(
    f(interpolateCurvatureRadiusFactor(minimumControl, false) * scale),
    f(interpolateCurvatureRadiusFactor(maximumControl, true) * scale),
    parameters.combinedSurfaceArea,
  );
}

/** Recovered post-interpolation owner bounds; optional surface area is caller supplied. */
export function finalizeCurvatureRadiusBounds(
  minimum: number,
  maximum: number,
  limitMeasure?: number,
): CurvatureRadiusBounds {
  const f = Math.fround;
  let low = f(minimum);
  let high = f(maximum);
  const measure = limitMeasure === undefined ? undefined : f(limitMeasure);
  if (
    ![low, high].every((v) => Number.isFinite(v) && v > 0) ||
    (measure !== undefined && (!Number.isFinite(measure) || measure <= 0))
  )
    throw new Error("Curvature radius bound inputs are invalid.");
  // This comparison uses double 0.8, with float conversion only when stored.
  const lowerLimit = high * 0.8;
  if (low > lowerLimit) low = f(lowerLimit);
  const ratio = f(high / low);
  if (measure !== undefined) {
    const limit = f(f(Math.sqrt(f(measure / 24))) * 0.5);
    if (limit < high) high = limit;
    if (limit < low) low = limit;
    if (ratio !== 1 && high === limit && low === limit) low = f(high / ratio);
  }
  if (![low, high, ratio].every((v) => Number.isFinite(v) && v > 0))
    throw new Error("Curvature radius bounds overflowed or underflowed.");
  const count =
    ratio === 1
      ? 1
      : ratio < f(1.7)
        ? 2
        : ratio < 3
          ? 3
          : ratio < 4
            ? 4
            : ratio < 7
              ? 5
              : 6;
  return { minimum: low, maximum: high, ratio, referenceMinimum: low, count };
}

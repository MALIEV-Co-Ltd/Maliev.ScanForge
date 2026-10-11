export interface CurvatureRadiusSchedule {
  radii: Float32Array;
  thresholds: Float32Array;
}

/** Recovered owner radius preparation; mode 0 is log, 1 linear, otherwise blended. */
export function prepareCurvatureRadii(
  count: number,
  minimum: number,
  maximum: number,
  mode: number,
  thresholdScale: number,
): CurvatureRadiusSchedule {
  const f = Math.fround;
  const low = f(minimum);
  const high = f(maximum);
  const scale = f(thresholdScale);
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 0x7fffffff ||
    !Number.isSafeInteger(mode) ||
    mode < -0x80000000 ||
    mode > 0x7fffffff ||
    ![low, high, scale].every((v) => Number.isFinite(v) && v > 0)
  )
    throw new Error("Curvature radius schedule inputs are invalid.");
  const radii = new Float32Array(count);
  const thresholds = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    let radius = high;
    if (count !== 1) {
      const fraction = f(f(index) / f(count - 1));
      const linear = () => f(f(f(high - low) * fraction) + low);
      const logarithmic = () => {
        const exponent = f(f(Math.log10(f(high / low))) * f(1 - fraction));
        return f(high / f(Math.pow(10, exponent)));
      };
      radius =
        mode === 0
          ? logarithmic()
          : mode === 1
            ? linear()
            : f(f(logarithmic() + linear()) * 0.5);
    }
    const threshold = f(1 / f(radius * scale));
    if (
      !Number.isFinite(radius) ||
      radius <= 0 ||
      !Number.isFinite(threshold) ||
      threshold <= 0
    )
      throw new Error("Curvature radius schedule overflowed or underflowed.");
    radii[index] = radius;
    thresholds[index] = threshold;
  }
  return { radii, thresholds };
}

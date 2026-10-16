const f = Math.fround;
const maximum = f(3.4028234663852886e38);

/** The native mesh build worker's extent policy, not a global setting shared by
 * every index caller. Prepared bounds use min XYZ then max XYZ. Invalid/sentinel
 * bounds keep the original 0.5 default; subtraction rounds before Double division.
 */
export function nativeGlobalEvaluatorExtent(bounds: ArrayLike<number>): number {
  const x0 = f(bounds[0]),
    y0 = f(bounds[1]),
    z0 = f(bounds[2]),
    x1 = f(bounds[3]),
    y1 = f(bounds[4]),
    z1 = f(bounds[5]);
  if (!(
    x0 <= x1 &&
    y0 <= y1 &&
    z0 <= z1 &&
    -maximum < x0 &&
    -maximum < y0 &&
    -maximum < z0 &&
    x1 < maximum &&
    y1 < maximum &&
    z1 < maximum
  ))
    return 0.5;
  return f(Math.max(0.5, Math.max(f(x1 - x0), f(y1 - y0), f(z1 - z0)) / 1000));
}

import type { Vec3 } from "./types";

const kernel = (r2: number) => (r2 > 1e-20 ? (r2 * Math.log(r2)) / 2 : 0);
const distance = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Bounded thin-plate continuation in the caller's normalized graph frame.
 * Farthest-point sampling caps the dense solve; held-out collar samples must
 * agree before the surface is used. No retained scan coordinates are changed.
 */
export function interpolateHoleSurface(
  points: Vec3[],
  rim: Vec3[],
  cancel: () => void,
): ((x: number, y: number) => number) | undefined {
  const selected: Vec3[] = [];
  const sample = (source: Vec3[], count: number) => {
    const nearest = source.map((p) =>
      selected.length
        ? Math.min(...selected.map((q) => distance(p, q)))
        : Infinity,
    );
    for (let i = 0; i < count; i++) {
      cancel();
      let best = 0;
      for (let j = 1; j < nearest.length; j++)
        if (nearest[j] > nearest[best]) best = j;
      if (!source.length || nearest[best] < 1e-12) break;
      const p = source[best];
      selected.push(p);
      for (let j = 0; j < source.length; j++)
        nearest[j] = Math.min(nearest[j], distance(source[j], p));
    }
  };
  sample(rim, 64);
  sample(points, 128);
  if (selected.length < 12) return;
  // Estimate the direction in which collar slopes vary. A moulded rib carries
  // its section along the other direction; an isotropic interpolant can lose
  // that section across an opening longer than the rib is wide.
  const slopes: [number, number][] = [];
  for (const p of selected) {
    cancel();
    const nearby = selected
      .filter((q) => q !== p)
      .sort((a, b) => distance(p, a) - distance(p, b))
      .slice(0, 12);
    let xx = 0,
      xy = 0,
      yy = 0,
      xz = 0,
      yz = 0;
    for (const q of nearby) {
      const x = q[0] - p[0],
        y = q[1] - p[1],
        z = q[2] - p[2],
        w = 1 / Math.max(x * x + y * y, 1e-12);
      xx += w * x * x;
      xy += w * x * y;
      yy += w * y * y;
      xz += w * x * z;
      yz += w * y * z;
    }
    const determinant = xx * yy - xy * xy;
    if (determinant > 1e-12)
      slopes.push([
        (xz * yy - yz * xy) / determinant,
        (yz * xx - xz * xy) / determinant,
      ]);
  }
  const mean = slopes.reduce(
    (s, g) => [s[0] + g[0] / slopes.length, s[1] + g[1] / slopes.length],
    [0, 0],
  );
  let xx = 0,
    xy = 0,
    yy = 0;
  for (const g of slopes) {
    const x = g[0] - mean[0],
      y = g[1] - mean[1];
    xx += x * x;
    xy += x * y;
    yy += y * y;
  }
  const spread = Math.hypot(xx - yy, 2 * xy),
    major = (xx + yy + spread) / 2,
    minor = (xx + yy - spread) / 2;
  const angle = Math.atan2(2 * xy, xx - yy) / 2,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const ratio = major > 1e-12 ? Math.max(0.04, minor / major) : 1;
  const metric = (dx: number, dy: number) =>
    ratio < 0.25
      ? (c * dx + s * dy) ** 2 + ratio * (-s * dx + c * dy) ** 2
      : dx * dx + dy * dy;
  const solve = (
    metric: (dx: number, dy: number) => number,
  ): ((x: number, y: number) => number) | undefined => {
    const n = selected.length,
      size = n + 3;
    const matrix = Array.from(
      { length: size },
      () => new Float64Array(size + 1),
    );
    selected.forEach((p, i) => {
      for (let j = 0; j < n; j++)
        matrix[i][j] = kernel(
          metric(p[0] - selected[j][0], p[1] - selected[j][1]),
        );
      matrix[i][i] = 1e-8;
      matrix[i][n] = matrix[n][i] = 1;
      matrix[i][n + 1] = matrix[n + 1][i] = p[0];
      matrix[i][n + 2] = matrix[n + 2][i] = p[1];
      matrix[i][size] = p[2];
    });
    for (let k = 0; k < size; k++) {
      cancel();
      let pivot = k;
      for (let i = k + 1; i < size; i++)
        if (Math.abs(matrix[i][k]) > Math.abs(matrix[pivot][k])) pivot = i;
      if (Math.abs(matrix[pivot][k]) < 1e-12) return;
      [matrix[k], matrix[pivot]] = [matrix[pivot], matrix[k]];
      const divisor = matrix[k][k];
      for (let j = k; j <= size; j++) matrix[k][j] /= divisor;
      for (let i = 0; i < size; i++)
        if (i !== k) {
          const factor = matrix[i][k];
          for (let j = k; j <= size; j++) matrix[i][j] -= factor * matrix[k][j];
        }
    }
    const coefficients = matrix.map((row) => row[size]);
    const evaluate = (x: number, y: number) => {
      let z =
        coefficients[n] + coefficients[n + 1] * x + coefficients[n + 2] * y;
      for (let i = 0; i < n; i++)
        z +=
          coefficients[i] *
          kernel(metric(x - selected[i][0], y - selected[i][1]));
      return z;
    };
    let error = 0,
      minimum = Infinity,
      maximum = -Infinity;
    for (let i = 0; i < points.length; i++) {
      if (i % 128 === 0) cancel();
      const [x, y, z] = points[i],
        delta = evaluate(x, y) - z;
      if (!Number.isFinite(delta) || Math.abs(delta) > 0.1) return;
      error += delta * delta;
      minimum = Math.min(minimum, z);
      maximum = Math.max(maximum, z);
    }
    if (Math.sqrt(error / points.length) > 0.02) return;
    // Interpolation may follow curvature beyond rim heights, but never invent a
    // pit or peak outside the height envelope supported by the retained collar.
    return (x, y) => Math.max(minimum, Math.min(maximum, evaluate(x, y)));
  };
  const directional = solve(metric);
  return (
    directional ?? (ratio < 0.25 ? solve((x, y) => x * x + y * y) : undefined)
  );
}

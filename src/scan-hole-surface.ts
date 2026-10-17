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
  const n = selected.length,
    size = n + 3;
  const matrix = Array.from({ length: size }, () => new Float64Array(size + 1));
  selected.forEach((p, i) => {
    for (let j = 0; j < n; j++) matrix[i][j] = kernel(distance(p, selected[j]));
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
    let z = coefficients[n] + coefficients[n + 1] * x + coefficients[n + 2] * y;
    for (let i = 0; i < n; i++)
      z +=
        coefficients[i] *
        kernel((x - selected[i][0]) ** 2 + (y - selected[i][1]) ** 2);
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
}

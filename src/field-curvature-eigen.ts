export interface CurvatureEigenOptions {
  sort?: boolean;
  iterations?: number;
  tolerance?: number;
}

/** Packed symmetric tensor [xx, xy, xz, yy, yz, zz] to three [x, y, z, value] pairs. */
export function decomposeCurvatureTensor(
  tensor: ArrayLike<number>,
  {
    sort = true,
    iterations = 70,
    tolerance = 1e-20,
  }: CurvatureEigenOptions = {},
): Float64Array {
  if (
    tensor.length !== 6 ||
    Array.from(tensor).some((v) => !Number.isFinite(v))
  )
    throw new Error("A curvature tensor requires six finite entries.");
  if (!Number.isInteger(iterations) || iterations < 0 || iterations > 10000)
    throw new Error("Invalid curvature iteration limit.");
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error("Invalid curvature tolerance.");
  const a = new Float64Array([
    tensor[0],
    tensor[1],
    tensor[2],
    tensor[1],
    tensor[3],
    tensor[4],
    tensor[2],
    tensor[4],
    tensor[5],
  ]);
  const d = new Float64Array([tensor[0], tensor[3], tensor[5]]);
  const b = d.slice();
  const z = new Float64Array(3);
  const vectors = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const rotate = (
    array: Float64Array,
    i: number,
    j: number,
    s: number,
    tau: number,
  ) => {
    const g = array[i];
    const h = array[j];
    array[i] = g - (tau * g + h) * s;
    array[j] = (g - tau * h) * s + h;
  };
  for (let sweep = 1; sweep <= iterations; sweep++) {
    z.fill(0);
    const sum = Math.abs(a[2]) + Math.abs(a[1]) + Math.abs(a[5]);
    if (sum < tolerance) break;
    const threshold = sweep < 4 ? sum * 0.022222222222222223 : 0;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const index = p * 3 + q;
        const off = a[index];
        const g = Math.abs(off) * 100;
        if (sweep >= 5 && g < tolerance) {
          a[index] = 0;
          continue;
        }
        if (Math.abs(off) <= threshold) continue;
        const h = d[q] - d[p];
        let t: number;
        if (g >= tolerance) {
          const theta = (0.5 / off) * h;
          t = 1 / (Math.sqrt(theta * theta + 1) + Math.abs(theta));
          if (theta < 0) t = -t;
        } else {
          t = off / h;
        }
        a[index] = 0;
        const shift = off * t;
        d[p] -= shift;
        d[q] += shift;
        z[p] -= shift;
        z[q] += shift;
        const c = 1 / Math.sqrt(t * t + 1);
        const s = c * t;
        const tau = s / (c + 1);
        for (let j = 0; j < p; j++) rotate(a, j * 3 + p, j * 3 + q, s, tau);
        for (let j = p + 1; j < q; j++) rotate(a, p * 3 + j, j * 3 + q, s, tau);
        for (let j = q + 1; j < 3; j++) rotate(a, p * 3 + j, q * 3 + j, s, tau);
        for (let j = 0; j < 3; j++)
          rotate(vectors, j * 3 + p, j * 3 + q, s, tau);
      }
    }
    for (let i = 0; i < 3; i++) {
      b[i] += z[i];
      d[i] = b[i];
    }
  }
  const result = new Float64Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) result[i * 4 + j] = vectors[j * 3 + i];
    result[i * 4 + 3] = d[i];
  }
  if (sort) {
    for (const [p, q] of [
      [0, 1],
      [1, 2],
      [0, 1],
    ]) {
      if (Math.abs(result[p * 4 + 3]) > Math.abs(result[q * 4 + 3])) {
        for (let j = 0; j < 4; j++) {
          const previous = result[p * 4 + j];
          result[p * 4 + j] = result[q * 4 + j];
          result[q * 4 + j] = previous;
        }
      }
    }
  }
  if (result.some((v) => !Number.isFinite(v)))
    throw new Error("Curvature eigendecomposition overflowed.");
  return result;
}

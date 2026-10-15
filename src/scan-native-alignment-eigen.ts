/** Three-dimensional specialization of the original registration eigen solver.
 * Matrices are row-major; eigenvectors occupy columns. Sorting is optional.
 */
export function nativeAlignmentEigen3(
  matrix: readonly number[],
  sortDescending = true,
) {
  if (matrix.length !== 9 || !matrix.every(Number.isFinite))
    throw new Error("Alignment eigen solver requires a finite 3x3 matrix.");
  const a = matrix.slice();
  const d = [0, 0, 0];
  const e = [0, 0, 0];
  for (let i = 2; i > 0; i--) {
    const last = i - 1;
    let h = 0;
    let scale = 0;
    if (last < 1) e[i] = a[i * 3 + last];
    else {
      for (let k = 0; k <= last; k++) scale += Math.abs(a[i * 3 + k]);
      if (scale === 0) e[i] = a[i * 3 + last];
      else {
        for (let k = 0; k <= last; k++) {
          a[i * 3 + k] /= scale;
          h += a[i * 3 + k] * a[i * 3 + k];
        }
        let f = a[i * 3 + last];
        let g = Math.sqrt(h);
        if (f > 0) g = -g;
        e[i] = g * scale;
        h -= g * f;
        a[i * 3 + last] = f - g;
        f = 0;
        for (let j = 0; j <= last; j++) {
          a[j * 3 + i] = a[i * 3 + j] / h;
          g = 0;
          for (let k = 0; k <= j; k++) g += a[j * 3 + k] * a[i * 3 + k];
          for (let k = j + 1; k <= last; k++) g += a[k * 3 + j] * a[i * 3 + k];
          e[j] = g / h;
          f += e[j] * a[i * 3 + j];
        }
        // Preserve the accumulated f while updating each lower-triangle row.
        const accumulated = f;
        for (let j = 0; j <= last; j++) {
          const f = a[i * 3 + j];
          const g = e[j] - (accumulated / (h + h)) * f;
          e[j] = g;
          for (let k = 0; k <= j; k++)
            a[j * 3 + k] -= f * e[k] + g * a[i * 3 + k];
        }
      }
    }
    d[i] = h;
  }
  d[0] = e[0] = 0;
  for (let i = 0; i < 3; i++) {
    const last = i - 1;
    if (d[i] !== 0)
      for (let j = 0; j <= last; j++) {
        let g = 0;
        for (let k = 0; k <= last; k++) g += a[k * 3 + j] * a[i * 3 + k];
        for (let k = 0; k <= last; k++) a[k * 3 + j] -= g * a[k * 3 + i];
      }
    d[i] = a[i * 3 + i];
    a[i * 3 + i] = 1;
    for (let j = 0; j <= last; j++) a[j * 3 + i] = a[i * 3 + j] = 0;
  }
  e[0] = e[1];
  e[1] = e[2];
  e[2] = 0;
  for (let l = 0; l < 3; l++) {
    let iteration = 0;
    while (true) {
      let m = l;
      for (; m < 2; m++) if (Math.abs(e[m]) < 2 ** -23) break;
      if (m === l) break;
      if (iteration++ === 30) return { accepted: false, values: d, vectors: a };
      let g = (d[l + 1] - d[l]) / (e[l] + e[l]);
      const r = nativeEigenHypot(g, 1);
      g = e[l] / ((g < 0 ? -r : r) + g) + (d[m] - d[l]);
      let s = 1;
      let c = 1;
      let p = 0;
      let i = m - 1;
      let radius = 0;
      for (; i >= l; i--) {
        const f = e[i] * s;
        const b = e[i] * c;
        radius = nativeEigenHypot(f, g);
        e[i + 1] = radius;
        if (Math.abs(radius) < Number.EPSILON) {
          d[i + 1] -= p;
          e[m] = 0;
          break;
        }
        s = f / radius;
        c = g / radius;
        g = d[i + 1] - p;
        const r = (d[i] - g) * s + (c + c) * b;
        p = s * r;
        d[i + 1] = p + g;
        g = c * r - b;
        for (let k = 0; k < 3; k++) {
          const f = a[k * 3 + i + 1];
          a[k * 3 + i + 1] = f * c + s * a[k * 3 + i];
          a[k * 3 + i] = c * a[k * 3 + i] - f * s;
        }
      }
      if (Math.abs(radius) >= Number.EPSILON || i < l) {
        d[l] -= p;
        e[l] = g;
        e[m] = 0;
      }
    }
  }
  for (let i = 0; sortDescending && i < 2; i++) {
    let best = i;
    let value = d[i];
    for (let j = i + 1; j < 3; j++)
      if (value <= d[j]) {
        best = j;
        value = d[j];
      }
    if (best !== i) {
      d[best] = d[i];
      d[i] = value;
      for (let row = 0; row < 3; row++) {
        const temp = a[row * 3 + i];
        a[row * 3 + i] = a[row * 3 + best];
        a[row * 3 + best] = temp;
      }
    }
  }
  return { accepted: true, values: d, vectors: a };
}

function nativeEigenHypot(x: number, y: number) {
  const a = Math.abs(x),
    b = Math.abs(y);
  if (a > b) {
    const ratio = b / a;
    return Math.sqrt(ratio * ratio + 1) * a;
  }
  if (b <= Number.EPSILON) return 0;
  const ratio = a / b;
  return Math.sqrt(ratio * ratio + 1) * b;
}

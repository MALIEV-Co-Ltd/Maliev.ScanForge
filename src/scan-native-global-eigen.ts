/** Four-dimensional specialization of the original Global Fine Align eigen solver.
 * Matrices are row-major; eigenvectors occupy columns, sorted by descending value.
 */
export function nativeGlobalEigen4(matrix: readonly number[]) {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite))
    throw new Error("Alignment eigen solver requires a finite 4x4 matrix.");
  const a = matrix.slice();
  const d = [0, 0, 0, 0];
  const e = [0, 0, 0, 0];
  for (let i = 3; i > 0; i--) {
    const last = i - 1;
    let h = 0;
    let scale = 0;
    if (last < 1) e[i] = a[i * 4 + last];
    else {
      for (let k = 0; k <= last; k++) scale += Math.abs(a[i * 4 + k]);
      if (scale === 0) e[i] = a[i * 4 + last];
      else {
        for (let k = 0; k <= last; k++) {
          a[i * 4 + k] /= scale;
          h += a[i * 4 + k] * a[i * 4 + k];
        }
        let f = a[i * 4 + last];
        let g = Math.sqrt(h);
        if (f > 0) g = -g;
        e[i] = g * scale;
        h -= g * f;
        a[i * 4 + last] = f - g;
        f = 0;
        for (let j = 0; j <= last; j++) {
          a[j * 4 + i] = a[i * 4 + j] / h;
          g = 0;
          for (let k = 0; k <= j; k++) g += a[j * 4 + k] * a[i * 4 + k];
          for (let k = j + 1; k <= last; k++) g += a[k * 4 + j] * a[i * 4 + k];
          e[j] = g / h;
          f += e[j] * a[i * 4 + j];
        }
        // Preserve the accumulated f while updating each lower-triangle row.
        const accumulated = f;
        for (let j = 0; j <= last; j++) {
          const f = a[i * 4 + j];
          const g = e[j] - (accumulated / (h + h)) * f;
          e[j] = g;
          for (let k = 0; k <= j; k++)
            a[j * 4 + k] -= f * e[k] + g * a[i * 4 + k];
        }
      }
    }
    d[i] = h;
  }
  d[0] = e[0] = 0;
  for (let i = 0; i < 4; i++) {
    const last = i - 1;
    if (d[i] !== 0)
      for (let j = 0; j <= last; j++) {
        let g = 0;
        for (let k = 0; k <= last; k++) g += a[k * 4 + j] * a[i * 4 + k];
        for (let k = 0; k <= last; k++) a[k * 4 + j] -= g * a[k * 4 + i];
      }
    d[i] = a[i * 4 + i];
    a[i * 4 + i] = 1;
    for (let j = 0; j <= last; j++) a[j * 4 + i] = a[i * 4 + j] = 0;
  }
  e[0] = e[1];
  e[1] = e[2];
  e[2] = e[3];
  e[3] = 0;
  for (let l = 0; l < 4; l++) {
    let iteration = 0;
    while (true) {
      let m = l;
      for (; m < 3; m++) if (Math.abs(e[m]) < 2 ** -23) break;
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
        for (let k = 0; k < 4; k++) {
          const f = a[k * 4 + i + 1];
          a[k * 4 + i + 1] = f * c + s * a[k * 4 + i];
          a[k * 4 + i] = c * a[k * 4 + i] - f * s;
        }
      }
      if (Math.abs(radius) >= Number.EPSILON || i < l) {
        d[l] -= p;
        e[l] = g;
        e[m] = 0;
      }
    }
  }
  for (let i = 0; i < 3; i++) {
    let best = i;
    let value = d[i];
    for (let j = i + 1; j < 4; j++)
      if (value <= d[j]) {
        best = j;
        value = d[j];
      }
    if (best !== i) {
      d[best] = d[i];
      d[i] = value;
      for (let row = 0; row < 4; row++) {
        const temp = a[row * 4 + i];
        a[row * 4 + i] = a[row * 4 + best];
        a[row * 4 + best] = temp;
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

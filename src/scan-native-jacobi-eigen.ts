import {
  nativeGlobalCosine,
  nativeGlobalSine,
} from "./scan-native-global-trig";
import { nativeGlobalAtan2 } from "./scan-native-global-atan";

/** Original maximum-off-diagonal Jacobi fallback, specialized to 3x3. */
export function nativeJacobiEigen3(
  matrix: readonly number[],
  sortDescending = true,
) {
  if (matrix.length !== 9 || !matrix.every(Number.isFinite))
    throw new Error("Jacobi alignment requires a finite 3x3 matrix.");
  const a = matrix.slice(),
    vectors = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let iteration = 0; iteration < 1000; iteration++) {
    let p = 0,
      q = 1,
      largest = 0;
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) {
        const magnitude = Math.abs(a[i * 3 + j]);
        if (largest < magnitude) {
          largest = magnitude;
          p = i;
          q = j;
        }
      }
    if (largest < 1e-10) break;
    const app = a[p * 3 + p],
      aqq = a[q * 3 + q],
      apq = a[p * 3 + q];
    const angle = nativeGlobalAtan2(apq + apq, aqq - app) * 0.5;
    const c = nativeGlobalCosine(angle),
      s = nativeGlobalSine(angle),
      correction = (s + s) * c * apq;
    a[p * 3 + p] = c * c * app - correction + s * s * aqq;
    a[q * 3 + q] = s * s * app + correction + c * c * aqq;
    a[p * 3 + q] = a[q * 3 + p] = 0;
    for (let i = 0; i < 3; i++)
      if (i !== p && i !== q) {
        const x = a[i * 3 + p],
          y = a[i * 3 + q];
        a[i * 3 + p] = a[p * 3 + i] = x * c - y * s;
        a[i * 3 + q] = a[q * 3 + i] = x * s + y * c;
      }
    for (let i = 0; i < 3; i++) {
      const x = vectors[i * 3 + p],
        y = vectors[i * 3 + q];
      vectors[i * 3 + p] = x * c - y * s;
      vectors[i * 3 + q] = x * s + y * c;
    }
  }
  const values = [a[0], a[4], a[8]];
  for (let i = 0; sortDescending && i < 2; i++) {
    let best = i,
      value = values[i];
    for (let j = i + 1; j < 3; j++)
      if (value <= values[j]) {
        best = j;
        value = values[j];
      }
    if (best !== i) {
      [values[i], values[best]] = [values[best], values[i]];
      for (let row = 0; row < 3; row++)
        [vectors[row * 3 + i], vectors[row * 3 + best]] = [
          vectors[row * 3 + best],
          vectors[row * 3 + i],
        ];
    }
  }
  return { values, vectors };
}

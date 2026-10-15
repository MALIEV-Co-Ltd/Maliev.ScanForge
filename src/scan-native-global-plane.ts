import { nativeAlignmentEigen3 } from "./scan-native-alignment-eigen";
import { nativeJacobiEigen3 } from "./scan-native-jacobi-eigen";

const maximumFloat = 3.4028234663852886e38;
function matrixInput(matrix: readonly number[]) {
  if (matrix.length !== 9 || !matrix.every(Number.isFinite))
    throw new Error("Plane fitting requires a finite 3x3 moment matrix.");
}

/** Original unsorted eigen direction selection scores |A*v|, visiting columns
 * from last to first and retaining the first strict minimum. */
export function nativeGlobalPlaneDirection(
  matrix: readonly number[],
  initial: readonly number[] = [0, 0, 0],
) {
  matrixInput(matrix);
  const ql = nativeAlignmentEigen3(matrix, false);
  const eigen = ql.accepted ? ql : nativeJacobiEigen3(matrix, false);
  let best = Number.MAX_VALUE,
    normal = [...initial];
  for (let column = 2; column >= 0; column--) {
    const vector = [
      eigen.vectors[column],
      eigen.vectors[column + 3],
      eigen.vectors[column + 6],
    ];
    let score = 0;
    for (let row = 0; row < 3; row++) {
      let value = 0;
      for (let k = 0; k < 3; k++)
        value = vector[k] * matrix[row * 3 + k] + value;
      score += Math.abs(value);
    }
    if (score < best) {
      best = score;
      normal = vector;
    }
  }
  return { accepted: true, normal };
}

/** Original column scaling followed by scaled-row, last-tie partial-pivot LU. */
export function nativeGlobalLinearNormal(
  matrix: readonly number[],
  rhs: readonly number[],
  initial: readonly number[] = [0, 0, 0],
) {
  matrixInput(matrix);
  if (rhs.length !== 3 || !rhs.every(Number.isFinite))
    throw new Error("Plane fitting requires a finite three-value right side.");
  const fail = () => ({ accepted: false, normal: [...initial] });
  const a = matrix.slice(),
    columnScale = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    let largest = 0;
    for (let i = 0; i < 3; i++)
      if (largest <= Math.abs(a[i * 3 + j])) largest = Math.abs(a[i * 3 + j]);
    if (largest <= Number.EPSILON) return fail();
    columnScale[j] = 1 / largest;
    for (let i = 0; i < 3; i++) a[i * 3 + j] = (1 / largest) * a[i * 3 + j];
  }
  const scale = [0, 0, 0],
    pivot = [0, 0, 0],
    tolerance = 1e-10;
  for (let i = 0; i < 3; i++) {
    let largest = 0;
    for (let j = 0; j < 3; j++)
      if (largest < Math.abs(a[i * 3 + j])) largest = Math.abs(a[i * 3 + j]);
    if (Math.abs(largest) < tolerance) return fail();
    scale[i] = 1 / largest;
  }
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < j; i++) {
      let value = a[i * 3 + j];
      for (let k = 0; k < i; k++) value -= a[k * 3 + j] * a[i * 3 + k];
      a[i * 3 + j] = value;
    }
    let largest = 0,
      best = j;
    for (let i = j; i < 3; i++) {
      let value = a[i * 3 + j];
      for (let k = 0; k < j; k++) value -= a[k * 3 + j] * a[i * 3 + k];
      a[i * 3 + j] = value;
      const candidate = Math.abs(value) * scale[i];
      if (!(candidate < largest)) {
        largest = candidate;
        best = i;
      }
    }
    if (j !== best) {
      for (let k = 0; k < 3; k++)
        [a[best * 3 + k], a[j * 3 + k]] = [a[j * 3 + k], a[best * 3 + k]];
      scale[best] = scale[j];
    }
    pivot[j] = best;
    const diagonal = a[j * 3 + j];
    if (Math.abs(diagonal) < tolerance) return fail();
    for (let i = j + 1; i < 3; i++)
      a[i * 3 + j] = (1 / diagonal) * a[i * 3 + j];
  }
  const b = rhs.slice();
  let first = -1;
  for (let i = 0; i < 3; i++) {
    let value = b[pivot[i]];
    b[pivot[i]] = b[i];
    if (first < 0) {
      if (value !== 0) first = i;
    } else for (let j = first; j < i; j++) value -= a[i * 3 + j] * b[j];
    b[i] = value;
  }
  for (let i = 2; i >= 0; i--) {
    let value = b[i];
    for (let j = i + 1; j < 3; j++) value -= a[i * 3 + j] * b[j];
    b[i] = value / a[i * 3 + i];
  }
  return { accepted: true, normal: b.map((v, i) => v * columnScale[i]) };
}

export function nativeGlobalPlane(
  points: readonly (readonly number[])[],
  options: {
    active?: readonly number[];
    normals?: readonly (readonly number[])[];
    initialNormal?: readonly number[];
    initialCoefficient?: number;
  } = {},
) {
  if (
    points.some((p) => p.length !== 3 || !p.every(Number.isFinite)) ||
    (options.active &&
      (options.active.length !== points.length ||
        options.active.some((a) => a !== 0 && a !== 1))) ||
    (options.normals &&
      (options.normals.length !== points.length ||
        options.normals.some(
          (p) => p.length !== 3 || !p.every(Number.isFinite),
        )))
  )
    throw new Error(
      "Plane fitting requires finite XYZ and matching active/normal sidecars.",
    );
  let normal = [...(options.initialNormal ?? [0, 0, 0])],
    coefficient = options.initialCoefficient ?? 0;
  const active = points.filter(
    (_, i) => !options.active || options.active[i] !== 0,
  );
  const finish = (accepted: boolean) => ({ accepted, normal, coefficient });
  if (active.length < 3) return finish(false);
  if (active.length === 3) {
    const [p, q, r] = active;
    normal = [
      (r[2] - p[2]) * (q[1] - p[1]) - (q[2] - p[2]) * (r[1] - p[1]),
      (q[2] - p[2]) * (r[0] - p[0]) - (r[2] - p[2]) * (q[0] - p[0]),
      (r[1] - p[1]) * (q[0] - p[0]) - (q[1] - p[1]) * (r[0] - p[0]),
    ];
    const squared =
      normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2];
    if (!(squared >= 2 ** -23)) return finish(false);
    const reciprocal = 1 / Math.sqrt(squared);
    normal = normal.map((v) => v * reciprocal);
    coefficient = -(
      (p[1] + q[1] + r[1]) * 0.3333333333333333 * normal[1] +
      (p[0] + q[0] + r[0]) * 0.3333333333333333 * normal[0] +
      (p[2] + q[2] + r[2]) * 0.3333333333333333 * normal[2]
    );
    return finish(true);
  }
  const center = [0, 0, 0];
  for (const p of active) for (let a = 0; a < 3; a++) center[a] += p[a];
  for (let a = 0; a < 3; a++) center[a] *= 1 / active.length;
  const centered = new Array<number>(9).fill(0),
    moments = new Array<number>(9).fill(0),
    rhs = [0, 0, 0];
  for (const p of active) {
    const local = p.map((v, a) => v - center[a]);
    for (let i = 0; i < 3; i++) {
      rhs[i] = -1 * p[i] + rhs[i];
      for (let j = i; j < 3; j++) {
        centered[i * 3 + j] = local[j] * local[i] + centered[i * 3 + j];
        moments[i * 3 + j] = p[j] * p[i] + moments[i * 3 + j];
        if (i !== j) {
          centered[j * 3 + i] = centered[i * 3 + j];
          moments[j * 3 + i] = moments[i * 3 + j];
        }
      }
    }
  }
  const score = (n: readonly number[], c: number) => {
    let sum = 0;
    for (const p of active)
      sum += Math.abs(p[1] * n[1] + n[0] * p[0] + p[2] * n[2] + c);
    return sum / active.length;
  };
  const candidate = nativeGlobalPlaneDirection(centered).normal;
  const dot =
    candidate[1] * center[1] +
    candidate[0] * center[0] +
    candidate[2] * center[2];
  let lengthSquared =
    candidate[1] * candidate[1] +
    candidate[0] * candidate[0] +
    candidate[2] * candidate[2];
  let firstNormal = candidate,
    firstCoefficient = -dot,
    firstScore = maximumFloat;
  if (lengthSquared > Number.EPSILON) {
    const length = Math.sqrt(lengthSquared),
      inverse = 1 / length;
    firstNormal = candidate.map((v) => inverse * v);
    firstCoefficient = -dot / length;
    firstScore = score(firstNormal, firstCoefficient);
  }
  const second = nativeGlobalLinearNormal(moments, rhs);
  let secondNormal = second.normal,
    secondCoefficient = 0,
    secondScore = maximumFloat;
  if (second.accepted) {
    lengthSquared =
      second.normal[1] * second.normal[1] +
      second.normal[0] * second.normal[0] +
      second.normal[2] * second.normal[2];
    secondCoefficient = 1;
    if (lengthSquared > Number.EPSILON) {
      const length = Math.sqrt(lengthSquared);
      secondCoefficient = 1 / length;
      secondNormal = second.normal.map((v) => secondCoefficient * v);
      secondScore = score(secondNormal, secondCoefficient);
    }
  }
  if (!(
    Math.abs(firstScore - maximumFloat) > 2 ** -23 ||
    Math.abs(secondScore - maximumFloat) > 2 ** -23
  ))
    return finish(false);
  if (secondScore <= firstScore) {
    normal = secondNormal;
    coefficient = secondCoefficient;
  } else {
    normal = firstNormal;
    coefficient = firstCoefficient;
  }
  const orientation = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const n = options.normals?.[i] ?? [1, 0, 0];
    for (let a = 0; a < 3; a++) orientation[a] += n[a];
  }
  const orientationLength = Math.sqrt(
    orientation[0] * orientation[0] +
      orientation[1] * orientation[1] +
      orientation[2] * orientation[2],
  );
  if (orientationLength >= Number.EPSILON)
    for (let a = 0; a < 3; a++) orientation[a] *= 1 / orientationLength;
  if (
    orientation[0] * normal[0] +
      orientation[1] * normal[1] +
      orientation[2] * normal[2] <
    0
  ) {
    if (
      !Number.isNaN(normal[0]) &&
      Math.abs(Math.fround(normal[0]) - Math.fround(maximumFloat)) >=
        Math.fround(2 ** -23)
    )
      normal = normal.map((v) => -v);
    coefficient = -coefficient;
  }
  return finish(true);
}

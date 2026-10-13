import { nativeAlignmentParameters } from "./scan-native-alignment-refinement";
import { nativeAlignmentRotation } from "./scan-native-alignment";

const epsilon = Number.EPSILON;
/** Scaled partial-pivot LU, including native last-row tie selection. */
function inverse3(input: readonly number[]): number[] | undefined {
  const lu = Array.from(input);
  const scales: number[] = [];
  const pivots: number[] = [];
  for (let row = 0; row < 3; row++) {
    let maximum = 0;
    for (let column = 0; column < 3; column++) {
      const value = Math.abs(lu[row * 3 + column]);
      if (value > maximum) maximum = value;
    }
    if (maximum < epsilon) return undefined;
    scales[row] = 1 / maximum;
  }
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < column; row++) {
      let sum = lu[row * 3 + column];
      for (let k = 0; k < row; k++) sum -= lu[row * 3 + k] * lu[k * 3 + column];
      lu[row * 3 + column] = sum;
    }
    let maximum = 0;
    let pivot = column;
    for (let row = column; row < 3; row++) {
      let sum = lu[row * 3 + column];
      for (let k = 0; k < column; k++)
        sum -= lu[row * 3 + k] * lu[k * 3 + column];
      lu[row * 3 + column] = sum;
      const score = Math.abs(sum) * scales[row];
      if (!(score < maximum)) {
        maximum = score;
        pivot = row;
      }
    }
    if (pivot !== column) {
      for (let k = 0; k < 3; k++) {
        const value = lu[pivot * 3 + k];
        lu[pivot * 3 + k] = lu[column * 3 + k];
        lu[column * 3 + k] = value;
      }
      scales[pivot] = scales[column];
    }
    pivots[column] = pivot;
    const diagonal = lu[column * 3 + column];
    if (Math.abs(diagonal) < epsilon) return undefined;
    if (column !== 2) {
      for (let row = column + 1; row < 3; row++)
        lu[row * 3 + column] = (1 / diagonal) * lu[row * 3 + column];
    }
  }
  const result = Array<number>(9);
  for (let column = 0; column < 3; column++) {
    const rhs = [0, 0, 0];
    rhs[column] = 1;
    let first = -1;
    for (let row = 0; row < 3; row++) {
      const pivot = pivots[row];
      let sum = rhs[pivot];
      rhs[pivot] = rhs[row];
      if (first === -1) {
        if (sum !== 0) first = row;
      } else for (let k = first; k < row; k++) sum -= lu[row * 3 + k] * rhs[k];
      rhs[row] = sum;
    }
    for (let row = 2; row >= 0; row--) {
      let sum = rhs[row];
      for (let k = row + 1; k < 3; k++) sum -= lu[row * 3 + k] * rhs[k];
      rhs[row] = sum / lu[row * 3 + row];
    }
    for (let row = 0; row < 3; row++) result[row * 3 + column] = rhs[row];
  }
  return result;
}
/** Row-major 3x3 specialization of the recovered scaled polar iteration. */
function polarRotation(input: readonly number[]): number[] | undefined {
  let current = Array.from(input);
  for (let iteration = 0; iteration < 10; iteration++) {
    const inverse = inverse3(current);
    if (!inverse) return undefined;
    const transposed = [
      inverse[0],
      inverse[3],
      inverse[6],
      inverse[1],
      inverse[4],
      inverse[7],
      inverse[2],
      inverse[5],
      inverse[8],
    ];
    const norm = (values: readonly number[]) => {
      let sum = 0;
      for (const value of values) sum += value * value;
      return Math.sqrt(sum);
    };
    const scale = Math.sqrt(norm(transposed) / norm(current));
    const next = current.map(
      (value, id) => (transposed[id] / scale + scale * value) * 0.5,
    );
    const difference = norm(current.map((value, id) => value - next[id]));
    current = next;
    if (!(epsilon < difference)) return current;
  }
  return undefined;
}

/** Original rotation correction preserves translation and falls back to quaternion conversion. */
export function nativeCorrectAlignmentRotation(
  matrix: readonly number[],
): number[] {
  if (matrix.length !== 12 || !matrix.every(Number.isFinite))
    throw new Error("Rotation correction requires a finite 3x4 matrix.");
  const rotation = polarRotation([
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[4],
    matrix[5],
    matrix[6],
    matrix[8],
    matrix[9],
    matrix[10],
  ]);
  const result = Array.from(matrix);
  if (rotation) {
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 3; column++)
        result[row * 4 + column] = rotation[row * 3 + column];
  } else {
    const parameters = nativeAlignmentParameters(matrix);
    const corrected = nativeAlignmentRotation(
      parameters.slice(0, 4) as [number, number, number, number],
    );
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 3; column++)
        result[row * 4 + column] = corrected[row * 3 + column];
  }
  return result;
}

function rotate(
  matrix: readonly number[],
  angle: number,
  axis: readonly number[],
): number[] {
  let [x, y, z] = axis;
  const length = Math.sqrt(y * y + x * x + z * z);
  if (epsilon <= length) {
    const reciprocal = 1 / length;
    x *= reciprocal;
    z = reciprocal * z;
    y = reciprocal * y;
  }
  const sine = Math.sin(angle),
    cosine = Math.cos(angle),
    remainder = 1 - cosine;
  const xy = y * x * remainder,
    xz = z * x * remainder,
    yz = z * y * remainder;
  const rotation = [
    x * x * remainder + cosine,
    xy - z * sine,
    y * sine + xz,
    z * sine + xy,
    y * y * remainder + cosine,
    yz - x * sine,
    xz - y * sine,
    x * sine + yz,
    z * z * remainder + cosine,
  ];
  const output = Array.from(matrix);
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      output[row * 4 + column] =
        rotation[row * 3] * matrix[column] +
        rotation[row * 3 + 1] * matrix[4 + column] +
        rotation[row * 3 + 2] * matrix[8 + column];
  return nativeCorrectAlignmentRotation(output);
}

/** Complete recovered six-parameter transform; geometric query/refinement dispatch is separate. */
export function nativeAlignmentSixTransform(
  parameters: readonly number[],
  translationOnly = false,
): number[] {
  if (parameters.length !== 6 || !parameters.every(Number.isFinite))
    throw new Error("Alignment transform requires six finite parameters.");
  const [px, py, pz] = parameters,
    x = px - 10,
    y = py - 10,
    z = pz - 10;
  let matrix = [
    1,
    0,
    0,
    y * 0 + x + z * 0 + 0,
    0,
    1,
    0,
    x * 0 + y + z * 0 + 0,
    0,
    0,
    1,
    x * 0 + y * 0 + z + 0,
  ];
  const angles = translationOnly
    ? [0, 0, 0]
    : parameters.slice(3).map((value) => value - Math.PI / 2);
  matrix = rotate(matrix, angles[2], [0, 0, 1]);
  matrix = rotate(matrix, angles[1], [matrix[1], matrix[5], matrix[9]]);
  return rotate(matrix, angles[0], [matrix[0], matrix[4], matrix[8]]);
}

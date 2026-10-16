/** World-space scan application preserves native double arithmetic and Float32 storage. */
export function transformDatumCoordinates(
  input: ArrayLike<number>,
  matrix: readonly number[],
  vector = false,
  bounds?: { min: number[]; max: number[] },
): Float32Array {
  if (
    input.length % 3 ||
    matrix.length !== 12 ||
    !matrix.every(Number.isFinite)
  )
    throw new Error(
      "Alignment transform requires XYZ coordinates and a finite 3x4 matrix.",
    );
  const output = new Float32Array(input.length);
  for (let offset = 0; offset < input.length; offset += 3) {
    const x = input[offset],
      y = input[offset + 1],
      z = input[offset + 2];
    const a = y * matrix[1] + x * matrix[0] + z * matrix[2],
      b = y * matrix[5] + x * matrix[4] + z * matrix[6],
      c = y * matrix[9] + x * matrix[8] + z * matrix[10];
    output[offset] = vector ? a : a + matrix[3];
    output[offset + 1] = vector ? b : b + matrix[7];
    output[offset + 2] = vector ? c : c + matrix[11];
    for (let axis = 0; axis < 3; axis++) {
      const value = output[offset + axis];
      if (!Number.isFinite(value) || (!vector && Math.abs(value) > 1e9))
        throw new Error("Aligned scan coordinates exceed the supported range.");
      if (bounds) {
        bounds.min[axis] = Math.min(bounds.min[axis], value);
        bounds.max[axis] = Math.max(bounds.max[axis], value);
      }
    }
  }
  return output;
}

/** Geometry stores Float32 results after every applied native frame. */
export function transformDatumCoordinateStages(
  input: ArrayLike<number>,
  matrices: readonly (readonly number[])[],
  vector = false,
  bounds?: { min: number[]; max: number[] },
): Float32Array {
  if (!matrices.length || matrices.length > 16)
    throw new Error("Alignment requires one to 16 finite transform stages.");
  let output: ArrayLike<number> = input;
  for (let i = 0; i < matrices.length; i++)
    output = transformDatumCoordinates(
      output,
      matrices[i],
      vector,
      i === matrices.length - 1 ? bounds : undefined,
    );
  return output as Float32Array;
}

import { transformDatumCoordinateStages } from "./datum-transform-kernel";
interface DatumTransformInput {
  id: number;
  input: Float32Array | Float64Array;
  vector: boolean;
}
export type DatumTransformRequest = DatumTransformInput &
  (
    | { matrix: number[]; matrices?: never }
    | { matrices: number[][]; matrix?: never }
  );
export type DatumTransformResponse =
  | { id: number; output: Float32Array; min: number[]; max: number[] }
  | { id: number; error: string };
export function executeDatumTransform(
  input: DatumTransformRequest,
): DatumTransformResponse {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  if (Boolean(input.matrix) === Boolean(input.matrices))
    throw new Error(
      "Alignment worker requires either one matrix or a matrix sequence.",
    );
  const output = transformDatumCoordinateStages(
    input.input,
    input.matrices ?? [input.matrix!],
    input.vector,
    { min, max },
  );
  return { id: input.id, output, min, max };
}

import { transformDatumCoordinates } from "./datum-transform-kernel";
export interface DatumTransformRequest {
  id: number;
  input: Float32Array | Float64Array;
  matrix: number[];
  vector: boolean;
}
export type DatumTransformResponse =
  | { id: number; output: Float32Array; min: number[]; max: number[] }
  | { id: number; error: string };
export function executeDatumTransform(
  input: DatumTransformRequest,
): DatumTransformResponse {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  const output = transformDatumCoordinates(
    input.input,
    input.matrix,
    input.vector,
    { min, max },
  );
  return { id: input.id, output, min, max };
}
const scope = globalThis as unknown as {
  postMessage?: (
    value: DatumTransformResponse,
    transfer?: Transferable[],
  ) => void;
  onmessage: ((event: MessageEvent<DatumTransformRequest>) => void) | null;
  close?: () => void;
  document?: unknown;
};
if (typeof scope.postMessage === "function" && !scope.document) {
  let timer: ReturnType<typeof setTimeout>;
  const renew = () => {
    clearTimeout(timer);
    timer = setTimeout(() => scope.close?.(), 30_000);
  };
  renew();
  scope.onmessage = ({ data }) => {
    renew();
    try {
      const result = executeDatumTransform(data);
      scope.postMessage!(
        result,
        "output" in result ? [result.output.buffer as ArrayBuffer] : [],
      );
    } catch (error) {
      scope.postMessage!({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

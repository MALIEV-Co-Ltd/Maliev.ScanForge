import {
  executeDatumTransform,
  type DatumTransformRequest,
  type DatumTransformResponse,
} from "./datum-transform-core";
export * from "./datum-transform-core";
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

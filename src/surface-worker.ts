import { fitGridSurface, type SurfaceFitOptions } from "./surfaces";

const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          positions: Float32Array | Float64Array;
          options: SurfaceFitOptions;
        }>,
      ) => void)
    | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = (event) => {
  try {
    scope.postMessage({ status: "running" });
    const result = fitGridSurface(event.data.positions, event.data.options);
    scope.postMessage({ result });
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

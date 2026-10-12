import { smoothingTargets, type SmoothingRings } from "./scan-smoothing-kernel";
export type SmoothingWorkerRequest =
  | {
      initialize: {
        triangles: Uint32Array;
        rings: SmoothingRings;
        movable: Uint32Array;
      };
    }
  | { selection: Uint32Array }
  | { iteration: number; vertices: Float64Array; strength: number };
export type SmoothingWorkerResponse =
  { iteration: number; targets: Float64Array } | { error: string };
let state:
  | Extract<SmoothingWorkerRequest, { initialize: unknown }>["initialize"]
  | undefined;
const scope = self as unknown as {
  onmessage: (event: MessageEvent<SmoothingWorkerRequest>) => void;
  postMessage(
    message: SmoothingWorkerResponse,
    transfers?: Transferable[],
  ): void;
  close(): void;
};
// A child has its own finite lease even if its parent disappears unexpectedly.
let lease: ReturnType<typeof setTimeout>;
scope.onmessage = ({ data }) => {
  clearTimeout(lease);
  lease = setTimeout(() => scope.close(), 120_000);
  try {
    if ("initialize" in data) {
      state = data.initialize;
      return;
    }
    if (!state) throw new Error("Smoothing worker is not initialized.");
    if ("selection" in data) {
      state.movable = data.selection;
      return;
    }
    const targets = smoothingTargets(
      data.vertices,
      state.triangles,
      state.rings,
      state.movable,
      data.strength,
    );
    scope.postMessage({ iteration: data.iteration, targets }, [targets.buffer]);
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

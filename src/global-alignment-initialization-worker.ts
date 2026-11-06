import {
  refineGlobalSurfaceSamples,
  type GlobalSurfaceMesh,
} from "./global-alignment-surface-core";
import {
  initializeGlobalSamples,
  type GlobalInitializationScan,
} from "./global-alignment-initialization-core";
const scope = globalThis as unknown as {
  postMessage: (v: unknown) => void;
  close: () => void;
  onmessage:
    | ((
        e: MessageEvent<
          | GlobalInitializationScan[]
          | {
              samples: GlobalInitializationScan[];
              meshes: GlobalSurfaceMesh[];
              distanceLimit: number;
            }
        >,
      ) => void)
    | null;
};
scope.onmessage = ({ data }) => {
  try {
    const onPose = (poses: unknown) => scope.postMessage({ poses });
    const result = Array.isArray(data)
      ? initializeGlobalSamples(data, onPose)
      : refineGlobalSurfaceSamples(
          data.samples,
          data.meshes,
          onPose,
          data.distanceLimit,
        );
    scope.postMessage({ result });
  } catch (e) {
    scope.postMessage({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    scope.close();
  }
};

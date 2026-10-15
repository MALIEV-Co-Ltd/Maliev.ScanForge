import {
  nativeGlobalQuery,
  prepareNativeGlobalQueryGeometry,
  type NativeGlobalQueryGeometry,
  type NativeGlobalQueryInput,
} from "./scan-native-global-query";
export interface GlobalQueryWorkerInit {
  scans: { id: string; geometry: NativeGlobalQueryGeometry }[];
}
export interface GlobalQueryJob extends Pick<
  NativeGlobalQueryInput,
  "cells" | "radius" | "mode" | "mask" | "gateCount"
> {
  sourceId: string;
  poses: { id: string; matrix: readonly number[] }[];
}
export type GlobalQueryRequest =
  | { id: number; initialize: GlobalQueryWorkerInit }
  | { id: number; job: GlobalQueryJob };
export type GlobalQueryResponse =
  | { id: number; ready: true; indexes: number }
  | { id: number; result: ReturnType<typeof nativeGlobalQuery> }
  | { id: number; error: string };
export function createGlobalQueryWorkerState(input: GlobalQueryWorkerInit) {
  const geometries = new Map<string, NativeGlobalQueryGeometry>();
  for (const scan of input.scans) {
    if (!scan.id || geometries.has(scan.id))
      throw new Error("Global worker scan IDs must be unique.");
    prepareNativeGlobalQueryGeometry(scan.geometry);
    geometries.set(scan.id, scan.geometry);
  }
  return {
    indexes: geometries.size,
    execute(job: GlobalQueryJob) {
      const seen = new Set<string>();
      const scans = job.poses.map((pose) => {
        const geometry = geometries.get(pose.id);
        if (!geometry || seen.has(pose.id))
          throw new Error("Global worker pose IDs must be known and unique.");
        seen.add(pose.id);
        return { ...pose, geometry };
      });
      const source = scans.find((scan) => scan.id === job.sourceId);
      if (!source) throw new Error("Global worker source pose is missing.");
      return nativeGlobalQuery({ ...job, source, targets: scans });
    },
  };
}
const scope = globalThis as unknown as {
  postMessage(data: GlobalQueryResponse): void;
  close(): void;
  onmessage: ((event: MessageEvent<GlobalQueryRequest>) => void) | null;
};
if (
  typeof scope.postMessage === "function" &&
  typeof document === "undefined"
) {
  let state: ReturnType<typeof createGlobalQueryWorkerState> | undefined;
  let idle: ReturnType<typeof setTimeout>;
  const lease = setTimeout(() => scope.close(), 15 * 60_000);
  const renew = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      clearTimeout(lease);
      scope.close();
    }, 30_000);
  };
  renew();
  scope.onmessage = ({ data }) => {
    renew();
    try {
      if ("initialize" in data) {
        state = createGlobalQueryWorkerState(data.initialize);
        scope.postMessage({ id: data.id, ready: true, indexes: state.indexes });
      } else {
        if (!state) throw new Error("Global query worker is not initialized.");
        scope.postMessage({ id: data.id, result: state.execute(data.job) });
      }
    } catch (error) {
      scope.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      renew();
    }
  };
}

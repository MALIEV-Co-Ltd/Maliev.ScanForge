import type {
  AlignmentBatch,
  AlignmentBatchResult,
} from "./scan-native-alignment-objective";
import { runAlignmentBatch } from "./scan-native-alignment-objective";
import type { AlignmentQueryVertex } from "./scan-native-alignment-query";
import {
  createNativeAlignmentSurfaceQuery,
  type AlignmentWorkerSurface,
} from "./scan-native-alignment-mesh-query";
import { nativeAlignmentTargetGroupQuery } from "./scan-native-alignment-target-group";
export interface AlignmentWorkerInit {
  lanes: { id: number; vertices: AlignmentQueryVertex[] }[];
  surfaces: AlignmentWorkerSurface[];
}
export type AlignmentWorkerRequest =
  | { id: number; initialize: AlignmentWorkerInit }
  | { id: number; job: Omit<AlignmentBatch, "lanes"> };
export type AlignmentWorkerResponse =
  | { id: number; ready: true }
  | { id: number; laneIds: number[]; result: AlignmentBatchResult }
  | { id: number; error: string };
export function createAlignmentWorkerState(input: AlignmentWorkerInit) {
  const query = nativeAlignmentTargetGroupQuery(
    input.surfaces.map(createNativeAlignmentSurfaceQuery),
  );
  return (job: Omit<AlignmentBatch, "lanes">) => {
    const batch = {
      ...job,
      lanes: input.lanes.map((lane) => lane.vertices),
    } as AlignmentBatch;
    const result = runAlignmentBatch(batch, query);
    if (result.kind === "query")
      for (let lane = 0; lane < input.lanes.length; lane++)
        for (
          let vertex = 0;
          vertex < input.lanes[lane].vertices.length;
          vertex++
        )
          input.lanes[lane].vertices[vertex].flags =
            result.workers[lane].flags[vertex];
    return { laneIds: input.lanes.map((lane) => lane.id), result };
  };
}
const scope = globalThis as unknown as {
  postMessage(value: AlignmentWorkerResponse): void;
  close(): void;
  onmessage: ((event: MessageEvent<AlignmentWorkerRequest>) => void) | null;
};
if (
  typeof scope.postMessage === "function" &&
  typeof document === "undefined"
) {
  let state: ReturnType<typeof createAlignmentWorkerState> | undefined;
  let idle: ReturnType<typeof setTimeout>;
  const absoluteLease = setTimeout(() => scope.close(), 15 * 60_000);
  const renew = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      clearTimeout(absoluteLease);
      scope.close();
    }, 30_000);
  };
  renew();
  scope.onmessage = ({ data }: MessageEvent<AlignmentWorkerRequest>) => {
    renew();
    try {
      if ("initialize" in data) {
        state = createAlignmentWorkerState(data.initialize);
        scope.postMessage({ id: data.id, ready: true });
      } else {
        if (!state) throw new Error("Alignment worker is not initialized.");
        scope.postMessage({ id: data.id, ...state(data.job) });
      }
    } catch (error) {
      scope.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

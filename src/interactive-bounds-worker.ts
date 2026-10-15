import { interactiveBoundsLane } from "./interactive-bounds-kernel";
export interface BoundsSource {
  positions: Float32Array;
  flags?: Uint32Array;
  ranges: { index: number; start: number; end: number }[];
}
export type BoundsTask =
  | ({ id: number; action: "prepare"; key: string } & BoundsSource)
  | { id: number; action: "measure"; key: string; matrix: number[] };
export interface BoundsTaskResult {
  id: number;
  ready?: boolean;
  error?: string;
  lanes?: { index: number; values: Float32Array }[];
}
export function executeInteractiveBoundsTask(
  task: BoundsTask,
  cache: Map<string, BoundsSource>,
): BoundsTaskResult {
  try {
    if (task.action === "prepare") {
      if (
        task.positions.length % 3 ||
        task.ranges.length > 8 ||
        (task.flags && task.flags.length !== task.positions.length / 3)
      )
        throw new Error("Invalid cached bounds source.");
      cache.set(task.key, {
        positions: task.positions,
        flags: task.flags,
        ranges: task.ranges,
      });
      return { id: task.id, ready: true };
    }
    const source = cache.get(task.key);
    if (!source) throw new Error("Bounds source expired.");
    return {
      id: task.id,
      lanes: source.ranges.map((r) => ({
        index: r.index,
        values: interactiveBoundsLane(
          source.positions,
          task.matrix,
          r.start,
          r.end,
          source.flags,
        ),
      })),
    };
  } catch (error) {
    return {
      id: task.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
const scope = globalThis as unknown as {
  postMessage?: (data: BoundsTaskResult, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<BoundsTask>) => void) | null;
  close?: () => void;
  document?: unknown;
};
if (typeof scope.postMessage === "function" && !scope.document) {
  const cache = new Map<string, BoundsSource>();
  let timer: ReturnType<typeof setTimeout>;
  const renew = () => {
    clearTimeout(timer);
    timer = setTimeout(() => scope.close?.(), 120000);
  };
  renew();
  scope.onmessage = ({ data }) => {
    renew();
    const result = executeInteractiveBoundsTask(data, cache);
    scope.postMessage!(
      result,
      result.lanes?.map((l) => l.values.buffer as ArrayBuffer) ?? [],
    );
  };
}

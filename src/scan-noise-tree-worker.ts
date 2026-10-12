import {
  refineNoiseOctant,
  type PackedNoiseTree,
  type NoiseTreeNode,
} from "./scan-noise-octree";

export interface NoiseTreeTask {
  prepared: PackedNoiseTree;
  begin: number;
  end: number;
  minimumExtent: number;
  maximumDepth: number;
}
export type NoiseTreeResult =
  | { children: Partial<Record<number, NoiseTreeNode>>; descendants: number }
  | { error: string };

/** Fixed per-task allocation bound; oversize trees retry through the serial path. */
export function constructNoiseTreeTask(task: NoiseTreeTask): NoiseTreeResult {
  const children: Partial<Record<number, NoiseTreeNode>> = {};
  let descendants = 0;
  let memberships = 0;
  for (let octant = task.begin; octant < task.end; octant++) {
    const result = refineNoiseOctant(
      task.prepared,
      octant,
      task.minimumExtent,
      task.maximumDepth,
      {},
      4000 - descendants,
      500000 - memberships,
    );
    descendants += result.descendants;
    memberships += result.memberships;
    children[octant] = result.node;
  }
  return { children, descendants };
}

const scope = globalThis as unknown as {
  document?: unknown;
  close?: () => void;
  postMessage?: (result: NoiseTreeResult) => void;
  onmessage?: (event: MessageEvent<NoiseTreeTask>) => void;
};
if (scope.postMessage && scope.close && !scope.document) {
  const expiry = setTimeout(() => scope.close?.(), 120_000);
  scope.onmessage = ({ data }) => {
    try {
      scope.postMessage?.(constructNoiseTreeTask(data));
    } catch (error) {
      scope.postMessage?.({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(expiry);
      scope.close?.();
    }
  };
}

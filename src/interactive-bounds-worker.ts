import { interactiveBoundsLane } from "./interactive-bounds-kernel";
import {
  deriveInteractiveMeshSource,
  type InteractiveMeshDerivation,
  type NativeVertexState,
} from "./interactive-mesh-source";
import {
  nativeInteractiveMirrorPoints,
  firstInteractiveMirrorBasePoint,
  type InteractiveMirrorPointInput,
} from "./interactive-mirror-selection";
export type InteractiveMirrorSettings = Omit<
  InteractiveMirrorPointInput,
  "normals" | "flags"
>;
export interface BoundsSource {
  positions: Float32Array;
  flags?: Uint32Array;
  normals?: Float32Array;
  offset?: number;
  ranges: { index: number; start: number; end: number }[];
}
export type BoundsTask =
  | ({ id: number; action: "deriveMesh" } & InteractiveMeshDerivation)
  | { id: number; action: "normals"; key: string; normals: Float32Array }
  | ({ id: number; action: "prepare"; key: string } & BoundsSource)
  | { id: number; action: "measure"; key: string; matrix: number[] }
  | {
      id: number;
      action: "mirrorPrefix";
      key: string;
      stride: number;
      onlySelected: boolean;
    }
  | {
      id: number;
      action: "mirror";
      key: string;
      settings: InteractiveMirrorSettings;
      initialBaseColor: boolean;
      includeColors: boolean;
    };
export interface BoundsTaskResult {
  id: number;
  ready?: boolean;
  error?: string;
  lanes?: { index: number; values: Float32Array }[];
  firstBasePoint?: number | null;
  meshState?: NativeVertexState;
  normals?: Float32Array;
  points?: ReturnType<typeof nativeInteractiveMirrorPoints> & {
    offset: number;
    count: number;
  };
}
export function executeInteractiveBoundsTask(
  task: BoundsTask,
  cache: Map<string, BoundsSource>,
): BoundsTaskResult {
  try {
    if (task.action === "deriveMesh") {
      const derived = deriveInteractiveMeshSource(task);
      return {
        id: task.id,
        meshState: derived.state,
        normals: derived.normals,
      };
    }
    if (task.action === "prepare") {
      if (
        task.positions.length % 3 ||
        task.ranges.length > 8 ||
        (task.flags && task.flags.length !== task.positions.length / 3) ||
        (task.normals && task.normals.length !== task.positions.length) ||
        (task.offset !== undefined &&
          (!Number.isSafeInteger(task.offset) || task.offset < 0))
      )
        throw new Error("Invalid cached bounds source.");
      cache.set(task.key, {
        positions: task.positions,
        flags: task.flags,
        normals: task.normals,
        offset: task.offset ?? 0,
        ranges: task.ranges,
      });
      return { id: task.id, ready: true };
    }
    const source = cache.get(task.key);
    if (!source) throw new Error("Bounds source expired.");
    if (task.action === "normals") {
      if (task.normals.length !== source.positions.length)
        throw new Error("Cached mirror normals are misaligned.");
      source.normals = task.normals;
      return { id: task.id, ready: true };
    }
    if (task.action === "mirrorPrefix")
      return {
        id: task.id,
        firstBasePoint: firstInteractiveMirrorBasePoint(
          source.flags,
          source.positions.length / 3,
          source.offset ?? 0,
          task.stride,
          task.onlySelected,
        ),
      };
    if (task.action === "mirror") {
      if (!source.normals)
        throw new Error("Mirror point normals are unavailable.");
      source.flags ??= new Uint32Array(source.positions.length / 3);
      const points = nativeInteractiveMirrorPoints(
        { ...task.settings, normals: source.normals, flags: source.flags },
        {
          offset: source.offset ?? 0,
          initialBaseColor: task.initialBaseColor,
          sourceColors: task.includeColors,
          indicesOnly: !task.includeColors,
        },
      );
      return {
        id: task.id,
        points: {
          ...points,
          offset: source.offset ?? 0,
          count: source.positions.length / 3,
        },
      };
    }
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
      result.meshState || result.normals
        ? [
            ...(result.meshState
              ? [result.meshState.flags.buffer as ArrayBuffer]
              : []),
            ...(result.normals ? [result.normals.buffer as ArrayBuffer] : []),
          ]
        : result.points
          ? [
              result.points.indices.buffer as ArrayBuffer,
              result.points.colors.buffer as ArrayBuffer,
            ]
          : (result.lanes?.map((l) => l.values.buffer as ArrayBuffer) ?? []),
    );
  };
}

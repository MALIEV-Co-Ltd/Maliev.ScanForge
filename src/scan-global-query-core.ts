import {
  nativeGlobalQuery,
  prepareNativeGlobalQueryGeometry,
  type NativeGlobalQueryGeometry,
  type NativeGlobalQueryInput,
} from "./scan-native-global-query";
import {
  nativeGlobalMeshTargetData,
  installNativeGlobalMeshTarget,
  prepareNativeGlobalMeshTargets,
  type NativeGlobalMeshTargetData,
} from "./scan-native-global-mesh-target";
import {
  createNativeTargetStorageBudget,
  withNativeTargetStorageBudget,
} from "./scan-native-target-storage";
export type GlobalPreparedMeshes = {
  id: string;
  targets: NativeGlobalMeshTargetData[];
}[];
export interface GlobalQueryWorkerInit {
  scans: { id: string; geometry: NativeGlobalQueryGeometry }[];
  preparedMeshes?: GlobalPreparedMeshes;
  exportPreparedMeshes?: boolean;
  storageBudget?: { limit: number; reserved: number };
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
  | {
      id: number;
      ready: true;
      indexes: number;
      prepared?: GlobalQueryWorkerInit;
      storage?: { limit: number; reserved: number; live: number; peak: number };
    }
  | { id: number; result: ReturnType<typeof nativeGlobalQuery> }
  | { id: number; error: string };
export function createGlobalQueryWorkerState(input: GlobalQueryWorkerInit) {
  const budget =
    input.storageBudget &&
    createNativeTargetStorageBudget(
      input.storageBudget.limit,
      input.storageBudget.reserved,
    );
  const state = budget
    ? withNativeTargetStorageBudget(budget, () => prepareState(input))
    : prepareState(input);
  return { ...state, storage: budget?.snapshot() };
}
function prepareState(input: GlobalQueryWorkerInit) {
  const geometries = new Map<string, NativeGlobalQueryGeometry>();
  if (
    input.preparedMeshes &&
    (input.preparedMeshes.length !== input.scans.length ||
      input.preparedMeshes.some(
        (p, i) =>
          p.id !== input.scans[i].id ||
          p.targets.length !==
            (input.scans[i].geometry.targetMeshes?.length ?? 0),
      ))
  )
    throw Error("Prepared targets do not match worker scan IDs.");
  if (input.storageBudget) {
    if (
      input.scans.length > 32 ||
      input.scans.reduce(
        (count, scan) => count + (scan.geometry.targetMeshes?.length ?? 0),
        0,
      ) > 64
    )
      throw Error(
        "Bounded alignment supports at most 32 scans and 64 mesh targets.",
      );
    // This bounded route has no raw tree, hidden-face copies or object graph.
    for (const { geometry: g } of input.scans)
      if (
        !g.rawTargetIds ||
        g.rawTargetIds.length ||
        !g.targetMeshes?.length ||
        g.targetMeshes.some(
          (m) =>
            !m.packedNodes ||
            !m.compactBounds ||
            m.filterHidden ||
            m.vertices.length / 3 > 0x100000000 ||
            m.triangles.length > 0x7fffffff,
        )
      )
        throw Error(
          "Bounded alignment requires evaluator-only packed mesh targets.",
        );
    if (!input.preparedMeshes)
      prepareNativeGlobalMeshTargets(
        input.scans
          .flatMap((scan) => [...scan.geometry.targetMeshes!])
          .sort((a, b) => b.triangles.length - a.triangles.length),
      );
  }
  for (const [index, scan] of input.scans.entries()) {
    if (!scan.id || geometries.has(scan.id))
      throw new Error("Global worker scan IDs must be unique.");
    for (const [part, mesh] of (scan.geometry.targetMeshes ?? []).entries()) {
      const data = input.preparedMeshes?.[index].targets[part];
      if (data) installNativeGlobalMeshTarget(mesh, data);
    }
    prepareNativeGlobalQueryGeometry(scan.geometry);
    geometries.set(scan.id, scan.geometry);
  }
  return {
    indexes: geometries.size,
    prepared: input.exportPreparedMeshes
      ? {
          scans: input.scans,
          preparedMeshes: input.scans.map((scan) => ({
            id: scan.id,
            targets: (scan.geometry.targetMeshes ?? []).map(
              nativeGlobalMeshTargetData,
            ),
          })),
        }
      : undefined,
    execute(job: GlobalQueryJob) {
      if (
        input.storageBudget &&
        job.cells.reduce((sum, cell) => sum + cell.length, 0) > 16384
      )
        throw Error(
          "Bounded global alignment supports at most 16384 query samples per pose.",
        );
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

import type { Entity } from "./types";
import { cacheScanRenderData, scanRenderData } from "./scan-render-data";
import { executeRenderPreparation } from "./scan-render-preparation";
/** Runs inside the decoder worker, or the non-browser test/CLI path. */
export function prepareRestoredScanDisplays(
  entities: readonly Entity[],
  signal?: AbortSignal,
): Entity[] {
  return entities.map((entity) => {
    signal?.throwIfAborted();
    if (
      entity.kind === "mesh" &&
      !entity.kernelId &&
      entity.positions.length &&
      (!scanRenderData(entity.positions) ||
        scanRenderData(entity.positions)?.indexedMesh !== entity.indexedMesh)
    ) {
      const data = executeRenderPreparation(entity, signal);
      cacheScanRenderData(entity.positions, data);
      if (data.indexedMesh && data.indexedMesh !== entity.indexedMesh)
        return { ...entity, indexedMesh: data.indexedMesh };
    }
    return entity;
  });
}

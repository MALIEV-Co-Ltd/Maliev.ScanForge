import type { Entity } from "./types";
import { cacheScanRenderData, scanRenderData } from "./scan-render-data";
import { executeRenderPreparation } from "./scan-render-preparation";
/** Runs inside the decoder worker, or the non-browser test/CLI path. */
export function prepareRestoredScanDisplays(
  entities: readonly Entity[],
  signal?: AbortSignal,
) {
  for (const entity of entities) {
    signal?.throwIfAborted();
    if (
      entity.kind === "mesh" &&
      !entity.kernelId &&
      entity.positions.length &&
      !scanRenderData(entity.positions)
    )
      cacheScanRenderData(
        entity.positions,
        executeRenderPreparation({ positions: entity.positions }),
      );
  }
}

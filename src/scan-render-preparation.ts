import type { IndexedMesh, Positions } from "./types";
import { prepareStoredScanRenderData } from "./scan-render-data";
export interface RenderPreparationInput {
  positions: Positions;
  indexedMesh?: IndexedMesh;
}
/** The worker owns only clones and derived display buffers; authored data is immutable. */
export function executeRenderPreparation(
  input: RenderPreparationInput,
  signal?: AbortSignal,
) {
  return prepareStoredScanRenderData(
    input.positions,
    input.indexedMesh,
    signal,
  );
}

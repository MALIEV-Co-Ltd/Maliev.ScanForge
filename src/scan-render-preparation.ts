import type { Positions } from "./types";
import { prepareScanRenderData } from "./scan-render-data";
import { meshStats } from "./geometry";
export interface RenderPreparationInput {
  positions: Positions;
}
/** The worker owns only clones and derived display buffers; authored data is immutable. */
export function executeRenderPreparation(input: RenderPreparationInput) {
  const positions =
    input.positions instanceof Float32Array
      ? input.positions
      : Float32Array.from(input.positions);
  const result = prepareScanRenderData(positions);
  if (!(input.positions instanceof Float32Array))
    result.stats = meshStats(input.positions);
  return result;
}

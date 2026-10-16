import type { Positions } from "./types";
import type { TopologySummary } from "./processing-client";

// Only compact counts cross tool boundaries. Geometry identity and weld tolerance
// must both match; replaced arrays cannot inherit obsolete diagnostics.
const summaries = new WeakMap<
  Positions,
  { tolerance: number; topology: TopologySummary }
>();
export function cachedTopologySummary(positions: Positions, tolerance: number) {
  const entry = summaries.get(positions);
  return entry?.tolerance === tolerance ? entry.topology : undefined;
}
export function cacheTopologySummary(
  positions: Positions,
  tolerance: number,
  topology: TopologySummary,
) {
  summaries.set(positions, { tolerance, topology });
}

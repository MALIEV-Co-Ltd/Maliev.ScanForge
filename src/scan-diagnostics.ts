import type { Positions } from "./types";
import { SCAN_TOPOLOGY_TOLERANCE } from "./scan-topology-tolerance";
import {
  processMesh,
  type ProcessingOptions,
  type ProcessingRequest,
  type ProcessingResult,
  type TopologySummary,
} from "./processing-client";

export type ScanDiagnostics =
  | { phase: "pending"; progress: string }
  | { phase: "ready"; topology: TopologySummary }
  | { phase: "error"; message: string };
const cache = new WeakMap<Positions, TopologySummary>();

/** Geometry identity invalidates counts; cancellation releases the owned worker. */
export function observeScanDiagnostics(
  positions: Positions,
  update: (state: ScanDiagnostics) => void,
  run: (
    request: ProcessingRequest,
    options: ProcessingOptions,
  ) => Promise<ProcessingResult> = processMesh,
): () => void {
  const cached = cache.get(positions);
  if (cached) {
    update({ phase: "ready", topology: cached });
    return () => {};
  }
  const controller = new AbortController();
  update({ phase: "pending", progress: "Calculating mesh topology…" });
  void run(
    { kind: "report", positions, tolerance: SCAN_TOPOLOGY_TOLERANCE },
    {
      signal: controller.signal,
      reuseTopology: true,
      onProgress: (fraction, stage) => {
        if (!controller.signal.aborted)
          update({
            phase: "pending",
            progress: `${stage} · ${Math.round(fraction * 100)}%`,
          });
      },
    },
  )
    .then((result) => {
      if (controller.signal.aborted) return;
      if (!result.topology)
        throw new Error("Mesh diagnostics returned no topology.");
      cache.set(positions, result.topology);
      update({ phase: "ready", topology: result.topology });
    })
    .catch((error) => {
      if (!controller.signal.aborted)
        update({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
    });
  return () => controller.abort();
}

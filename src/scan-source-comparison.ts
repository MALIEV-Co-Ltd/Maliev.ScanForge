import {
  checkScanAbort,
  type ScanProcessingContext,
  type ScanComparisonManifest,
  type ScanDistanceBatch,
} from "./scan-geometry-source";
import type { ScanSampleDirectory } from "./scan-sample-directory";
import type { ScanSurfaceIndex } from "./scan-paged-surface-index";
import { writeComparisonPages } from "./scan-comparison-output";

export async function compareScanSources(
  samples: ScanSampleDirectory,
  index: ScanSurfaceIndex,
  tolerance: number,
  paletteThreshold: number,
  context: ScanProcessingContext,
): Promise<ScanComparisonManifest> {
  const threshold = Math.fround(paletteThreshold);
  if (!Number.isFinite(threshold) || threshold <= 0)
    throw new Error(
      "Comparison threshold must be a positive finite Float32 value.",
    );
  async function* distances(): AsyncGenerator<ScanDistanceBatch> {
    for await (const sample of samples.samples(context.signal)) {
      try {
        checkScanAbort(context.signal);
        const result = await index.queryBatch(
          sample.coordinates,
          threshold * 5,
          context.signal,
        );
        try {
          yield { firstSample: sample.firstSample, ...result };
        } finally {
          result.release();
        }
      } finally {
        sample.release();
      }
    }
  }
  return writeComparisonPages(
    samples,
    distances(),
    tolerance,
    paletteThreshold,
    context,
  );
}

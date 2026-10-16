import {
  checkScanAbort,
  type ScanComparisonManifest,
  type ScanDistanceBatch,
  type ScanProcessingContext,
  type ScanPageRef,
} from "./scan-geometry-source";
import { nativeNoiseColor } from "./scan-noise-color";
import {
  scanDirectoryEntries,
  scanDirectoryWriter,
} from "./scan-page-directory";
import type { ScanSampleDirectory } from "./scan-sample-directory";

/** The report counts unique representatives; color pages address authored corners. */
export async function writeComparisonPages(
  samples: ScanSampleDirectory,
  batches: AsyncIterable<ScanDistanceBatch>,
  tolerance: number,
  paletteThreshold: number,
  context: ScanProcessingContext,
): Promise<ScanComparisonManifest> {
  const { store, budget, signal } = context;
  checkScanAbort(signal);
  const reportTolerance = Math.fround(tolerance),
    threshold = Math.fround(paletteThreshold);
  if (
    ![reportTolerance, threshold].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error(
      "Comparison thresholds must be positive finite Float32 values.",
    );
  const distanceWriter = scanDirectoryWriter(store, budget, signal),
    vertexWriter = scanDirectoryWriter(store, budget, signal),
    colorWriter = scanDirectoryWriter(store, budget, signal);
  let total = 0,
    matched = 0,
    within = 0,
    minimum = Infinity,
    maximum = -Infinity,
    sumSquares = 0;
  try {
    for await (const batch of batches) {
      try {
        checkScanAbort(signal);
        if (
          batch.firstSample !== total ||
          !batch.distances.length ||
          batch.distances.length !== batch.triangleIds.length ||
          batch.distances.length > samples.sampleCount - total
        )
          throw new Error(
            "Comparison samples must arrive in complete source order.",
          );
        const scratch = await budget.reserve(
          "comparison colors",
          batch.distances.length * 3,
          signal,
        );
        try {
          const colors = new Uint8Array(batch.distances.length * 3);
          for (let index = 0; index < batch.distances.length; index++) {
            checkScanAbort(signal);
            const distance = batch.distances[index],
              triangle = batch.triangleIds[index];
            if (Number.isNaN(distance) && triangle === -1) {
              colors.fill(50, index * 3, index * 3 + 3);
              continue;
            }
            if (
              !Number.isFinite(distance) ||
              !Number.isSafeInteger(triangle) ||
              triangle < 0
            )
              throw new Error(
                "Invalid comparison distance or source triangle ID.",
              );
            matched++;
            minimum = Math.min(minimum, distance);
            maximum = Math.max(maximum, distance);
            sumSquares += distance * distance;
            if (Math.abs(distance) <= reportTolerance) within++;
            colors.set(nativeNoiseColor(distance, threshold), index * 3);
          }
          const distancePage = await store.append(
            new Uint8Array(
              batch.distances.buffer,
              batch.distances.byteOffset,
              batch.distances.byteLength,
            ),
            signal,
          );
          await distanceWriter.append({
            first: total,
            count: batch.distances.length,
            page: distancePage,
          });
          const colorPage = await store.append(colors, signal);
          await vertexWriter.append({
            first: total,
            count: batch.distances.length,
            page: colorPage,
          });
          total += batch.distances.length;
          context.progress({
            phase: "Comparing source samples",
            processed: total,
            total: samples.sampleCount,
            mode: "resident",
            budget: budget.snapshot(),
          });
        } finally {
          scratch.release();
        }
      } finally {
        batch.release();
      }
    }
    if (total !== samples.sampleCount)
      throw new Error("Comparison stream is missing source samples.");
    const distances = await distanceWriter.finish(),
      vertexColors = await vertexWriter.finish();
    const step = Math.max(
      1,
      Math.min(4096, Math.floor(budget.snapshot().capacityBytes / 64 / 33)),
    );
    let cached:
      | {
          ref: ScanPageRef;
          first: number;
          count: number;
          bytes: Uint8Array;
          release(): void;
        }
      | undefined;
    try {
      for (let first = 0; first < samples.triangleCount; first += step) {
        const count = Math.min(step, samples.triangleCount - first);
        const mapping = await samples.corners(first, count, signal);
        try {
          const colorLease = await budget.reserve(
            "corner colors",
            count * 9,
            signal,
          );
          try {
            const colors = new Uint8Array(count * 9);
            for (let corner = 0; corner < mapping.sampleIds.length; corner++) {
              checkScanAbort(signal);
              const id = mapping.sampleIds[corner];
              if (
                !Number.isSafeInteger(id) ||
                id < 0 ||
                id >= samples.sampleCount
              )
                throw new Error("Invalid source corner mapping.");
              if (
                !cached ||
                id < cached.first ||
                id >= cached.first + cached.count
              ) {
                cached?.release();
                cached = undefined;
                for await (const entry of scanDirectoryEntries(
                  vertexColors,
                  store,
                  budget,
                  signal,
                  id,
                  id + 1,
                )) {
                  const page = await store.read(entry.page, signal);
                  cached = {
                    ref: entry.page,
                    first: entry.first,
                    count: entry.count,
                    ...page,
                  };
                  break;
                }
                if (!cached)
                  throw new Error("Source sample color page missing.");
              }
              colors.set(
                cached.bytes.subarray(
                  (id - cached.first) * 3,
                  (id - cached.first) * 3 + 3,
                ),
                corner * 3,
              );
            }
            const page = await store.append(colors, signal);
            await colorWriter.append({ first, count, page });
          } finally {
            colorLease.release();
          }
        } finally {
          mapping.release();
        }
      }
    } finally {
      cached?.release();
    }
    return {
      distances,
      colors: await colorWriter.finish(),
      statistics: {
        minimum: matched ? minimum : null,
        maximum: matched ? maximum : null,
        rms: matched ? Math.sqrt(sumSquares / matched) : null,
        percentage: total ? (within * 100) / total : 0,
        total,
        matched,
        within,
        unmatched: total - matched,
        tolerance: reportTolerance,
      },
    };
  } finally {
    distanceWriter.dispose();
    vertexWriter.dispose();
    colorWriter.dispose();
  }
}

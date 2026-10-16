import type { MeshProcessingOptions } from "./mesh-processing";
import type { Positions } from "./types";
import type { ReductionStatistics } from "./reduction-report";
import { reductionDisplayColor } from "./reduction-display";
import { ShrinkwrapSurface } from "./scan-shrinkwrap-surface";

/** Borrow original facet corners directly. No source welding, adjacency or unique-sample table. */
export function compareShrinkwrapSurface(
  source: Positions,
  output: Float32Array,
  tolerance: number,
  paletteThreshold = tolerance,
  options: MeshProcessingOptions = {},
  displayRange?: number,
) {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh comparison cancelled.", "AbortError");
  };
  check();
  if (
    ![
      tolerance,
      paletteThreshold,
      ...(displayRange === undefined ? [] : [displayRange]),
    ].every((value) => Number.isFinite(value) && value > 0)
  )
    throw Error(
      "Comparison thresholds and display range must be positive and finite.",
    );
  for (const coordinates of [source, output]) {
    if (!coordinates.length || coordinates.length % 9)
      throw Error(
        "ShrinkWrap comparison requires complete source and output triangles.",
      );
    for (let i = 0; i < coordinates.length; i++) {
      if ((i & 8191) === 0) check();
      if (!Number.isFinite(coordinates[i]))
        throw Error("ShrinkWrap comparison coordinates must be finite.");
    }
  }
  options.onProgress?.(0, "Indexing wrapped surface for comparison");
  const surface = new ShrinkwrapSurface(output, options);
  try {
    const total = source.length / 3;
    const rgb = new Uint8Array(source.length);
    const sampleDistances =
      displayRange === undefined ? undefined : new Float64Array(total);
    let minimum = Infinity,
      maximum = -Infinity,
      squared = 0,
      matched = 0,
      within = 0;
    const point = [0, 0, 0];
    for (let corner = 0; corner < total; corner++) {
      if ((corner & 4095) === 0) {
        check();
        options.onProgress?.(
          0.2 + (0.8 * corner) / total,
          "Comparing original triangle corners to wrapped surface",
        );
      }
      const offset = corner * 3;
      point[0] = source[offset];
      point[1] = source[offset + 1];
      point[2] = source[offset + 2];
      // Unlimited nearest search reports distant samples rather than silently excluding them.
      const distance = surface.nearest(point)?.distance ?? Infinity;
      if (sampleDistances) sampleDistances[corner] = distance;
      if (Number.isFinite(distance)) {
        matched++;
        minimum = Math.min(minimum, distance);
        maximum = Math.max(maximum, distance);
        squared += distance * distance;
        if (distance <= tolerance) within++;
      }
      rgb.set(
        reductionDisplayColor(distance, displayRange ?? paletteThreshold),
        offset,
      );
    }
    check();
    options.onProgress?.(1, "Unsigned ShrinkWrap source comparison complete");
    check();
    const statistics: ReductionStatistics = {
      minimum: matched ? minimum : null,
      maximum: matched ? maximum : null,
      rms: matched ? Math.sqrt(squared / matched) : null,
      percentage: (100 * within) / total,
      total,
      matched,
      within,
      unmatched: total - matched,
      tolerance,
      originalTriangles: source.length / 9,
      reducedTriangles: output.length / 9,
    };
    return {
      noiseComparison: {
        rgb,
        threshold: paletteThreshold,
        statistics,
        sampleDistances,
        renderDistances: sampleDistances
          ? Float32Array.from(sampleDistances)
          : undefined,
        displayRange,
      },
      summary: `Unsigned original-corner-to-wrapped-surface comparison: ${statistics.percentage.toFixed(2)}% (${within}/${total}) within ${tolerance} mm; ${total - matched} unmatched. All triangle corners sampled, including repeated vertices; sampled distances are not certified bounds.`,
    };
  } finally {
    surface.dispose();
  }
}

import { compareShrinkwrapSurface } from "./scan-shrinkwrap-comparison";
import {
  analyzeMesh,
  type MeshProcessingOptions,
  type MeshTopology,
} from "./mesh-processing";
import type { Positions } from "./types";
import { runScanTool, type ScanToolOperation } from "./scan-tools";
import { reduceScanNoiseAsync } from "./scan-tools-reduction";
import { prepareNoiseOctree, type PackedNoiseTree } from "./scan-noise-octree";
import { comparePreparedNoiseSurface } from "./scan-noise-deviation";
import { comparePreparedReductionSurface } from "./scan-reduction-comparison";
import { nativeNoiseColor } from "./scan-noise-color";
import { linearProgress, type ReductionStatistics } from "./reduction-report";
import { reductionDisplayColor } from "./reduction-display";

export type ScanPreviewRequest = {
  kind: "scanPreview";
  positions: Positions;
  previewId: string;
} & (
  | { phase: "create"; operation: ScanToolOperation }
  | { phase: "release" }
  | {
      phase: "compare";
      deviation: number;
      paletteThreshold?: number;
      displayRange?: number;
    }
);

/** An immutable original and one disposable preview; comparison never runs an edit. */
export class ScanPreviewSession {
  private prepared?: PackedNoiseTree;
  private constructor(
    readonly id: string,
    readonly kind:
      | "reduceNoise"
      | "reducePolygons"
      | "scaleMesh"
      | "mirrorMesh"
      | "shrinkwrap",
    readonly original: MeshTopology | undefined,
    readonly output: Float32Array,
    readonly summary: string,
    readonly diagnostics?: Record<string, unknown>,
    readonly topology?: import("./processing-client").TopologySummary,
    private readonly sourcePositions?: Positions,
  ) {}
  static async create(
    request: Extract<ScanPreviewRequest, { phase: "create" }>,
    options: MeshProcessingOptions = {},
  ) {
    const operation = request.operation;
    const progress = linearProgress(options.onProgress);
    if (
      operation.kind !== "reduceNoise" &&
      operation.kind !== "reducePolygons" &&
      operation.kind !== "scaleMesh" &&
      operation.kind !== "mirrorMesh" &&
      operation.kind !== "shrinkwrap"
    )
      throw new Error("This tool does not support mesh preview.");
    // Transforms read the original coordinates directly and need no welding or
    // adjacency. Only the two comparison tools retain indexed source topology.
    const original =
      operation.kind === "scaleMesh" ||
      operation.kind === "mirrorMesh" ||
      operation.kind === "shrinkwrap"
        ? undefined
        : analyzeMesh(request.positions, {
            ...options,
            tolerance: 1e-6,
            onProgress: progress(0, 0.2),
          });
    // Edit successor adoption must not replace the original's retained topology.
    const editOptions = {
      ...options,
      topologyCache: { ...options.topologyCache },
      onProgress: progress(original ? 0.2 : 0, 1),
    };
    const outcome =
      operation.kind === "reduceNoise"
        ? await reduceScanNoiseAsync(request.positions, {
            ...operation,
            measureDeviation: false,
            ...editOptions,
          })
        : runScanTool(
            {
              kind: "scanTools",
              positions: request.positions,
              operation:
                operation.kind === "scaleMesh" ||
                operation.kind === "mirrorMesh" ||
                operation.kind === "shrinkwrap"
                  ? operation
                  : { ...operation, measureDeviation: false },
            },
            editOptions,
          );
    return new ScanPreviewSession(
      request.previewId,
      operation.kind,
      original,
      outcome.positions,
      outcome.summary,
      outcome.diagnostics,
      outcome.topology,
      operation.kind === "shrinkwrap" ? request.positions : undefined,
    );
  }
  compare(
    deviation: number,
    paletteThreshold = deviation,
    options: MeshProcessingOptions = {},
    displayRange?: number,
  ) {
    if (this.kind === "shrinkwrap")
      return compareShrinkwrapSurface(
        this.sourcePositions!,
        this.output,
        deviation,
        paletteThreshold,
        options,
        displayRange,
      );
    if (
      displayRange !== undefined &&
      (!Number.isFinite(displayRange) || displayRange <= 0)
    )
      throw new Error("Display range must be positive and finite.");
    if (!this.original)
      throw new Error(
        `${this.kind === "mirrorMesh" ? "Mirror" : "Scale"} preview does not support surface comparison.`,
      );
    if (
      ![deviation, paletteThreshold].every(
        (value) =>
          Number.isFinite(Math.fround(value)) && Math.fround(value) > 0,
      )
    )
      throw new Error("Comparison thresholds must be positive finite values.");
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const progress = linearProgress(options.onProgress);
    progress(0, 0.25)(0, "Indexing reduced surface for comparison");
    if (!this.prepared) {
      // Packed preview facets already preserve source corner order. No weld or adjacency rebuild.
      this.prepared = prepareNoiseOctree(
        {
          coordinates: this.output,
          indices: Uint32Array.from(
            { length: this.output.length / 3 },
            (_, id) => id,
          ),
        },
        0.5,
        10,
        { ...options, onProgress: progress(0, 0.25) },
      );
    }
    let rgb: Uint8Array;
    let statistics: ReductionStatistics | undefined;
    let sampleDistances: Float64Array | undefined;
    let within: number, total: number, matched: number;
    if (this.kind === "reduceNoise") {
      const measured = comparePreparedNoiseSurface(
        this.original,
        this.prepared,
        deviation,
        { ...options, onProgress: progress(0.25, 0.95) },
      );
      within = measured.within;
      total = measured.total;
      matched = measured.matched;
      rgb = new Uint8Array(this.original.triangles.length * 3);
      const colors = new Uint8Array(this.original.vertices.length);
      for (let id = 0; id < measured.distances.length; id++)
        colors.set(nativeNoiseColor(measured.distances[id], deviation), id * 3);
      this.original.triangles.forEach((id, corner) =>
        rgb.set(colors.subarray(id * 3, id * 3 + 3), corner * 3),
      );
    } else {
      const measured = comparePreparedReductionSurface(
        this.original.vertices,
        this.prepared,
        deviation,
        paletteThreshold,
        { ...options, onProgress: progress(0.25, 0.95) },
      );
      statistics = {
        ...measured.statistics,
        originalTriangles: this.original.triangles.length / 3,
        reducedTriangles: this.output.length / 9,
      };
      if (displayRange !== undefined) sampleDistances = measured.distances;
      within = measured.within;
      total = measured.total;
      matched = measured.matched;
      rgb = new Uint8Array(this.original.triangles.length * 3);
      this.original.triangles.forEach((id, corner) => {
        if (corner % 4096 === 0) {
          if (options.signal?.aborted)
            throw new DOMException("Mesh operation cancelled.", "AbortError");
          progress(0.95, 1)(
            corner / this.original!.triangles.length,
            "Preparing deviation display",
          );
        }
        rgb.set(
          displayRange === undefined
            ? measured.rgb.subarray(id * 3, id * 3 + 3)
            : reductionDisplayColor(measured.distances[id], displayRange),
          corner * 3,
        );
      });
    }
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    progress(1, 1)(1, "Surface comparison complete");
    return {
      noiseComparison: {
        rgb,
        renderDistances: sampleDistances
          ? Float32Array.from(
              this.original!.triangles,
              (id) => sampleDistances![id],
            )
          : undefined,
        statistics,
        sampleDistances,
        displayRange,
        threshold:
          this.kind === "reduceNoise"
            ? deviation
            : Math.fround(paletteThreshold),
      },
      summary: `Original-to-surface comparison: ${((100 * within) / total).toFixed(2)}% (${within}/${total}) within ${Number(deviation.toPrecision(6))} mm; ${total - matched} unmatched.`,
    };
  }
}

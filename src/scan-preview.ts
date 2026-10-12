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

export type ScanPreviewRequest = {
  kind: "scanPreview";
  positions: Positions;
  previewId: string;
} & (
  | { phase: "create"; operation: ScanToolOperation }
  | { phase: "compare"; deviation: number; paletteThreshold?: number }
);

/** An immutable original and one disposable preview; comparison never runs an edit. */
export class ScanPreviewSession {
  private prepared?: PackedNoiseTree;
  private constructor(
    readonly id: string,
    readonly kind: "reduceNoise" | "reducePolygons" | "scaleMesh",
    readonly original: MeshTopology | undefined,
    readonly output: Float32Array,
    readonly summary: string,
  ) {}
  static async create(
    request: Extract<ScanPreviewRequest, { phase: "create" }>,
    options: MeshProcessingOptions = {},
  ) {
    const operation = request.operation;
    if (
      operation.kind !== "reduceNoise" &&
      operation.kind !== "reducePolygons" &&
      operation.kind !== "scaleMesh"
    )
      throw new Error("This tool does not support mesh preview.");
    // Scaling reads the original coordinates directly and needs no welding or
    // adjacency. Only the two comparison tools retain indexed source topology.
    const original =
      operation.kind === "scaleMesh"
        ? undefined
        : analyzeMesh(request.positions, {
            ...options,
            tolerance: 1e-6,
          });
    // Edit successor adoption must not replace the original's retained topology.
    const editOptions = {
      ...options,
      topologyCache: { ...options.topologyCache },
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
                operation.kind === "scaleMesh"
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
    );
  }
  compare(
    deviation: number,
    paletteThreshold = deviation,
    options: MeshProcessingOptions = {},
  ) {
    if (!this.original)
      throw new Error("Scale preview does not support surface comparison.");
    if (
      ![deviation, paletteThreshold].every(
        (value) =>
          Number.isFinite(Math.fround(value)) && Math.fround(value) > 0,
      )
    )
      throw new Error("Comparison thresholds must be positive finite values.");
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
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
        options,
      );
    }
    let rgb: Uint8Array;
    let within: number, total: number, matched: number;
    if (this.kind === "reduceNoise") {
      const measured = comparePreparedNoiseSurface(
        this.original,
        this.prepared,
        deviation,
        options,
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
        options,
      );
      within = measured.within;
      total = measured.total;
      matched = measured.matched;
      rgb = new Uint8Array(this.original.triangles.length * 3);
      this.original.triangles.forEach((id, corner) =>
        rgb.set(measured.rgb.subarray(id * 3, id * 3 + 3), corner * 3),
      );
    }
    return {
      noiseComparison: {
        rgb,
        threshold:
          this.kind === "reduceNoise"
            ? deviation
            : Math.fround(paletteThreshold),
      },
      summary: `Original-to-surface comparison: ${((100 * within) / total).toFixed(2)}% (${within}/${total}) within ${Number(deviation.toPrecision(6))} mm; ${total - matched} unmatched.`,
    };
  }
}

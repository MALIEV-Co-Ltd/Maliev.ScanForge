import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";
import { smoothSelectedVertices } from "./scan-selected-smooth";
import {
  smoothingRings,
  smoothingSelection,
  type SmoothingRings,
} from "./scan-smoothing-kernel";
import type { SmoothingWorkerResponse } from "./scan-smoothing-worker";

export function smoothingWorkerCount(
  vertices: number,
  movable: number,
  triangles: number,
  ringEntries: number,
): number {
  const hardware = globalThis.navigator?.hardwareConcurrency ?? 2;
  const memory = (
    globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined
  )?.deviceMemory;
  const bytes =
    2 * (triangles * 12 + vertices * 33 + ringEntries * 4) +
    vertices * 57 +
    ringEntries * 4 +
    movable * 60;
  return typeof Worker !== "undefined" &&
    movable >= 300_000 &&
    hardware >= 4 &&
    (memory === undefined || memory >= 8) &&
    bytes <= 128 * 1024 * 1024
    ? 2
    : 1;
}
function aborted() {
  return new DOMException("Mesh operation cancelled.", "AbortError");
}
function validate(
  topology: MeshTopology,
  selection: Uint8Array,
  iterations: number,
  strength: number,
) {
  if (
    selection.length !== topology.triangles.length / 3 ||
    selection.some((v) => v !== 0 && v !== 1) ||
    !selection.some(Boolean)
  )
    throw new Error("Select triangles with a matching binary mask to smooth.");
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > 100 ||
    !Number.isFinite(strength) ||
    strength <= 0 ||
    strength > 1
  )
    throw new Error("Smoothing needs strength in (0,1] and 1–100 iterations.");
}
/** Two bounded workers calculate disjoint targets; publication waits for the complete iteration. */
export class SelectedSmoothingPool {
  private workers: Worker[] = [];
  private triangles?: Uint32Array;
  private rings?: SmoothingRings;
  private shards: Uint32Array[] = [];
  private pending?: {
    iteration: number;
    resolve: (targets: Float64Array[]) => void;
    reject: (error: Error) => void;
    targets: (Float64Array | undefined)[];
  };
  private lease?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private iteration = 0;
  private disposed = false;
  private active = false;
  async smooth(
    topology: MeshTopology,
    selection: Uint8Array,
    iterations: number,
    strength: number,
    options: MeshProcessingOptions = {},
  ): Promise<Float64Array<ArrayBuffer>> {
    if (this.disposed) throw new Error("Smoothing pool is closed.");
    validate(topology, selection, iterations, strength);
    if (options.signal?.aborted) throw aborted();
    if (this.active) this.cancel();
    const generation = ++this.generation;
    const rings = smoothingRings(topology),
      movable = smoothingSelection(topology.triangles, selection);
    if (
      smoothingWorkerCount(
        topology.vertices.length / 3,
        movable.length,
        topology.triangles.length / 3,
        rings.neighbors.length,
      ) === 1
    ) {
      this.stop();
      return smoothSelectedVertices(
        topology,
        selection,
        iterations,
        strength,
        options,
      );
    }
    this.active = true;
    clearTimeout(this.lease);
    const abort = () => this.cancel();
    options.signal?.addEventListener("abort", abort, { once: true });
    let lastProgress = 0;
    try {
      this.prepare(topology.triangles, rings, movable);
      this.expiry = setTimeout(() => this.cancel(), 120_000);
      const vertices = Float64Array.from(topology.vertices, Math.fround);
      for (let step = 0; step < iterations; step++) {
        if (generation !== this.generation || options.signal?.aborted)
          throw aborted();
        lastProgress = step / iterations;
        options.onProgress?.(
          lastProgress,
          "Smoothing selected vertices on two CPU workers",
        );
        if (generation !== this.generation || options.signal?.aborted)
          throw aborted();
        const targets = await this.calculate(vertices, strength);
        if (generation !== this.generation || options.signal?.aborted)
          throw aborted();
        // Both workers have finished reading their cloned input. Publish into
        // our owned scratch only now; the canonical source remains immutable.
        // Avoid a full vertex copy and a combined target allocation per step.
        let index = 0;
        for (const part of targets) {
          for (let offset = 0; offset < part.length; offset += 3) {
            const destination = movable[index++] * 3;
            vertices[destination] = part[offset];
            vertices[destination + 1] = part[offset + 1];
            vertices[destination + 2] = part[offset + 2];
          }
        }
      }
      return vertices;
    } catch (error) {
      if (
        generation !== this.generation ||
        options.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      )
        throw aborted();
      this.stop();
      // Worker creation/transport failure leaves input immutable; repeat with the same kernel.
      return smoothSelectedVertices(topology, selection, iterations, strength, {
        ...options,
        onProgress: (fraction, stage) =>
          options.onProgress?.(Math.max(lastProgress, fraction), stage),
      });
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (generation === this.generation) {
        this.active = false;
        clearTimeout(this.expiry);
        if (this.workers.length)
          this.lease = setTimeout(() => this.stop(), 30_000);
      }
    }
  }
  private prepare(
    triangles: Uint32Array,
    rings: SmoothingRings,
    movable: Uint32Array,
  ) {
    if (this.triangles !== triangles || this.rings !== rings) this.stop();
    this.shards = [
      movable.slice(0, Math.floor(movable.length / 2)),
      movable.slice(Math.floor(movable.length / 2)),
    ];
    if (!this.workers.length) {
      this.triangles = triangles;
      this.rings = rings;
      for (let part = 0; part < 2; part++) {
        const worker = new Worker(
          new URL("./scan-smoothing-worker.ts", import.meta.url),
          { type: "module" },
        );
        this.workers.push(worker);
        worker.onmessage = ({
          data,
        }: MessageEvent<SmoothingWorkerResponse>) => {
          if (!this.workers.includes(worker) || !this.pending) return;
          if ("error" in data) {
            this.pending.reject(new Error(data.error));
            this.pending = undefined;
            return;
          }
          if (
            data.iteration !== this.pending.iteration ||
            this.pending.targets[part]
          )
            return;
          if (
            !(data.targets instanceof Float64Array) ||
            data.targets.length !== this.shards[part].length * 3
          ) {
            this.pending.reject(new Error("Invalid smoothing target range."));
            this.pending = undefined;
            return;
          }
          this.pending.targets[part] = data.targets;
          if (this.pending.targets.every(Boolean)) {
            const pending = this.pending;
            this.pending = undefined;
            pending.resolve(pending.targets as Float64Array[]);
          }
        };
        worker.onerror = (event) => {
          this.pending?.reject(
            new Error(event.message || "Smoothing worker failed."),
          );
          this.pending = undefined;
        };
        worker.onmessageerror = () => {
          this.pending?.reject(
            new Error("Smoothing result could not be decoded."),
          );
          this.pending = undefined;
        };
        worker.postMessage({
          initialize: { triangles, rings, movable: this.shards[part] },
        });
      }
    } else
      this.workers.forEach((worker, part) =>
        worker.postMessage({ selection: this.shards[part] }),
      );
  }
  private calculate(
    vertices: Float64Array,
    strength: number,
  ): Promise<Float64Array[]> {
    return new Promise((resolve, reject) => {
      const iteration = ++this.iteration;
      this.pending = {
        iteration,
        resolve,
        reject,
        targets: [undefined, undefined],
      };
      try {
        this.workers.forEach((worker) =>
          worker.postMessage({ iteration, vertices, strength }),
        );
      } catch (error) {
        this.pending = undefined;
        reject(error);
      }
    });
  }
  cancel() {
    ++this.generation;
    this.pending?.reject(aborted());
    this.pending = undefined;
    this.active = false;
    this.stop();
  }
  private stop() {
    clearTimeout(this.lease);
    clearTimeout(this.expiry);
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.triangles = undefined;
    this.rings = undefined;
    this.shards = [];
  }
  dispose() {
    this.disposed = true;
    this.cancel();
  }
}

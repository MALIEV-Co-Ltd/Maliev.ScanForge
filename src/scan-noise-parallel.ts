import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";
import { nativeNoiseVertices, noiseWeights } from "./scan-native-noise";
import type {
  NoiseRings,
  NoiseWorkerResponse,
  NoiseWorkerRequest,
} from "./scan-noise-worker";

const cached = new WeakMap<
  Uint32Array,
  { edges: MeshTopology["edges"]; rings: NoiseRings }
>();
export function noiseRings(topology: MeshTopology): NoiseRings {
  const previous = cached.get(topology.triangles);
  if (previous?.edges === topology.edges) return previous.rings;
  const count = topology.vertices.length / 3;
  const offsets = new Uint32Array(count + 1);
  const boundary = new Uint8Array(count);
  const duplicated = new Uint8Array(topology.triangles.length);
  const triangles = topology.triangles;
  for (let i = 0; i < triangles.length; i += 3)
    for (let corner = 0; corner < 3; corner++) {
      const u = triangles[i + corner],
        v = triangles[i + ((corner + 1) % 3)];
      const edge = topology.edges.get(u < v ? `${u}:${v}` : `${v}:${u}`);
      const repeats = edge?.length === 1 ? 2 : 1;
      duplicated[i + corner] = repeats;
      if (repeats === 2) boundary[u] = boundary[v] = 1;
      offsets[u + 1] += repeats;
      offsets[v + 1] += repeats;
    }
  for (let i = 1; i < offsets.length; i++) offsets[i] += offsets[i - 1];
  const cursor = offsets.slice();
  const neighbors = new Uint32Array(offsets[count]);
  for (let i = 0; i < triangles.length; i += 3)
    for (let corner = 0; corner < 3; corner++) {
      const u = triangles[i + corner],
        v = triangles[i + ((corner + 1) % 3)];
      for (let repeat = 0; repeat < duplicated[i + corner]; repeat++) {
        neighbors[cursor[u]++] = v;
        neighbors[cursor[v]++] = u;
      }
    }
  const rings = { offsets, neighbors, boundary };
  cached.set(triangles, { edges: topology.edges, rings });
  return rings;
}
export function noiseWorkerCount(
  vertices: number,
  ringEntries: number,
): number {
  const hardware = globalThis.navigator?.hardwareConcurrency ?? 2;
  const memory = (
    globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined
  )?.deviceMemory;
  // Include both workers' coordinates/means/weights, transferred shard results,
  // parent combination scratch, and cached ring copies at the phase barrier.
  const bytes = vertices * 300 + ringEntries * 12;
  return typeof Worker !== "undefined" &&
    vertices >= 300_000 &&
    hardware >= 4 &&
    (memory === undefined || memory >= 8) &&
    bytes <= 128 * 1024 * 1024
    ? 2
    : 1;
}
const aborted = () =>
  new DOMException("Mesh operation cancelled.", "AbortError");

/** Two barriers per iteration; workers never publish or observe partially updated coordinates. */
export class NoiseSmoothingPool {
  private workers: Worker[] = [];
  private rings?: NoiseRings;
  private pending?: {
    id: number;
    values: (Float64Array | undefined)[];
    resolve: (v: Float64Array<ArrayBuffer>) => void;
    reject: (e: Error) => void;
  };
  private id = 0;
  private generation = 0;
  private active = false;
  private disposed = false;
  private idle?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  async smooth(
    topology: MeshTopology,
    iterations = 1,
    selection?: Uint8Array,
    applyBoundaryEdges = true,
    options: MeshProcessingOptions = {},
  ): Promise<Float64Array<ArrayBuffer>> {
    if (this.disposed) throw new Error("Noise smoothing pool is closed.");
    if (!Number.isSafeInteger(iterations) || iterations < 1)
      throw new Error("Smooth iterations must be a positive integer.");
    if (selection && selection.length !== topology.triangles.length / 3)
      throw new Error("Selection does not match the mesh triangle count.");
    if (options.signal?.aborted) throw aborted();
    if (this.active) this.cancel();
    const generation = ++this.generation;
    const count = topology.vertices.length / 3;
    // Every directed facet edge contributes to both ends, at most twice.
    // Admit before packing so small serial edits pay no ring setup cost.
    const ringBound = Number.isSafeInteger(topology.boundaryEdges)
      ? topology.triangles.length * 2 + topology.boundaryEdges * 2
      : topology.triangles.length * 4;
    if (noiseWorkerCount(count, ringBound) === 1) {
      this.stop();
      return nativeNoiseVertices(
        topology,
        iterations,
        selection,
        applyBoundaryEdges,
        options,
      );
    }
    const rings = noiseRings(topology);
    this.active = true;
    clearTimeout(this.idle);
    const abort = () => this.cancel();
    options.signal?.addEventListener("abort", abort, { once: true });
    let progress = 0;
    const check = () => {
      if (generation !== this.generation || options.signal?.aborted)
        throw aborted();
    };
    try {
      options.onProgress?.(0, "Preparing noise weights");
      check();
      const weights = noiseWeights(topology, options);
      const movable = new Uint8Array(count);
      for (let corner = 0; corner < topology.triangles.length; corner++)
        if (!selection || selection[Math.floor(corner / 3)])
          movable[topology.triangles[corner]] = 1;
      this.prepare(rings, count);
      this.expiry = setTimeout(() => this.cancel(), 120_000);
      let vertices = Float64Array.from(topology.vertices, Math.fround);
      for (let step = 0; step < iterations; step++) {
        check();
        progress = step / iterations;
        options.onProgress?.(
          progress,
          "Reducing mesh noise on two CPU workers",
        );
        check();
        const means = await this.calculate({ vertices });
        check();
        const next = await this.calculate({
          vertices,
          means,
          weights,
          movable,
          applyBoundaryEdges,
        });
        check();
        vertices = next;
      }
      options.onProgress?.(1, "Noise reduction completed");
      check();
      return vertices;
    } catch (error) {
      check();
      if (error instanceof Error && error.name === "AbortError") throw error;
      this.stop();
      return nativeNoiseVertices(
        topology,
        iterations,
        selection,
        applyBoundaryEdges,
        {
          ...options,
          onProgress: (fraction, stage) =>
            options.onProgress?.(Math.max(progress, fraction), stage),
        },
      );
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (generation === this.generation) {
        this.active = false;
        clearTimeout(this.expiry);
        if (this.workers.length)
          this.idle = setTimeout(() => this.stop(), 30_000);
      }
    }
  }
  private prepare(rings: NoiseRings, count: number) {
    if (this.rings !== rings) this.stop();
    if (this.workers.length) return;
    this.rings = rings;
    for (let part = 0; part < 2; part++) {
      const worker = new Worker(
        new URL("./scan-noise-worker.ts", import.meta.url),
        { type: "module" },
      );
      this.workers.push(worker);
      worker.onmessage = ({ data }: MessageEvent<NoiseWorkerResponse>) => {
        const pending = this.pending;
        if (
          !this.workers.includes(worker) ||
          !pending ||
          data.id !== pending.id ||
          pending.values[part]
        )
          return;
        if ("error" in data) {
          this.pending = undefined;
          pending.reject(new Error(data.error));
          return;
        }
        const begin = part ? Math.floor(count / 2) : 0;
        const end = part ? count : Math.floor(count / 2);
        if (
          !(data.values instanceof Float64Array) ||
          data.values.length !== (end - begin) * 3
        ) {
          this.pending = undefined;
          pending.reject(new Error("Invalid noise vertex range."));
          return;
        }
        pending.values[part] = data.values;
        if (pending.values.every(Boolean)) {
          this.pending = undefined;
          const combined = new Float64Array(count * 3);
          combined.set(pending.values[0]!);
          combined.set(pending.values[1]!, Math.floor(count / 2) * 3);
          pending.resolve(combined);
        }
      };
      const failed = (message: string) => {
        this.pending?.reject(new Error(message));
        this.pending = undefined;
      };
      worker.onerror = (event) =>
        failed(event.message || "Noise worker failed.");
      worker.onmessageerror = () =>
        failed("Noise result could not be decoded.");
      worker.postMessage({
        initialize: {
          rings,
          begin: part ? Math.floor(count / 2) : 0,
          end: part ? count : Math.floor(count / 2),
        },
      });
    }
  }
  private calculate(
    job: Omit<NonNullable<NoiseWorkerRequest["job"]>, "id">,
  ): Promise<Float64Array<ArrayBuffer>> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending = { id, values: [undefined, undefined], resolve, reject };
      try {
        for (const worker of this.workers)
          worker.postMessage({ job: { ...job, id } });
      } catch (error) {
        this.pending = undefined;
        reject(error instanceof Error ? error : new Error(String(error)));
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
    clearTimeout(this.idle);
    clearTimeout(this.expiry);
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.rings = undefined;
  }
  dispose() {
    this.cancel();
    this.disposed = true;
  }
}
const pool = new NoiseSmoothingPool();
export function nativeNoiseVerticesAsync(
  topology: MeshTopology,
  iterations = 1,
  selection?: Uint8Array,
  applyBoundaryEdges = true,
  options: MeshProcessingOptions = {},
) {
  return pool.smooth(
    topology,
    iterations,
    selection,
    applyBoundaryEdges,
    options,
  );
}

import {
  nativeInteractiveMirrorPoints,
  firstInteractiveMirrorBasePoint,
} from "./interactive-mirror-selection";
import {
  interactiveBoundsRanges,
  interactiveBoundsLane,
  reduceInteractiveBounds,
} from "./interactive-bounds-kernel";
import type {
  BoundsTask,
  BoundsTaskResult,
  InteractiveMirrorSettings,
} from "./interactive-bounds-worker";
export interface InteractiveBoundsSource {
  positions: Float32Array;
  flags?: Uint32Array;
  normals?: Float32Array;
}
/** One session owns at most two workers; sources transfer once, pose updates stay tiny. */
export class InteractiveBoundsPool {
  private workers: Worker[] = [];
  private closed: Error | undefined;
  private prepared = new Set<string>();
  private preparing = new Map<string, Promise<void>>();
  private mirrorPrefixes = new Map<string, Promise<number | null>>();
  private pending = new Map<
    number,
    {
      resolve: (r: BoundsTaskResult) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private sequence = 0;
  private lease?: ReturnType<typeof setTimeout>;
  private fallbackReason: string | undefined;
  constructor(
    private readonly sources: ReadonlyMap<string, InteractiveBoundsSource>,
    private readonly options: { parallel?: boolean; threshold?: number } = {},
  ) {
    const bytes = [...sources.values()].reduce(
      (sum, s) =>
        sum +
        s.positions.byteLength +
        (s.flags?.byteLength ??
          (s.normals ? (s.positions.length / 3) * 4 : 0)) +
        (s.normals?.byteLength ?? 0),
      0,
    );
    if (bytes > 512 * 1024 * 1024)
      throw new Error(
        "Interactive bounds sources exceed the 512 MiB session limit.",
      );
  }
  private renew() {
    clearTimeout(this.lease);
    this.lease = setTimeout(() => this.releaseWorkers(), 60000);
  }
  close(
    reason: Error = new DOMException("Bounds session closed.", "AbortError"),
  ) {
    this.closed = reason;
    this.releaseWorkers(reason);
  }
  private ensureOpen() {
    if (this.closed) throw this.closed;
  }
  private releaseWorkers(
    reason: Error = new DOMException("Bounds workers expired.", "AbortError"),
  ) {
    clearTimeout(this.lease);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(reason);
    }
    this.pending.clear();
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.prepared.clear();
    this.preparing.clear();
    this.mirrorPrefixes.clear();
  }
  private start() {
    if (this.workers.length) return;
    if (this.options.parallel === false || typeof Worker === "undefined")
      return;
    try {
      const count = Math.min(
        2,
        Math.max(
          1,
          (typeof navigator === "undefined"
            ? 3
            : navigator.hardwareConcurrency || 3) - 1,
        ),
      );
      for (let i = 0; i < count; i++) {
        const w = new Worker(
          new URL("./interactive-bounds-worker.ts", import.meta.url),
          { type: "module" },
        );
        this.workers.push(w);
        w.onmessage = ({ data }: MessageEvent<BoundsTaskResult>) => {
          const p = this.pending.get(data.id);
          if (!p) return;
          this.pending.delete(data.id);
          clearTimeout(p.timer);
          data.error ? p.reject(new Error(data.error)) : p.resolve(data);
          this.renew();
        };
        w.onerror = (e) => {
          if (!this.workers.includes(w)) return;
          this.fallbackReason = e.message || "Bounds worker failed";
          this.releaseWorkers(new Error(this.fallbackReason));
        };
      }
    } catch (error) {
      this.fallbackReason = "Bounds worker startup failed";
      this.releaseWorkers(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  private send(
    worker: Worker,
    data: BoundsTask,
    transfer: Transferable[] = [],
  ) {
    return new Promise<BoundsTaskResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fallbackReason = "Bounds worker timed out";
        this.releaseWorkers(new Error(this.fallbackReason));
      }, 30000);
      this.pending.set(data.id, { resolve, reject, timer });
      try {
        worker.postMessage(data, transfer);
      } catch (error) {
        this.pending.delete(data.id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  private async prepareSource(
    key: string,
    source: InteractiveBoundsSource,
    ranges: [number, number][],
    signal?: AbortSignal,
  ) {
    if (this.prepared.has(key)) return;
    const existing = this.preparing.get(key);
    if (existing) return existing;
    const prepare = (async () => {
      await Promise.all(
        this.workers.map((w, i) => {
          const count = 8 / this.workers.length,
            first = i * count,
            last = first + count;
          const start = ranges[first][0],
            end = ranges[last - 1][1];
          const positions = source.positions.slice(start * 3, end * 3),
            flags = source.flags?.slice(start, end),
            normals = source.normals?.slice(start * 3, end * 3);
          const transfer: Transferable[] = [positions.buffer];
          if (flags) transfer.push(flags.buffer);
          if (normals) transfer.push(normals.buffer);
          return this.send(
            w,
            {
              id: ++this.sequence,
              action: "prepare",
              key,
              positions,
              flags,
              normals,
              offset: start,
              ranges: ranges.slice(first, last).map(([a, b], j) => ({
                index: first + j,
                start: a - start,
                end: b - start,
              })),
            },
            transfer,
          );
        }),
      );
      this.ensureOpen();
      signal?.throwIfAborted();
      this.prepared.add(key);
    })();
    this.preparing.set(key, prepare);
    try {
      await prepare;
    } finally {
      if (this.preparing.get(key) === prepare) this.preparing.delete(key);
    }
  }
  async mirror(
    key: string,
    settings: InteractiveMirrorSettings,
    options: { signal?: AbortSignal; includeColors?: boolean } = {},
  ) {
    this.ensureOpen();
    options.signal?.throwIfAborted();
    const source = this.sources.get(key);
    if (!source?.normals || source.normals.length !== source.positions.length)
      throw new Error(
        "Interactive mirror normals are unavailable or misaligned.",
      );
    nativeInteractiveMirrorPoints(
      { ...settings, normals: new Float32Array(), flags: new Uint32Array() },
      { indicesOnly: true },
    );
    const count = source.positions.length / 3,
      ranges = interactiveBoundsRanges(count),
      includeColors = options.includeColors !== false,
      started = performance.now();
    const abort = () =>
      this.close(
        new DOMException("Mirror preparation cancelled.", "AbortError"),
      );
    options.signal?.addEventListener("abort", abort, { once: true });
    const merge = (
      parts: NonNullable<BoundsTaskResult["points"]>[],
      workers: number,
    ) => {
      this.ensureOpen();
      options.signal?.throwIfAborted();
      const indices = new Uint32Array(
          parts.reduce((n, p) => n + p.indices.length, 0),
        ),
        colors = includeColors ? new Float32Array(count * 3) : undefined;
      let cursor = 0;
      for (const part of parts) {
        indices.set(part.indices, cursor);
        cursor += part.indices.length;
        if (colors) colors.set(part.colors, part.offset * 3);
      }
      return {
        indices,
        colors,
        complete:
          settings.allowanceMilliseconds >= settings.elapsedMilliseconds,
        execution: {
          physicalWorkers: workers,
          partitions: parts.length,
          preparationMilliseconds: performance.now() - started,
          fallbackReason: workers
            ? undefined
            : (this.fallbackReason ??
              (this.options.parallel === false
                ? "single-core requested"
                : "small scan serial path")),
        },
      };
    };
    try {
      if (count >= (this.options.threshold ?? 100000)) this.start();
      if (this.workers.length) {
        try {
          await this.prepareSource(key, source, ranges, options.signal);
          const prefixKey = JSON.stringify([
            key,
            settings.stride,
            !!settings.onlySelected,
          ]);
          let prefix = this.mirrorPrefixes.get(prefixKey);
          if (!prefix) {
            prefix = Promise.all(
              this.workers.map((w) =>
                this.send(w, {
                  id: ++this.sequence,
                  action: "mirrorPrefix",
                  key,
                  stride: settings.stride,
                  onlySelected: !!settings.onlySelected,
                }),
              ),
            ).then((values) => {
              this.ensureOpen();
              let first: number | null = null;
              for (const r of values) {
                const v = r.firstBasePoint;
                if (
                  v === undefined ||
                  (v !== null &&
                    (!Number.isSafeInteger(v) || v < 0 || v >= count))
                )
                  throw new Error(
                    "Mirror worker returned an invalid color prefix.",
                  );
                if (v !== null && (first === null || v < first)) first = v;
              }
              return first;
            });
            if (this.mirrorPrefixes.size >= 128) {
              const oldest = this.mirrorPrefixes.keys().next().value;
              if (oldest !== undefined) this.mirrorPrefixes.delete(oldest);
            }
            this.mirrorPrefixes.set(prefixKey, prefix);
          }
          const first = await prefix;
          this.ensureOpen();
          options.signal?.throwIfAborted();
          const outputs = await Promise.all(
            this.workers.map((w, i) => {
              const offset = ranges[i * (8 / this.workers.length)][0];
              return this.send(w, {
                id: ++this.sequence,
                action: "mirror",
                key,
                settings,
                includeColors,
                initialBaseColor: first !== null && first < offset,
              });
            }),
          );
          const parts = outputs.map((r, i) => {
            const p = r.points,
              start = ranges[i * (8 / this.workers.length)][0],
              end = ranges[(i + 1) * (8 / this.workers.length) - 1][1];
            if (
              !p ||
              p.offset !== start ||
              p.count !== end - start ||
              !(p.indices instanceof Uint32Array) ||
              !(p.colors instanceof Float32Array) ||
              p.indices.length > p.count ||
              p.colors.length !== (includeColors ? p.count * 3 : 0) ||
              typeof p.complete !== "boolean" ||
              (p.indices.length &&
                (p.indices[0] < start ||
                  p.indices[p.indices.length - 1] >= end))
            )
              throw new Error(
                "Mirror worker returned an invalid point partition.",
              );
            return p;
          });
          this.renew();
          return merge(parts, this.workers.length);
        } catch (error) {
          this.ensureOpen();
          options.signal?.throwIfAborted();
          this.fallbackReason =
            error instanceof Error ? error.message : String(error);
          this.releaseWorkers(new Error(this.fallbackReason));
        }
      }
      // Preserve responsiveness when workers are unavailable; never run the entire scan in one task.
      const size = 32768,
        parts: NonNullable<BoundsTaskResult["points"]>[] = [],
        zeros = new Uint32Array(Math.min(size, count));
      const pause = async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        this.ensureOpen();
        options.signal?.throwIfAborted();
      };
      let first: number | null = null;
      for (
        let start = 0;
        !settings.onlySelected && start < count && first === null;
        start += size
      ) {
        first = firstInteractiveMirrorBasePoint(
          source.flags?.subarray(start, Math.min(start + size, count)),
          Math.min(size, count - start),
          start,
          settings.stride,
          !!settings.onlySelected,
        );
        await pause();
      }
      for (let start = 0; start < count; start += size) {
        const end = Math.min(start + size, count),
          points = nativeInteractiveMirrorPoints(
            {
              ...settings,
              normals: source.normals.subarray(start * 3, end * 3),
              flags:
                source.flags?.subarray(start, end) ??
                zeros.subarray(0, end - start),
            },
            {
              offset: start,
              initialBaseColor: first !== null && first < start,
              sourceColors: includeColors,
              indicesOnly: !includeColors,
            },
          );
        parts.push({ ...points, offset: start, count: end - start });
        await pause();
      }
      return merge(parts, 0);
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }
  async measure(key: string, matrix: readonly number[], signal?: AbortSignal) {
    this.ensureOpen();
    signal?.throwIfAborted();
    const source = this.sources.get(key);
    if (!source) throw new Error("Interactive bounds target is unavailable.");
    if (matrix.length !== 12 || !matrix.every(Number.isFinite))
      throw new Error("Interactive bounds require a finite pose.");
    const ranges = interactiveBoundsRanges(source.positions.length / 3);
    const abort = () =>
      this.close(new DOMException("Bounds query cancelled.", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (source.positions.length / 3 >= (this.options.threshold ?? 100000))
        this.start();
      if (this.workers.length) {
        try {
          await this.prepareSource(key, source, ranges, signal);
          const data = await Promise.all(
            this.workers.map((w) =>
              this.send(w, {
                id: ++this.sequence,
                action: "measure",
                key,
                matrix: [...matrix],
              }),
            ),
          );
          this.ensureOpen();
          signal?.throwIfAborted();
          const lanes = data
            .flatMap((r) => r.lanes ?? [])
            .sort((a, b) => a.index - b.index);
          if (
            lanes.length !== 8 ||
            lanes.some(
              (l, i) =>
                l.index !== i ||
                !(l.values instanceof Float32Array) ||
                l.values.length !== 6,
            )
          )
            throw new Error("Bounds worker returned invalid logical lanes.");
          this.renew();
          return {
            ...reduceInteractiveBounds(lanes.map((l) => l.values)),
            execution: {
              physicalWorkers: this.workers.length,
              logicalLanes: 8,
              fallbackReason: undefined as string | undefined,
            },
          };
        } catch (error) {
          this.ensureOpen();
          signal?.throwIfAborted();
          this.fallbackReason =
            error instanceof Error ? error.message : String(error);
          this.releaseWorkers(new Error(this.fallbackReason));
        }
      }
      const lanes = [];
      for (const [start, end] of ranges) {
        this.ensureOpen();
        signal?.throwIfAborted();
        lanes.push(
          interactiveBoundsLane(
            source.positions,
            matrix,
            start,
            end,
            source.flags,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      this.ensureOpen();
      signal?.throwIfAborted();
      return {
        ...reduceInteractiveBounds(lanes),
        execution: {
          physicalWorkers: 0,
          logicalLanes: 8,
          fallbackReason:
            this.options.parallel === false
              ? "single-core requested"
              : (this.fallbackReason ?? "small scan serial path"),
        },
      };
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
}

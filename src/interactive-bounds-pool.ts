import {
  interactiveBoundsRanges,
  interactiveBoundsLane,
  reduceInteractiveBounds,
} from "./interactive-bounds-kernel";
import type { BoundsTask, BoundsTaskResult } from "./interactive-bounds-worker";
export interface InteractiveBoundsSource {
  positions: Float32Array;
  flags?: Uint32Array;
}
/** One session owns at most two workers; sources transfer once, pose updates stay tiny. */
export class InteractiveBoundsPool {
  private workers: Worker[] = [];
  private closed: Error | undefined;
  private prepared = new Set<string>();
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
      (sum, s) => sum + s.positions.byteLength + (s.flags?.byteLength ?? 0),
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
          if (!this.prepared.has(key)) {
            await Promise.all(
              this.workers.map((w, i) => {
                const count = 8 / this.workers.length,
                  first = i * count,
                  last = first + count;
                const start = ranges[first][0],
                  end = ranges[last - 1][1];
                const positions = source.positions.slice(start * 3, end * 3),
                  flags = source.flags?.slice(start, end);
                const transfer: Transferable[] = [positions.buffer];
                if (flags) transfer.push(flags.buffer);
                return this.send(
                  w,
                  {
                    id: ++this.sequence,
                    action: "prepare",
                    key,
                    positions,
                    flags,
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
          }
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

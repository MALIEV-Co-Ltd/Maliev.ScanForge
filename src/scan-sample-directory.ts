import {
  checkScanAbort,
  scanRange,
  type ScanBudget,
  type ScanCoordinates,
  type ScanGeometrySource,
  type ScanPageRef,
  type ScanPageStore,
} from "./scan-geometry-source";
import {
  scanDirectoryEntries,
  scanDirectoryWriter,
} from "./scan-page-directory";

export interface ScanSampleDirectory {
  readonly sampleCount: number;
  readonly triangleCount: number;
  samples(signal?: AbortSignal): AsyncIterable<{
    firstSample: number;
    coordinates: ScanCoordinates;
    release(): void;
  }>;
  corners(
    firstTriangle: number,
    count: number,
    signal?: AbortSignal,
  ): Promise<{ sampleIds: Float64Array; release(): void }>;
}

const RECORD_DOUBLES = 7; // integer cell XYZ, insertion ID, exact coordinate XYZ
type Bucket = {
  records: Float64Array;
  used: number;
  lease: { release(): void };
  touched: number;
};

/** Paged hash chains retain per-cell insertion order without retaining adjacency. */
class WeldPages {
  private readonly roots: (ScanPageRef | null)[];
  private readonly active = new Map<number, Bucket>();
  private clock = 0;
  private readonly capacity: number;
  private readonly maximumCached: number;
  constructor(
    private readonly store: ScanPageStore,
    private readonly budget: ScanBudget,
    private readonly signal?: AbortSignal,
  ) {
    const bytes = budget.snapshot().capacityBytes;
    this.roots = Array.from(
      { length: Math.max(4, Math.min(4096, Math.floor(bytes / 16_384))) },
      () => null,
    );
    this.capacity = Math.max(4, Math.min(1024, Math.floor(bytes / 1024 / 56)));
    this.maximumCached = Math.max(
      1,
      Math.floor(bytes / 8 / (this.capacity * 56)),
    );
  }
  private slot(x: number, y: number, z: number) {
    // Hash collisions are checked against complete safe-integer cell coordinates.
    return (
      ((Math.imul(x | 0, 73856093) ^
        Math.imul(y | 0, 19349663) ^
        Math.imul(z | 0, 83492791)) >>>
        0) %
      this.roots.length
    );
  }
  private async flush(slot: number, bucket: Bucket) {
    if (!bucket.used) return;
    const header = new TextEncoder().encode(JSON.stringify(this.roots[slot]));
    const offset = Math.ceil((4 + header.length) / 8) * 8;
    const lease = await this.budget.reserve(
      "weld encoding",
      offset + bucket.used * 56,
      this.signal,
    );
    try {
      const bytes = new Uint8Array(lease.bytes);
      new DataView(bytes.buffer).setUint32(0, header.length, true);
      bytes.set(header, 4);
      bytes.set(
        new Uint8Array(bucket.records.buffer, 0, bucket.used * 56),
        offset,
      );
      this.roots[slot] = await this.store.append(bytes, this.signal);
      bucket.used = 0;
    } finally {
      lease.release();
    }
  }
  async find(cell: readonly number[], point: readonly number[]) {
    checkScanAbort(this.signal);
    const slot = this.slot(cell[0], cell[1], cell[2]);
    let best = Infinity;
    const scan = (records: Float64Array, count: number) => {
      for (let row = 0; row < count; row++) {
        const at = row * RECORD_DOUBLES;
        if (
          records[at] === cell[0] &&
          records[at + 1] === cell[1] &&
          records[at + 2] === cell[2] &&
          records[at + 3] < best &&
          Math.hypot(
            records[at + 4] - point[0],
            records[at + 5] - point[1],
            records[at + 6] - point[2],
          ) <= 1e-6
        )
          best = records[at + 3];
      }
    };
    const cached = this.active.get(slot);
    if (cached) {
      cached.touched = ++this.clock;
      scan(cached.records, cached.used);
    }
    let ref = this.roots[slot];
    while (ref) {
      const page = await this.store.read(ref, this.signal);
      try {
        const length = new DataView(
          page.bytes.buffer,
          page.bytes.byteOffset,
        ).getUint32(0, true);
        const offset = Math.ceil((4 + length) / 8) * 8;
        const previous: ScanPageRef | null = JSON.parse(
          new TextDecoder().decode(page.bytes.subarray(4, 4 + length)),
        );
        const records = new Float64Array(
          page.bytes.buffer,
          page.bytes.byteOffset + offset,
          (page.bytes.length - offset) / 8,
        );
        scan(records, records.length / RECORD_DOUBLES);
        ref = previous;
      } finally {
        page.release();
      }
    }
    return Number.isFinite(best) ? best : -1;
  }
  async insert(cell: readonly number[], point: readonly number[], id: number) {
    const slot = this.slot(cell[0], cell[1], cell[2]);
    let bucket = this.active.get(slot);
    if (!bucket) {
      if (this.active.size >= this.maximumCached) {
        const [oldSlot, oldest] = [...this.active].reduce((a, b) =>
          a[1].touched < b[1].touched ? a : b,
        );
        await this.flush(oldSlot, oldest);
        oldest.lease.release();
        this.active.delete(oldSlot);
      }
      const lease = await this.budget.reserve(
        "weld bucket",
        this.capacity * 56,
        this.signal,
      );
      bucket = {
        records: new Float64Array(this.capacity * RECORD_DOUBLES),
        used: 0,
        lease,
        touched: 0,
      };
      this.active.set(slot, bucket);
    }
    bucket.touched = ++this.clock;
    if (bucket.used === this.capacity) await this.flush(slot, bucket);
    bucket.records.set([...cell, id, ...point], bucket.used++ * RECORD_DOUBLES);
  }
  async dispose() {
    this.active.forEach((bucket) => bucket.lease.release());
    this.active.clear();
    // Hash chains are construction scratch, never output geometry pages.
    for (let ref of this.roots) {
      while (ref) {
        const page = await this.store.read(ref);
        let previous: ScanPageRef | null;
        try {
          const length = new DataView(
            page.bytes.buffer,
            page.bytes.byteOffset,
          ).getUint32(0, true);
          previous = JSON.parse(
            new TextDecoder().decode(page.bytes.subarray(4, 4 + length)),
          );
        } finally {
          page.release();
        }
        await this.store.remove(ref);
        ref = previous;
      }
    }
  }
}

export async function createScanSampleDirectory(
  source: ScanGeometrySource,
  store: ScanPageStore,
  budget: ScanBudget,
  signal?: AbortSignal,
): Promise<ScanSampleDirectory> {
  checkScanAbort(signal);
  const samples = scanDirectoryWriter(store, budget, signal),
    corners = scanDirectoryWriter(store, budget, signal);
  const headBytes =
    Math.max(
      4,
      Math.min(4096, Math.floor(budget.snapshot().capacityBytes / 16_384)),
    ) * 160;
  const step = Math.max(
    1,
    Math.min(4096, Math.floor(budget.snapshot().capacityBytes / 32 / 72)),
  );
  const sampleLease = await budget.reserve(
    "sample staging and weld metadata",
    headBytes + step * 9 * 8,
    signal,
  );
  const weld = new WeldPages(store, budget, signal);
  const staging = new Float64Array(step * 9);
  let used = 0,
    sampleCount = 0;
  let origin: number[] | undefined;
  const flushSamples = async () => {
    if (!used) return;
    const page = await store.append(
      new Uint8Array(staging.buffer, 0, used * 3 * 8),
      signal,
    );
    await samples.append({ first: sampleCount - used, count: used, page });
    used = 0;
  };
  try {
    for (let first = 0; first < source.metadata.triangles; first += step) {
      const count = Math.min(step, source.metadata.triangles - first);
      const chunk = await source.readTriangles(first, count, signal);
      try {
        const idsLease = await budget.reserve(
          "corner staging",
          count * 3 * 8,
          signal,
        );
        try {
          const ids = new Float64Array(count * 3);
          for (let at = 0; at < chunk.positions.length; at += 3) {
            checkScanAbort(signal);
            const point = [
              chunk.positions[at],
              chunk.positions[at + 1],
              chunk.positions[at + 2],
            ];
            origin ??= point;
            const cell = point.map((value, axis) =>
              Math.floor((value - origin![axis]) / 1e-6),
            );
            if (!cell.every(Number.isSafeInteger))
              throw new Error(
                "Coordinate range exceeds weld precision; increase tolerance.",
              );
            let id = -1;
            search: for (let dx = -1; dx <= 1; dx++)
              for (let dy = -1; dy <= 1; dy++)
                for (let dz = -1; dz <= 1; dz++) {
                  id = await weld.find(
                    [cell[0] + dx, cell[1] + dy, cell[2] + dz],
                    point,
                  );
                  if (id >= 0) break search;
                }
            if (id < 0) {
              id = sampleCount++;
              await weld.insert(cell, point, id);
              staging.set(point, used++ * 3);
              if (used * 3 === staging.length) await flushSamples();
            }
            ids[at / 3] = id;
          }
          const page = await store.append(new Uint8Array(ids.buffer), signal);
          await corners.append({ first, count, page });
        } finally {
          idsLease.release();
        }
      } finally {
        chunk.release();
      }
    }
    await flushSamples();
    const samplePages = await samples.finish(),
      cornerPages = await corners.finish();
    return {
      sampleCount,
      triangleCount: source.metadata.triangles,
      async *samples(readSignal) {
        for await (const entry of scanDirectoryEntries(
          samplePages,
          store,
          budget,
          readSignal,
        )) {
          const page = await store.read(entry.page, readSignal);
          try {
            yield {
              firstSample: entry.first,
              coordinates: new Float64Array(
                page.bytes.buffer,
                page.bytes.byteOffset,
                page.bytes.length / 8,
              ),
              release: page.release,
            };
          } finally {
            page.release();
          }
        }
      },
      async corners(first, count, readSignal) {
        checkScanAbort(readSignal);
        scanRange(first, count, source.metadata.triangles);
        const lease = await budget.reserve(
          "corner output",
          count * 24,
          readSignal,
        );
        try {
          const output = new Float64Array(count * 3);
          for await (const entry of scanDirectoryEntries(
            cornerPages,
            store,
            budget,
            readSignal,
          )) {
            const start = Math.max(first, entry.first),
              end = Math.min(first + count, entry.first + entry.count);
            if (start >= end) continue;
            const page = await store.read(entry.page, readSignal);
            try {
              const values = new Float64Array(
                page.bytes.buffer,
                page.bytes.byteOffset,
                page.bytes.length / 8,
              );
              output.set(
                values.subarray(
                  (start - entry.first) * 3,
                  (end - entry.first) * 3,
                ),
                (start - first) * 3,
              );
            } finally {
              page.release();
            }
          }
          return { sampleIds: output, release: lease.release };
        } catch (error) {
          lease.release();
          throw error;
        }
      },
    };
  } finally {
    samples.dispose();
    corners.dispose();
    try {
      await weld.dispose();
    } finally {
      sampleLease.release();
    }
  }
}

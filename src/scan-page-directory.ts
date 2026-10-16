import {
  checkScanAbort,
  type ScanBudget,
  type ScanBudgetLease,
  type ScanChunkDirectoryRef,
  type ScanPageRef,
  type ScanPageStore,
} from "./scan-geometry-source";

export type ScanDirectoryEntry = {
  first: number;
  count: number;
  page: ScanPageRef;
};
type HeldEntry = { value: ScanDirectoryEntry; lease: ScanBudgetLease };
const FANOUT = 8;

/** An append-only paged tree: no input-sized array of page references. */
export function scanDirectoryWriter(
  store: ScanPageStore,
  budget: ScanBudget,
  signal?: AbortSignal,
) {
  const levels: HeldEntry[][] = [];
  let entries = 0,
    end = 0,
    closed = false;
  const add = async (
    value: ScanDirectoryEntry,
    level: number,
  ): Promise<void> => {
    const lease = await budget.reserve("directory metadata", 256, signal);
    (levels[level] ??= []).push({ value, lease });
    if (levels[level].length === FANOUT) await flush(level);
  };
  const flush = async (level: number) => {
    const held = levels[level];
    if (!held?.length) return;
    const values = held.map((item) => item.value);
    // Metadata records are bounded by fanout, including encoding/decoding scratch.
    const scratch = await budget.reserve("directory encoding", 8192, signal);
    let page: ScanPageRef;
    try {
      page = await store.append(
        new TextEncoder().encode(JSON.stringify(values)),
        signal,
      );
    } finally {
      scratch.release();
    }
    levels[level] = [];
    held.forEach((item) => item.lease.release());
    const last = values[values.length - 1];
    await add(
      {
        first: values[0].first,
        count: last.first + last.count - values[0].first,
        page,
      },
      level + 1,
    );
  };
  const releaseMetadata = () =>
    levels.forEach((items) => items.forEach((item) => item.lease.release()));
  return {
    async append(entry: ScanDirectoryEntry) {
      checkScanAbort(signal);
      if (
        closed ||
        entry.first !== end ||
        !Number.isSafeInteger(entry.count) ||
        entry.count <= 0 ||
        !Number.isSafeInteger(entry.first + entry.count)
      )
        throw new Error(
          "Scan directory entries must be positive contiguous ranges.",
        );
      await add(entry, 0);
      end += entry.count;
      entries++;
    },
    async finish(): Promise<ScanChunkDirectoryRef> {
      if (closed || !entries)
        throw new Error("Cannot finish an empty or closed scan directory.");
      closed = true;
      try {
        for (let level = 0; level < levels.length; level++) {
          if (!levels[level].length) continue;
          if (
            level > 0 &&
            levels[level].length === 1 &&
            levels.every((items, index) => index === level || !items.length)
          )
            return {
              root: levels[level][0].value.page,
              entries,
              levels: level,
            };
          await flush(level);
        }
        throw new Error("Scan directory could not be finalized.");
      } finally {
        releaseMetadata();
      }
    },
    dispose() {
      closed = true;
      releaseMetadata();
    },
  };
}

export async function* scanDirectoryEntries(
  directory: ScanChunkDirectoryRef,
  store: ScanPageStore,
  budget: ScanBudget,
  signal?: AbortSignal,
  first = 0,
  end = Infinity,
): AsyncGenerator<ScanDirectoryEntry> {
  async function* read(
    ref: ScanPageRef,
    depth: number,
  ): AsyncGenerator<ScanDirectoryEntry> {
    checkScanAbort(signal);
    if (!Number.isInteger(depth) || depth < 1 || depth > 54)
      throw new Error("Invalid scan directory depth.");
    const scratch = await budget.reserve(
      "directory decoding",
      Math.max(1024, ref.bytes * 8),
      signal,
    );
    try {
      const page = await store.read(ref, signal);
      let entries: ScanDirectoryEntry[];
      try {
        const parsed: unknown = JSON.parse(
          new TextDecoder().decode(page.bytes),
        );
        if (!Array.isArray(parsed) || parsed.length > FANOUT || !parsed.length)
          throw new Error("Invalid scan directory page.");
        entries = parsed.map((entry) => {
          if (
            !entry ||
            !Number.isSafeInteger(entry.first) ||
            !Number.isSafeInteger(entry.count) ||
            entry.first < 0 ||
            entry.count <= 0 ||
            typeof entry.page?.id !== "string" ||
            typeof entry.page.sha256 !== "string" ||
            !Number.isSafeInteger(entry.page.bytes) ||
            entry.page.bytes < 0
          )
            throw new Error("Invalid scan directory entry.");
          return entry;
        });
      } finally {
        page.release();
      }
      for (const entry of entries) {
        if (entry.first >= end || entry.first + entry.count <= first) continue;
        if (depth === 1) yield entry;
        else yield* read(entry.page, depth - 1);
      }
    } finally {
      scratch.release();
    }
  }
  yield* read(directory.root, directory.levels);
}

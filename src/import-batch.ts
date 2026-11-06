import { readAscPointCloud } from "./asc-import";

export type ImportBatchProgress = {
  kind: "importBatch";
  admission?: ImportAdmission;
  files: {
    index: number;
    name: string;
    status:
      | "queued"
      | "importing"
      | "rendering"
      | "complete"
      | "failed"
      | "cancelled";
    fraction: number;
    stage: string;
  }[];
};

export type ImportAdmission = {
  concurrency: 1 | 2;
  reason: "parallel" | "single-file" | "format" | "cpu" | "memory";
  message: string;
  estimatedPeakBytes: number;
  memoryBudgetBytes: number;
  estimates: {
    index: number;
    bytes: number;
    basis: "sampled-asc" | "source-size";
  }[];
};

const MiB = 1024 ** 2;

/** Streaming ASC retains typed point buffers; bounded samples avoid treating file text as live heap. */
async function estimateImportMemory(file: File, signal?: AbortSignal) {
  if (/\.asc$/i.test(file.name)) {
    try {
      const sampleSize = 64 * 1024;
      let density = 0;
      for (const offset of new Set([
        0,
        Math.max(0, Math.floor(file.size / 2) - sampleSize / 2),
        Math.max(0, file.size - sampleSize),
      ])) {
        signal?.throwIfAborted();
        const end = Math.min(file.size, offset + sampleSize);
        const bytes = new Uint8Array(
          await file.slice(offset, end).arrayBuffer(),
        );
        signal?.throwIfAborted();
        const first = offset ? bytes.indexOf(10) + 1 : 0;
        const last = end < file.size ? bytes.lastIndexOf(10) + 1 : bytes.length;
        if ((offset && !first) || last <= first) continue;
        const sample = new Blob([bytes.slice(first, last)]);
        const cloud = await readAscPointCloud(sample, { signal });
        density = Math.max(density, cloud.positions.length / 3 / sample.size);
      }
      if (density) {
        // 64 bytes/point covers CPU/GPU buffers and selection; double sampled density for variation.
        return {
          bytes: Math.ceil(file.size * density) * 128 + 32 * MiB,
          basis: "sampled-asc" as const,
        };
      }
    } catch {
      signal?.throwIfAborted();
      // Samples are advisory; only the full parser decides whether a file is valid.
    }
  }
  return { bytes: file.size * 16 + 32 * MiB, basis: "source-size" as const };
}

/** Admission is a memory estimate, not a browser RAM guarantee or a file acceptance limit. */
export async function planImportBatch(
  files: readonly File[],
  signal?: AbortSignal,
  capacity = {
    cores: globalThis.navigator?.hardwareConcurrency ?? 4,
    memoryGiB:
      (globalThis.navigator as Navigator & { deviceMemory?: number })
        ?.deviceMemory ?? 4,
    usedHeapBytes:
      (
        globalThis.performance as Performance & {
          memory?: { usedJSHeapSize: number };
        }
      )?.memory?.usedJSHeapSize ?? 0,
  },
): Promise<ImportAdmission> {
  const estimates: ImportAdmission["estimates"] = [];
  for (const [index, file] of files.entries()) {
    signal?.throwIfAborted();
    estimates.push({ index, ...(await estimateImportMemory(file, signal)) });
  }
  signal?.throwIfAborted();
  const largest = estimates.map((file) => file.bytes).sort((a, b) => b - a);
  const estimatedPeakBytes = (largest[0] ?? 0) + (largest[1] ?? 0);
  // Leave three quarters of the reported device memory for the OS, existing scene and other apps.
  const memoryBudgetBytes = Math.max(
    0,
    Math.min((capacity.memoryGiB * 1024 ** 3) / 4, 1024 ** 3) -
      capacity.usedHeapBytes,
  );
  const reason =
    files.length < 2
      ? "single-file"
      : files.filter((file) => /\.(asc|stl|obj|ply)$/i.test(file.name)).length <
          2
        ? "format"
        : capacity.cores <= 2
          ? "cpu"
          : estimatedPeakBytes > memoryBudgetBytes
            ? "memory"
            : "parallel";
  const message =
    reason === "parallel"
      ? "Parallel import (2 parsers)"
      : reason === "single-file"
        ? "One file (1 parser)"
        : reason === "format"
          ? "Sequential import: CAD imports are serialized"
          : reason === "cpu"
            ? "Sequential import: browser reports two or fewer CPU threads"
            : `Sequential import: estimated active pair ${Math.ceil(estimatedPeakBytes / MiB)} MiB exceeds memory budget ${Math.floor(memoryBudgetBytes / MiB)} MiB`;
  return {
    concurrency: reason === "parallel" ? 2 : 1,
    reason,
    message,
    estimatedPeakBytes,
    memoryBudgetBytes,
    estimates,
  };
}

/** Conservative admission; file bytes underestimate decoded geometry and render buffers. */
export function importConcurrency(
  files: readonly { size: number }[],
  capacity = {
    cores: globalThis.navigator?.hardwareConcurrency ?? 4,
    memoryGiB:
      (globalThis.navigator as Navigator & { deviceMemory?: number })
        ?.deviceMemory ?? 8,
  },
): number {
  const memory = (
    globalThis.performance as Performance & {
      memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number };
    }
  )?.memory;
  // Reserve another third for retained computed facet vectors (12 bytes/face
  // beside the 36-byte expanded triangle stream). This remains a concurrency
  // heuristic, not an acceptance limit or a whole-process memory guarantee.
  const estimate = files.reduce((sum, file) => sum + file.size, 0) * 16;
  return files.length > 1 &&
    capacity.cores > 2 &&
    capacity.memoryGiB > 4 &&
    files.every((file) => file.size <= 64 * 1024 * 1024) &&
    estimate <= 512 * 1024 * 1024 &&
    (!memory ||
      memory.jsHeapSizeLimit - memory.usedJSHeapSize >
        estimate + 256 * 1024 * 1024)
    ? 2
    : 1;
}

/** Bounded preparation with serialized publication; a slot retains at most one result. */
export async function importBatch<T, R, C = R>(
  files: readonly T[],
  load: (
    file: T,
    index: number,
    context: {
      signal: AbortSignal;
      progress(fraction: number, stage: string): void;
    },
  ) => Promise<R>,
  signal?: AbortSignal,
  options: {
    concurrency?: number;
    admission?: ImportAdmission;
    names?: readonly string[];
    commit?: (value: R, file: T, index: number) => Promise<C>;
    onProgress?: (progress: ImportBatchProgress) => void;
  } = {},
): Promise<{
  admission?: ImportAdmission;
  completed: C[];
  failed: { index: number; error: string }[];
  cancelled: boolean;
}> {
  const completed = new Map<number, C>(),
    failed: { index: number; error: string }[] = [];
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const states: ImportBatchProgress["files"] = files.map((_, index) => ({
    index,
    name: options.names?.[index] ?? String(index + 1),
    status: "queued",
    fraction: 0,
    stage: "Queued",
  }));
  const publish = () =>
    options.onProgress?.({
      kind: "importBatch",
      ...(options.admission ? { admission: options.admission } : {}),
      files: states.map((state) => ({ ...state })),
    });
  let next = 0;
  let publication = Promise.resolve();
  const work = async () => {
    while (!controller.signal.aborted && next < files.length) {
      const index = next++,
        state = states[index];
      state.status = "importing";
      state.stage = "Importing";
      publish();
      try {
        const value = await load(files[index], index, {
          signal: controller.signal,
          progress(fraction, stage) {
            if (controller.signal.aborted) return;
            state.fraction = Number.isFinite(fraction)
              ? Math.max(0, Math.min(1, fraction))
              : state.fraction;
            state.stage = stage;
            publish();
          },
        });
        const commit = publication.then(async () => {
          controller.signal.throwIfAborted();
          state.status = "rendering";
          state.stage = "Rendering";
          publish();
          const result = options.commit
            ? await options.commit(value, files[index], index)
            : (value as unknown as C);
          completed.set(index, result);
          state.status = "complete";
          state.fraction = 1;
          state.stage = "Complete";
          publish();
        });
        publication = commit.catch(() => {});
        await commit;
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          controller.abort();
          state.status = "cancelled";
          state.stage = "Cancelled";
        } else {
          state.status = "failed";
          state.stage = error instanceof Error ? error.message : String(error);
          failed.push({ index, error: state.stage });
        }
        publish();
      }
    }
  };
  try {
    publish();
    const concurrency =
      (options.admission?.concurrency ?? options.concurrency) === 2 ? 2 : 1;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, files.length) }, work),
    );
    if (controller.signal.aborted)
      for (const state of states)
        if (state.status === "queued") {
          state.status = "cancelled";
          state.stage = "Cancelled";
        }
    publish();
    return {
      ...(options.admission ? { admission: options.admission } : {}),
      completed: [...completed]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value),
      failed: failed.sort((a, b) => a.index - b.index),
      cancelled: controller.signal.aborted,
    };
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

/** A project replaces a workspace, so it must never silently erase a scan batch. */
export function validateImportBatch(names: readonly string[]): void {
  if (!names.length) throw new Error("Choose at least one file.");
  for (const name of names) {
    if (
      !/\.(stl|obj|ply|asc|step|stp|iges|igs|brep|scanforge|json)$/i.test(name)
    )
      throw new Error(`Unsupported import file: ${name}`);
    if (names.length > 1 && /\.(scanforge|json)$/i.test(name))
      throw new Error("Open project files separately from scan batches.");
  }
}
